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
export function buildStatsSnippet(
    db: IDatabaseAdapter,
    workspaceId = '*',
    projectNumber?: number
): string {
    let statsSnippet = '_Could not fetch database statistics_'
    try {
        const stats = db.getStatistics(
            'week',
            undefined,
            undefined,
            projectNumber === undefined,
            workspaceId,
            projectNumber
        ) as Stats
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
        if (workspaceId === '*' && projectNumber !== undefined) {
            orphanCount = 'N/A (filtered by project_number)'
        } else {
            try {
                orphanCount = db.getOrphanCount(workspaceId)
                if (typeof totalEntries === 'number' && totalEntries > 0) {
                    orphanDensity = Math.round((orphanCount / totalEntries) * 100) + '%'
                }
            } catch {
                // fallback
            }
        }

        const projectBreakdownText = formatProjectBreakdown(stats)
        const causalMetricsText = formatRelationshipTypes(stats)
        const entryTypesText = formatTopEntryTypes(stats)

        const allTags =
            typeof db.listTags === 'function' ? db.listTags(workspaceId, projectNumber) : []
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
export function buildUnverifiedSnippet(
    db: IDatabaseAdapter,
    lookback: number,
    workspaceId = '*',
    projectNumber?: number
): string {
    let unverifiedSnippet = '_No unverified entries found._'
    try {
        const fetchLimit = Math.min(Math.max(lookback * 3, 50), 2000)
        const { entries } = db.getRecentEntries(
            fetchLimit,
            undefined,
            'timestamp',
            undefined,
            false,
            workspaceId,
            projectNumber
        )
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

export function formatAutoPruneScopeArg(targetProject: string | undefined): string {
    if (targetProject === undefined || targetProject === '') return '{ workspace_id: "*" }'
    const numMatch = /^#?([1-9]\d*)$/.exec(targetProject.trim())
    if (numMatch?.[1] !== undefined) {
        const parsed = Number(numMatch[1])
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return `{ project_number: ${String(parsed)} }`
        }
    }
    return `{ workspace_id: ${JSON.stringify(targetProject)} }`
}

export function buildOptimizeStandardsAndScripts(
    targetProject: string | undefined,
    scanLoopCondition: string,
    mjProjectNumber: number | undefined
): string {
    const logProjectSpec =
        mjProjectNumber !== undefined
            ? `\`workspace_id: 'memory-journal-mcp'\`, \`project_number: ${String(mjProjectNumber)}\``
            : "`workspace_id: 'memory-journal-mcp'` alongside `project_number` resolved dynamically from `memory://agent-context/memory-journal-mcp` or `mj.admin.listProjects()`"
    return `## Standard of a Complete Entry (7 Core Quality Dimensions)
An entry is considered incomplete and worthy of auditing/enrichment if it lacks any of the following:
1. **Workspace & Project Binding (TOP PRIORITY #1)**: Explicit \`workspace_id\` and \`project_number\` matching a registered workspace (MUST NOT be \`default\` or \`0\`).
2. **Significance Classification**: \`significance_type\` (e.g., \`architecture\`, \`decision\`, \`milestone\`, \`breakthrough\`, \`lesson_learned\`, \`blocker_resolved\`, \`release\`, \`security\`) and non-zero \`importance\` score (0.0 to 1.0).
3. **Trust & Validation**: \`trust_score\` (0.0 to 1.0) and non-\`none\` \`validation_status\` (\`passed\` or \`failed\`).
4. **Impact Assessment**: \`impact_score\` (0.0 to 1.0) reflecting downstream code or architecture impact.
5. **Relationships & Graph Anchors**: Inter-entry graph links (\`evolves_from\`, \`references\`, \`implements\`, \`resolved\`, \`blocked_by\`, \`caused\`, \`clarifies\`, \`response_to\`).
6. **Domain & Activity Tags**: Specific, searchable tags categorizing tech stack, subsystem, and activity type.
7. **Context & Git Lineage**: \`autoContext\` commit hashes, branch info, author context, or issue/PR links.

---

## Safety Rules (MANDATORY)
1. **ZERO TOLERANCE FOR UNASSIGNED / DEFAULT ENTRIES (TOP PRIORITY #1)**: There MUST be no unassigned entries or entries assigned to 'default'. If any exist, migrate them to their proper project immediately. The agent MUST investigate why they ended up unassigned/in 'default' and include a root cause analysis and fix plan in the report.
2. **NEVER** use \`permanent: true\` unless explicitly asked to "hard delete".
3. **ALWAYS** call \`backup_journal\` (and \`cleanup_backups\` with \`keep_count: 15\`) before any batch mutation/delete. Abort if backup fails.
4. **NEVER** delete entries with \`significance_type\` set.
5. Max batch size: 30 entries per \`mj_execute_code\` call so synchronous HNSW vector re-indexing stays well within the 30s worker timeout.
6. **Log operations**: Create a journal entry with \`entry_type: 'maintenance'\`, ${logProjectSpec}, and tags \`['cms', 'cms-02-nrem-consolidation', 'database-optimizer', 'maintenance']\`.
7. **Execution Scope**: Systematically process entries across registered projects in \`PROJECT_REGISTRY\` (or restricted to \`${targetProject !== undefined && targetProject !== '' ? targetProject : 'all'}\` if specified).

---

## Code Mode Inspection & Graph Dump Scripts
Do NOT use \`search_entries\` to dump the database. Use these pre-optimized Code Mode scripts in \`mj_execute_code\` for fast, sandboxed execution:

### 1. Scan for Unassigned / Default Workspace Entries (Automated Option A)
\`\`\`javascript
const unassigned = [];
let cursor = undefined;
let processed = 0;

${scanLoopCondition} {
  const res = await mj.core.getRecentEntries({ limit: 100, cursor, workspace_id: '*' });
  if (!res.entries || res.entries.length === 0) break;
  
  for (const entry of res.entries) {
    if (!entry.projectNumber || entry.projectNumber <= 0 || entry.workspaceId === 'default' || !entry.projectName) {
      unassigned.push({ id: entry.id, type: entry.entryType, workspace: entry.workspaceId, project: entry.projectNumber, snippet: entry.content ? entry.content.slice(0, 100) : '' });
    }
  }
  
  processed += res.entries.length;
  if (!res.hasMore) break;
  cursor = res.next_cursor;
}
return { processed, unassignedCount: unassigned.length, unassigned };
\`\`\`

### 2. Inspect Full Relationship Graph Structure for a Project Domain
\`\`\`javascript
const entries = await mj.core.getRecentEntries({ limit: 100, workspace_id: '*' });
const graph = [];

for (const entry of (entries.entries || [])) {
  if (entry.source === 'team') continue;
  const full = await mj.core.getEntryById({ entry_id: entry.id, workspace_id: '*' });
  if (full.success && full.relationships && full.relationships.length > 0) {
    graph.push({
      id: entry.id,
      project: entry.projectName,
      relationships: full.relationships.map(r => ({ fromId: r.fromEntryId, toId: r.toEntryId, type: r.relationshipType }))
    });
  }
}
return graph;
\`\`\``
}
