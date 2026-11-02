import type { EntriesSharedContext } from './shared.js'
import { validateDateFormatPattern } from '../../../utils/security-utils.js'

/** Maximum number of period rows returned in the activity timeline */
const MAX_PERIOD_ROWS = 52

export function getStatistics(
    context: EntriesSharedContext,
    groupBy: 'day' | 'week' | 'month' | 'year' = 'week',
    startDate?: string,
    endDate?: string,
    projectBreakdown?: boolean,
    workspaceId = 'default'
): Record<string, unknown> {
    const { db } = context

    let dateFilter = ''
    const dateParams: unknown[] = []

    if (workspaceId !== '*') {
        dateFilter += ' AND workspace_id = ?'
        dateParams.push(workspaceId)
    }

    if (startDate) {
        let start = startDate
        if (!start.includes('T')) start += 'T00:00:00.000Z'
        dateFilter += ' AND timestamp >= ?'
        dateParams.push(start)
    }
    if (endDate) {
        let end = endDate
        if (!end.includes('T')) end += 'T23:59:59.999Z'
        dateFilter += ' AND timestamp <= ?'
        dateParams.push(end)
    }

    let totalEntries: number
    const entriesByType: Record<string, number> = {}

    if (dateParams.length > 0) {
        const countRow = db
            .prepare(
                `SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter}`
            )
            .get(...dateParams) as { count: number }
        totalEntries = countRow.count

        const typeRows = db
            .prepare(
                `SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter} GROUP BY entry_type`
            )
            .all(...dateParams) as { entry_type: string; count: number }[]
        for (const row of typeRows) {
            entriesByType[row.entry_type] = row.count
        }
    } else {
        const countRow = db
            .prepare('SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL')
            .get() as { count: number }
        totalEntries = countRow.count

        const typeRows = db
            .prepare(
                `SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL GROUP BY entry_type`
            )
            .all() as { entry_type: string; count: number }[]
        for (const row of typeRows) {
            entriesByType[row.entry_type] = row.count
        }
    }

    const dateFormat = validateDateFormatPattern(groupBy === 'year' ? 'month' : groupBy)
    const periodRows = db
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
        .all(dateFormat, ...dateParams) as {
        period: string
        total_count: number
        significant_count: number
    }[]

    const entriesByPeriod = periodRows.map((r) => ({
        period: r.period,
        count: r.total_count,
    }))

    const decisionDensity = periodRows
        .filter((r) => r.significant_count > 0)
        .map((r) => ({
            period: r.period,
            significantCount: r.significant_count,
        }))

    const relCountRow = db
        .prepare(
            `SELECT COUNT(*) as count FROM relationships r JOIN memory_journal m ON r.from_entry_id = m.id WHERE m.deleted_at IS NULL${dateFilter}`
        )
        .get(...dateParams) as {
        count: number
    }
    const relTypeRows = db
        .prepare(
            `
        SELECT r.relationship_type, COUNT(*) as count
        FROM relationships r
        JOIN memory_journal m ON r.from_entry_id = m.id
        WHERE m.deleted_at IS NULL${dateFilter}
        GROUP BY r.relationship_type
    `
        )
        .all(...dateParams) as {
        relationship_type: string
        count: number
    }[]

    const linkedEntriesRow = db
        .prepare(
            `SELECT COUNT(*) as count FROM memory_journal m
             WHERE m.deleted_at IS NULL${dateFilter}
               AND m.id IN (
                   SELECT from_entry_id FROM relationships
                   UNION
                   SELECT to_entry_id FROM relationships
               )`
        )
        .get(...dateParams) as { count: number }

    const totalRelationships = relCountRow.count
    const avgPerEntry = totalEntries > 0 ? totalRelationships / totalEntries : 0
    const density =
        totalEntries > 0
            ? Math.round((linkedEntriesRow.count / totalEntries) * 10000) / 10000
            : 0

    const currentPeriod = entriesByPeriod[0]?.period ?? ''
    const previousPeriod = entriesByPeriod[1]?.period ?? ''
    const currentCount = entriesByPeriod[0]?.count ?? 0
    const previousCount = entriesByPeriod[1]?.count ?? 0
    const growthPercent =
        previousCount > 0
            ? Math.round(((currentCount - previousCount) / previousCount) * 100)
            : null

    const causalMetrics = { blocked_by: 0, resolved: 0, caused: 0 }
    const relationshipBreakdown: Record<string, number> = {
        evolves_from: 0,
        references: 0,
        implements: 0,
        clarifies: 0,
        response_to: 0,
        blocked_by: 0,
        resolved: 0,
        caused: 0,
    }
    for (const row of relTypeRows) {
        const canonicalKey = row.relationship_type === 'resolves' ? 'resolved' : row.relationship_type
        relationshipBreakdown[canonicalKey] = (relationshipBreakdown[canonicalKey] ?? 0) + row.count
        if (canonicalKey === 'blocked_by' || canonicalKey === 'resolved' || canonicalKey === 'caused') {
            causalMetrics[canonicalKey] = (causalMetrics[canonicalKey] ?? 0) + row.count
        }
    }

    const result: Record<string, unknown> = {
        totalEntries,
        entriesByType,
        entriesByPeriod,
        decisionDensity,
        relationshipComplexity: {
            totalRelationships,
            avgPerEntry: Math.round(avgPerEntry * 100) / 100,
            density,
        },
        activityTrend: {
            currentPeriod,
            previousPeriod,
            growthPercent,
        },
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
            ORDER BY entry_count DESC`
            )
            .all(...dateParams) as {
                project_number: number
                entry_count: number
                sample_issue_url: string | null
                sample_pr_url: string | null
            }[]

        result['projectBreakdown'] = projRows.map((r) => {
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
                    } catch {
                        // Ignore URL parsing errors
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

    return result
}
