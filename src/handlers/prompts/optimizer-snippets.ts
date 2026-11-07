/**
 * Snippet builders for the optimize-journal prompt (database health stats, unverified entries).
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { logger } from '../../utils/logger.js'

interface Stats {
    totalEntries?: unknown
    relationshipComplexity?: {
        totalRelationships?: unknown
        avgPerEntry?: unknown
        density?: unknown
    }
    projectBreakdown?: {
        name?: string
        project_number: number
        entry_count: number
    }[]
    entriesByType?: Record<string, number>
    causalMetrics?: Record<string, number>
    relationshipBreakdown?: Record<string, number>
}

function formatRelationshipTypes(stats: Stats): string {
    const relSource = stats.relationshipBreakdown ?? stats.causalMetrics
    if (relSource === undefined) return ''
    const ref = relSource['references'] ?? 0
    const imp = relSource['implements'] ?? 0
    const evo = relSource['evolves_from'] ?? 0
    const res = relSource['resolved'] ?? relSource['resolves'] ?? 0
    const blk = relSource['blocked_by'] ?? 0
    const cau = relSource['caused'] ?? 0
    const cla = relSource['clarifies'] ?? 0
    const rsp = relSource['response_to'] ?? 0
    return `\n  - Relationship Types: ${String(ref)} references | ${String(imp)} implements | ${String(evo)} evolves_from | ${String(res)} resolved | ${String(blk)} blocked_by | ${String(cau)} caused | ${String(cla)} clarifies | ${String(rsp)} response_to`
}

function formatProjectBreakdown(stats: Stats): string {
    if (!stats.projectBreakdown || !Array.isArray(stats.projectBreakdown)) return ''
    let text = '\n\n**Project Breakdown:**\n| Project Name | Project # | Entries |\n|---|---|---|\n'
    for (const p of stats.projectBreakdown) {
        const name =
            p.name !== undefined && p.name !== '' ? p.name : `Project ${String(p.project_number)}`
        text += `| ${name} | ${String(p.project_number)} | ${String(p.entry_count)} |\n`
    }
    return text
}

function formatTopEntryTypes(stats: Stats): string {
    if (!stats.entriesByType) return ''
    const types = Object.entries(stats.entriesByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k} (${String(v)})`)
        .join(', ')
    return `\n- Top Entry Types: ${types}`
}

/** Build the "Global Database Health" markdown block, or a placeholder if stats are unavailable. */
export function buildStatsSnippet(db: IDatabaseAdapter): string {
    let statsSnippet = '_Could not fetch database statistics_'
    try {
        const stats = db.getStatistics('week', undefined, undefined, true, '*') as Stats
        const totalEntries =
            typeof stats.totalEntries === 'number' ? stats.totalEntries : 'Unknown'

        let totalRelationships: number | string = 'Unknown'
        let avgPerEntry: number | string = 'Unknown'
        let graphDensity = 'Unknown'
        const rc = stats.relationshipComplexity
        if (rc !== null && rc !== undefined && typeof rc === 'object') {
            totalRelationships =
                typeof rc.totalRelationships === 'number' ? rc.totalRelationships : 'Unknown'
            avgPerEntry = typeof rc.avgPerEntry === 'number' ? rc.avgPerEntry : 'Unknown'
            if (typeof rc.density === 'number') {
                graphDensity = (rc.density * 100).toFixed(2) + '%'
            }
        }

        let orphanCount: number | string = 'Unknown'
        let orphanDensity = 'Unknown'
        try {
            orphanCount = db.getOrphanCount('*')
            if (typeof totalEntries === 'number' && totalEntries > 0) {
                orphanDensity = Math.round((orphanCount / totalEntries) * 100) + '%'
            }
        } catch {
            // fallback
        }

        const projectBreakdownText = formatProjectBreakdown(stats)
        const causalMetricsText = formatRelationshipTypes(stats)
        const entryTypesText = formatTopEntryTypes(stats)

        const allTags = typeof db.listTags === 'function' ? db.listTags('*') : []
        const totalTags = allTags.length

        statsSnippet = `**Global Database Health & Relationship Graph Metrics:**
- Total Entries: ${String(totalEntries)}
- Total Unique Tags: ${String(totalTags)}
- Active Relationship Links: ${String(totalRelationships)} (Avg: ${String(avgPerEntry)}/entry | Density: ${graphDensity})${causalMetricsText}${entryTypesText}
- Orphans: ${String(orphanCount)} (${orphanDensity} density)${projectBreakdownText}`
    } catch (err) {
        logger.debug('Could not compute optimizer database health stats', {
            module: 'Optimizer',
            error: err instanceof Error ? err.message : String(err),
        })
    }
    return statsSnippet
}

/** Build the list of recent entries that are unverified or low-trust. */
export function buildUnverifiedSnippet(db: IDatabaseAdapter, lookback: number): string {
    let unverifiedSnippet = '_No unverified entries found._'
    try {
        const { entries } = db.getRecentEntries(50, undefined, 'timestamp', undefined, false, '*')
        const unverified = entries
            .filter(
                (e) =>
                    e.validationStatus === 'none' ||
                    (e.trustScore !== undefined && e.trustScore < 0.9)
            )
            .slice(0, lookback)
        if (unverified.length > 0) {
            unverifiedSnippet = unverified
                .map((e) => {
                    return `ID: ${String(e.id)} | Type: ${e.entryType} | Tags: ${e.tags.join(', ')}\nTrust: ${String(e.trustScore)} | Impact: ${String(e.impactScore)} | Validation: ${String(e.validationStatus)}\nContent:\n${e.content}\n---`
                })
                .join('\n')
        }
    } catch {
        unverifiedSnippet = '_Could not fetch unverified entries_'
    }
    return unverifiedSnippet
}
