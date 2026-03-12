import type { EntriesSharedContext } from './shared.js'
import { validateDateFormatPattern } from '../../../utils/security-utils.js'

export function getStatistics(
    context: EntriesSharedContext,
    groupBy: 'day' | 'week' | 'month' | 'year' = 'week',
    startDate?: string,
    endDate?: string,
    projectBreakdown?: boolean
): Record<string, unknown> {
    const { db } = context

    let dateFilter = ''
    const dateParams: unknown[] = []
    if (startDate) {
        dateFilter += ' AND DATE(timestamp) >= DATE(?)'
        dateParams.push(startDate)
    }
    if (endDate) {
        dateFilter += ' AND DATE(timestamp) <= DATE(?)'
        dateParams.push(endDate)
    }

    let totalEntries: number
    const entriesByType: Record<string, number> = {}

    if (dateParams.length > 0) {
        const countRow = db.prepare(`SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter}`).get(...dateParams) as { count: number }
        totalEntries = countRow?.count ?? 0

        const typeRows = db.prepare(`SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL${dateFilter} GROUP BY entry_type`).all(...dateParams) as { entry_type: string; count: number }[]
        for (const row of typeRows) {
            entriesByType[row.entry_type] = row.count
        }
    } else {
        const countRow = db.prepare('SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL').get() as { count: number }
        totalEntries = countRow?.count ?? 0
        
        const typeRows = db.prepare(`SELECT entry_type, COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL GROUP BY entry_type`).all() as { entry_type: string; count: number }[]
        for (const row of typeRows) {
            entriesByType[row.entry_type] = row.count
        }
    }

    const dateFormat = validateDateFormatPattern(groupBy === 'year' ? 'month' : groupBy)
    const periodRows = db.prepare(`SELECT
        strftime('${dateFormat}', timestamp) as period,
        COUNT(*) as total_count,
        SUM(CASE WHEN significance_type IS NOT NULL THEN 1 ELSE 0 END) as significant_count
    FROM memory_journal
    WHERE deleted_at IS NULL${dateFilter}
    GROUP BY period
    ORDER BY period DESC
    LIMIT 52`).all(...dateParams) as { period: string; total_count: number; significant_count: number }[]

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

    const relCountRow = db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number }
    const relTypeRows = db.prepare(`
        SELECT relationship_type, COUNT(*) as count
        FROM relationships
        WHERE relationship_type IN ('blocked_by', 'resolved', 'caused')
        GROUP BY relationship_type
    `).all() as { relationship_type: 'blocked_by' | 'resolved' | 'caused'; count: number }[]

    const totalRelationships = relCountRow?.count ?? 0
    const avgPerEntry = totalEntries > 0 ? totalRelationships / totalEntries : 0

    const currentPeriod = entriesByPeriod[0]?.period ?? ''
    const previousPeriod = entriesByPeriod[1]?.period ?? ''
    const currentCount = entriesByPeriod[0]?.count ?? 0
    const previousCount = entriesByPeriod[1]?.count ?? 0
    const growthPercent = previousCount > 0 ? Math.round(((currentCount - previousCount) / previousCount) * 100) : null

    const causalMetrics = { blocked_by: 0, resolved: 0, caused: 0 }
    for (const row of relTypeRows) {
        causalMetrics[row.relationship_type] = row.count
    }

    const result: Record<string, unknown> = {
        totalEntries,
        entriesByType,
        entriesByPeriod,
        decisionDensity,
        relationshipComplexity: {
            totalRelationships,
            avgPerEntry: Math.round(avgPerEntry * 100) / 100,
        },
        activityTrend: {
            currentPeriod,
            previousPeriod,
            growthPercent,
        },
        causalMetrics,
    }

    if (startDate || endDate) {
        result['dateRange'] = {
            startDate: startDate ?? '',
            endDate: endDate ?? '',
        }
    }

    if (projectBreakdown) {
        const projRows = db.prepare(`SELECT project_number, COUNT(*) as entry_count
            FROM memory_journal
            WHERE deleted_at IS NULL AND project_number IS NOT NULL${dateFilter}
            GROUP BY project_number
            ORDER BY entry_count DESC`).all(...dateParams) as { project_number: number; entry_count: number }[]
        
        result['projectBreakdown'] = projRows.map((r) => ({
            project_number: r.project_number,
            entry_count: r.entry_count,
        }))
    }

    return result
}
