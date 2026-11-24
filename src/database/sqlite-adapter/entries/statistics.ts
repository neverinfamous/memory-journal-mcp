import type { EntriesSharedContext } from './shared.js'
import {
    effectiveWorkspace,
    normalizeDateRangeStart,
    normalizeDateRangeEnd,
} from '../../workspace-scope.js'
import { validateDateFormatPattern } from '../../../utils/security-utils.js'
import { logger } from '../../../utils/logger.js'

/** Maximum number of period rows returned in the activity timeline */
const MAX_PERIOD_ROWS = 52

type StatsDb = EntriesSharedContext['db']

interface PeriodRow {
    period: string
    total_count: number
    significant_count: number
}

function buildDateFilter(
    workspaceId: string,
    startDate?: string,
    endDate?: string,
    projectNumber?: number
): { dateFilter: string; dateParams: unknown[] } {
    let dateFilter = ''
    const dateParams: unknown[] = []

    if (workspaceId !== '*') {
        dateFilter += ' AND workspace_id = ?'
        dateParams.push(workspaceId)
    }
    if (projectNumber !== undefined) {
        dateFilter += ' AND project_number = ?'
        dateParams.push(projectNumber)
    }

    if (startDate) {
        dateFilter += ' AND timestamp >= ?'
        dateParams.push(normalizeDateRangeStart(startDate))
    }
    if (endDate) {
        dateFilter += ' AND timestamp <= ?'
        dateParams.push(normalizeDateRangeEnd(endDate))
    }
    return { dateFilter, dateParams }
}

function getTypeCounts(
    db: StatsDb,
    dateFilter: string,
    dateParams: unknown[]
): { totalEntries: number; entriesByType: Record<string, number> } {
    const entriesByType = Object.create(null) as Record<string, number>
    let totalEntries = 0

    const sql =
        dateParams.length > 0
            ? `SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter} GROUP BY entry_type`
            : `SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL GROUP BY entry_type`
    const typeRows = (
        dateParams.length > 0 ? db.prepare(sql).all(...dateParams) : db.prepare(sql).all()
    ) as { entry_type: string; count: number }[]
    for (const row of typeRows) {
        entriesByType[row.entry_type] = row.count
        totalEntries += row.count
    }
    return { totalEntries, entriesByType }
}

function getPeriodRows(
    db: StatsDb,
    dateFormat: string,
    dateFilter: string,
    dateParams: unknown[]
): PeriodRow[] {
    return db
        .prepare(
            `SELECT
        strftime(?, timestamp) as period,
        COUNT(*) as total_count,
        SUM(CASE WHEN significance_type IS NOT NULL THEN 1 ELSE 0 END) as significant_count
    FROM memory_journal
    WHERE deleted_at IS NULL${dateFilter}
    GROUP BY period
    ORDER BY period DESC
    LIMIT ${String(MAX_PERIOD_ROWS)}`
        )
        .all(dateFormat, ...dateParams) as PeriodRow[]
}

function getRelationshipCounts(
    db: StatsDb,
    dateFilter: string,
    dateParams: unknown[]
): {
    totalRelationships: number
    linkedCount: number
    relTypeRows: { relationship_type: string; count: number }[]
} {
    const peerWsClause = dateFilter.includes('workspace_id')
        ? ' AND p.workspace_id = m.workspace_id'
        : ''
    const peerProjClause = dateFilter.includes('project_number')
        ? ' AND p.project_number = m.project_number'
        : ''
    const peerScopeClause = `${peerWsClause}${peerProjClause}`
    const activePeerFilter = `EXISTS (SELECT 1 FROM memory_journal p WHERE p.id = r.to_entry_id AND r.to_entry_id != r.from_entry_id AND p.deleted_at IS NULL${peerScopeClause})`
    const relStartFrom = dateParams.length > 0
        ? `FROM memory_journal m CROSS JOIN relationships r ON r.from_entry_id = m.id`
        : `FROM relationships r JOIN memory_journal m ON r.from_entry_id = m.id`
    const relTypeRows = db
        .prepare(
            `
        SELECT r.relationship_type, COUNT(*) as count
        ${relStartFrom}
        WHERE m.deleted_at IS NULL${dateFilter} AND ${activePeerFilter}
        GROUP BY r.relationship_type
    `
        )
        .all(...dateParams) as {
        relationship_type: string
        count: number
    }[]
    let totalRelationships = 0
    for (const row of relTypeRows) {
        totalRelationships += row.count
    }

    const linkedEntriesRow = db
        .prepare(
            `SELECT COUNT(*) as count FROM memory_journal m
             WHERE m.deleted_at IS NULL${dateFilter}
               AND (
                   EXISTS (
                       SELECT 1 FROM relationships r
                       CROSS JOIN memory_journal p ON p.id = r.to_entry_id
                       WHERE r.from_entry_id = m.id AND r.from_entry_id != r.to_entry_id AND p.deleted_at IS NULL${peerScopeClause}
                   )
                   OR EXISTS (
                       SELECT 1 FROM relationships r
                       CROSS JOIN memory_journal p ON p.id = r.from_entry_id
                       WHERE r.to_entry_id = m.id AND r.from_entry_id != r.to_entry_id AND p.deleted_at IS NULL${peerScopeClause}
                   )
               )`
        )
        .get(...dateParams) as { count: number }

    return {
        totalRelationships,
        linkedCount: linkedEntriesRow.count,
        relTypeRows,
    }
}

function buildRelationshipBreakdown(relTypeRows: { relationship_type: string; count: number }[]): {
    causalMetrics: { blocked_by: number; resolved: number; caused: number }
    relationshipBreakdown: Record<string, number>
} {
    const causalMetrics = { blocked_by: 0, resolved: 0, caused: 0 }
    const relationshipBreakdown = Object.create(null) as Record<string, number>
    for (const relType of [
        'evolves_from',
        'references',
        'implements',
        'clarifies',
        'response_to',
        'blocked_by',
        'resolved',
        'caused',
    ]) {
        relationshipBreakdown[relType] = 0
    }
    for (const row of relTypeRows) {
        const canonicalKey = row.relationship_type === 'resolves' ? 'resolved' : row.relationship_type
        relationshipBreakdown[canonicalKey] = (relationshipBreakdown[canonicalKey] ?? 0) + row.count
        if (canonicalKey === 'blocked_by' || canonicalKey === 'resolved' || canonicalKey === 'caused') {
            causalMetrics[canonicalKey] = (causalMetrics[canonicalKey] ?? 0) + row.count
        }
    }
    return { causalMetrics, relationshipBreakdown }
}

function buildSummaryMetrics(
    periodRows: PeriodRow[],
    totalEntries: number,
    totalRelationships: number,
    linkedCount: number
): {
    entriesByPeriod: { period: string; count: number }[]
    decisionDensity: { period: string; significantCount: number }[]
    relationshipComplexity: { totalRelationships: number; avgPerEntry: number; density: number }
    activityTrend: { currentPeriod: string; previousPeriod: string; growthPercent: number | null }
} {
    const entriesByPeriod = periodRows.map((r) => ({ period: r.period, count: r.total_count }))
    const decisionDensity = periodRows
        .filter((r) => r.significant_count > 0)
        .map((r) => ({ period: r.period, significantCount: r.significant_count }))

    const avgPerEntry = totalEntries > 0 ? totalRelationships / totalEntries : 0
    const density =
        totalEntries > 0 ? Math.round((linkedCount / totalEntries) * 10000) / 10000 : 0

    const currentPeriod = entriesByPeriod[0]?.period ?? ''
    const previousPeriod = entriesByPeriod[1]?.period ?? ''
    const currentCount = entriesByPeriod[0]?.count ?? 0
    const previousCount = entriesByPeriod[1]?.count ?? 0
    const growthPercent =
        previousCount > 0
            ? Math.round(((currentCount - previousCount) / previousCount) * 100)
            : null

    return {
        entriesByPeriod,
        decisionDensity,
        relationshipComplexity: {
            totalRelationships,
            avgPerEntry: Math.round(avgPerEntry * 100) / 100,
            density,
        },
        activityTrend: { currentPeriod, previousPeriod, growthPercent },
    }
}

export function getStatistics(
    context: EntriesSharedContext,
    groupBy: 'day' | 'week' | 'month' | 'year' = 'week',
    startDate?: string,
    endDate?: string,
    projectBreakdown?: boolean,
    workspaceId = 'default',
    projectNumber?: number
): Record<string, unknown> {
    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)

    const { dateFilter, dateParams } = buildDateFilter(scopeId, startDate, endDate, projectNumber)
    const { totalEntries, entriesByType } = getTypeCounts(db, dateFilter, dateParams)

    const dateFormat = validateDateFormatPattern(groupBy)
    const periodRows = getPeriodRows(db, dateFormat, dateFilter, dateParams)
    const { totalRelationships, linkedCount, relTypeRows } = getRelationshipCounts(
        db,
        dateFilter,
        dateParams
    )
    const { entriesByPeriod, decisionDensity, relationshipComplexity, activityTrend } =
        buildSummaryMetrics(periodRows, totalEntries, totalRelationships, linkedCount)
    const { causalMetrics, relationshipBreakdown } = buildRelationshipBreakdown(relTypeRows)

    const result: Record<string, unknown> = {
        totalEntries,
        entriesByType,
        entriesByPeriod,
        decisionDensity,
        relationshipComplexity,
        activityTrend,
        causalMetrics,
        relationshipBreakdown,
    }

    if (startDate || endDate) {
        result['dateRange'] = {
            startDate: startDate || '',
            endDate: endDate || '',
        }
    }

    if (projectBreakdown) {
        result['projectBreakdown'] = buildProjectBreakdown(context, dateFilter, dateParams)
    }

    return result
}

function buildProjectBreakdown(
    context: EntriesSharedContext,
    dateFilter: string,
    dateParams: unknown[]
): Record<string, unknown>[] {
    const { db } = context
    const projRows = db
        .prepare(
            `SELECT 
                    project_number, 
                    COUNT(*) as entry_count,
                    MAX(issue_url) as sample_issue_url,
                    MAX(pr_url) as sample_pr_url
            FROM memory_journal
            WHERE deleted_at IS NULL AND project_number IS NOT NULL${dateFilter}
            GROUP BY project_number
            ORDER BY entry_count DESC, project_number ASC`
        )
        .all(...dateParams) as {
        project_number: number
        entry_count: number
        sample_issue_url: string | null
        sample_pr_url: string | null
    }[]

    return projRows.map((r) => {
        let name: string | undefined = undefined

        // 1. Try to resolve from config registry by matching project_number
        if (context.config?.projectRegistry) {
            for (const [key, val] of Object.entries(context.config.projectRegistry)) {
                if (val.project_number === r.project_number) {
                    name = key
                    break
                }
            }
        }

        // 2. Fallback to URL parsing if not found in config
        if (!name) {
            const url = r.sample_issue_url || r.sample_pr_url
            if (url) {
                try {
                    const parsed = new URL(url)
                    const parts = parsed.pathname.split('/').filter(Boolean)
                    if (parts.length >= 2) {
                        name = parts[1]
                    }
                } catch (err) {
                    logger.debug('Failed to parse project URL for repository name inference', {
                        module: 'Statistics',
                        url,
                        error: err instanceof Error ? err.message : String(err),
                    })
                }
            }
        }

        return {
            project_number: r.project_number,
            entry_count: r.entry_count,
            ...(name ? { name } : {}),
        }
    })
}
