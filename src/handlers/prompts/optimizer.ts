/**
 * Memory Journal MCP Server - Optimizer Prompt Definitions
 *
 * Prompts: optimize-journal
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { z } from 'zod'
import { coerceNumber } from '../../utils/query-helpers.js'

export function getOptimizerPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'optimize-journal',
            description: 'Guided database pruning and verification workflow. Optional arguments: `lookback` (Number of recent entries to audit, default: 10, max: 50), `autoRun` (boolean, run autonomously without asking for confirmation, default: false).',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const schema = z.object({
                    lookback: z.preprocess(
                        coerceNumber,
                        z.number().int().min(1).max(50).optional().default(10)
                    ),
                    autoRun: z.preprocess(
                        (val) => val === 'true' || val === true,
                        z.boolean().optional().default(false)
                    ),
                })

                const parsed = schema.safeParse(args ?? {})
                const limit = parsed.success ? parsed.data.lookback : 10
                const autoRun = parsed.success ? parsed.data.autoRun : false

                let statsSnippet = '_Could not fetch database statistics_'
                try {
                    interface Stats {
                        totalEntries?: unknown;
                        relationshipComplexity?: {
                            totalRelationships?: unknown;
                            avgPerEntry?: unknown;
                        };
                        projectBreakdown?: { name?: string; project_number: number; entry_count: number }[];
                        entriesByType?: Record<string, number>;
                        causalMetrics?: Record<string, number>;
                    }
                    const stats = db.getStatistics('week', undefined, undefined, true, '*') as Stats
                    const totalEntries = typeof stats.totalEntries === 'number' ? stats.totalEntries : 'Unknown'
                    
                    let totalRelationships: number | string = 'Unknown'
                    let avgPerEntry: number | string = 'Unknown'
                    const rc = stats.relationshipComplexity
                    if (rc !== null && typeof rc === 'object') {
                        totalRelationships = typeof rc.totalRelationships === 'number' ? rc.totalRelationships : 'Unknown'
                        avgPerEntry = typeof rc.avgPerEntry === 'number' ? rc.avgPerEntry : 'Unknown'
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

                    let projectBreakdownText = ''
                    if (stats.projectBreakdown && Array.isArray(stats.projectBreakdown)) {
                        projectBreakdownText = '\n\n**Project Breakdown:**\n| Project Name | Project # | Entries |\n|---|---|---|\n'
                        for (const p of stats.projectBreakdown) {
                            const name = p.name || `Project ${p.project_number}`
                            projectBreakdownText += `| ${name} | ${p.project_number} | ${p.entry_count} |\n`
                        }
                    }

                    let causalMetricsText = ''
                    if (stats.causalMetrics) {
                        const blockedBy = stats.causalMetrics['blocked_by'] ?? 0
                        const resolved = stats.causalMetrics['resolved'] ?? 0
                        const caused = stats.causalMetrics['caused'] ?? 0
                        causalMetricsText = `\n  - Types: ${blockedBy} blocked_by | ${resolved} resolved | ${caused} caused`
                    }

                    let entryTypesText = ''
                    if (stats.entriesByType) {
                        const types = Object.entries(stats.entriesByType)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5) // top 5
                            .map(([k, v]) => `${k} (${v})`)
                            .join(', ')
                        entryTypesText = `\n- Top Entry Types: ${types}`
                    }

                    const allTags = typeof db.listTags === 'function' ? db.listTags() : []
                    const totalTags = allTags.length

                    statsSnippet = `**Global Database Health:**
- Total Entries: ${totalEntries}
- Total Unique Tags: ${totalTags}
- Active Relationships: ${totalRelationships} (Avg: ${avgPerEntry}/entry)${causalMetricsText}${entryTypesText}
- Orphans: ${orphanCount} (${orphanDensity} density)${projectBreakdownText}`
                } catch {
                    // ignore
                }

                let unverifiedSnippet = '_No unverified entries found._'
                try {
                    const { entries } = db.getRecentEntries(50)
                    const unverified = entries.filter(e => e.validationStatus === 'none' || (e.trustScore !== undefined && e.trustScore < 0.9)).slice(0, limit)
                    if (unverified.length > 0) {
                        unverifiedSnippet = unverified.map(e => {
                            return `ID: ${e.id} | Type: ${e.entryType} | Tags: ${e.tags.join(', ')}\nTrust: ${e.trustScore} | Impact: ${e.impactScore} | Validation: ${e.validationStatus}\nContent:\n${e.content}\n---`
                        }).join('\n')
                    }
                } catch {
                    unverifiedSnippet = '_Could not fetch unverified entries_'
                }

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Journal Optimizer & Verification

You are initiating a guided workflow for intelligently pruning and verifying the global memory journal database. Every operation uses the soft-delete system as a safe first pass.

${statsSnippet}

## Unverified Recent Entries
${markUntrustedContent(unverifiedSnippet)}

## Importance Score Guide
Entries have an \`importance\` score (0.00 to 1.00), which includes a baseline **recency boost** (usually \`+0.15\` for recent entries).
- **Base Importance**: To find truly low-value entries, look at their base score by checking \`importanceBreakdown.recency\`.
- **Review Threshold**: Recent orphans will score around \`0.15\` due to the recency boost. Consider \`baseScore === 0\` as the true threshold for soft-deletion.

## Safety Rules (MANDATORY)
1. **NEVER** use \`permanent: true\` unless explicitly asked to "hard delete".
2. **ALWAYS** call \`backup_journal\` before any batch delete. Abort if it fails.
${autoRun ? '3. **AUTO-RUN MODE**: You have pre-approval to soft-delete low-value entries (e.g. orphans with base score 0). Proceed without asking.' : '3. **ALWAYS** show the user what will be deleted before mutating.'}
4. **NEVER** delete entries with \`significance_type\` set.
5. Max batch size: 50 entries.
6. **Log operations**: Create a journal entry with \`entry_type: 'maintenance'\` and tag \`database-optimizer\`.
7. **Scope Limitation**: ALWAYS narrow the scope to doing ONE project at a time. The user will invoke this prompt sequentially for multiple projects.

## Identifying Orphans Safely
Do NOT use \`search_entries\` to dump the database. Use this pre-optimized Code Mode script in \`mj_execute_code\`. Because Code Mode executes directly against the sandboxed SQLite adapter, you can safely perform 500+ read iterations in milliseconds without triggering RPC serialization limits:

\`\`\`javascript
const orphans = [];
let cursor = undefined;
let processed = 0;

while (processed < 500) {
  const res = await mj.core.getRecentEntries({ limit: 50, cursor, workspace_id: '<target_workspace_id>' });
  if (!res.entries || res.entries.length === 0) break;
  
  for (const entry of res.entries) {
    const full = await mj.core.getEntryById({ id: entry.id });
    if (full.success && full.relationships && full.relationships.length === 0) {
      const baseScore = full.importance - (full.importanceBreakdown?.recency || 0);
      if (baseScore === 0) orphans.push({ id: entry.id, type: entry.entryType });
    }
  }
  
  processed += res.entries.length;
  if (!res.hasMore) break;
  cursor = res.next_cursor;
}
return orphans;
\`\`\`

## Optimization & Verification Workflows

Select one or more workflows to run based on the user's request or the presence of unverified entries. **Crucially, prioritize high-quality, agent-managed editing over blind predetermined scripts.**

1. **Multi-Project Iteration (Mandatory Rule)**: Iterate systematically across **ALL registered projects** in \`PROJECT_REGISTRY\` (e.g. \`mysql-mcp\`, \`adamic\`, \`do-test-worker\`, etc.). Do NOT restrict optimization to a single workspace unless explicitly directed by the user.
2. **Agent-Managed Cognitive Optimization (30–60 Entry Batches)**: 
   - **Full Content Reading**: Agents/subagents MUST read entries in full (content, tags, relationships, importance score, trust score, impact score) in manageable batches of **30–60 entries** at a time.
   - **Cognitive Evaluation Criteria**:
     - *Metadata & Tag Enrichment*: Infer missing tags, verify significance types, and set correct project numbers.
     - *Relationship Graphing*: Discover and record inter-entry connections (\`evolves_from\`, \`references\`, \`implements\`, \`blocked_by\`, \`resolved\`).
     - *Noise Pruning*: Soft-delete zero-value debug/test noise (where \`baseScore === 0\` and no significance or relationships exist).
     - *Scoring*: Update \`trust_score\` (0.0 to 1.0), \`impact_score\` (0.0 to 1.0), and \`validation_status\` ('passed'/'failed'/'none').
   - **Execution Paradigm**: Compile subagent outputs into a JavaScript Code Mode payload using \`mj.updateEntry(id, payload)\` via \`mj_execute_code\`. Use \`target_workspace_id\` if migrating entries between workspace boundaries.
3. **Orphan Resolution & Project Consolidation**: Audit entries unassigned to projects or in \`default\`:
   - *Miscategorized Projects*: Migrate entries to the correct project workspace using \`target_workspace_id\`.
4. **Importance Audit** (Pruning): Find older orphans with a base importance of 0.0. Soft-delete after creating a backup.
5. **Tier 1 & Tier 2 Verification**: Use \`mj.git.getCommitHistory()\` and file inspection to verify entry claims. Adjust \`trust_score\` and \`validation_status\` accordingly.

${autoRun ? `To proceed (AUTO-RUN MODE):
1. Review the live stats and the unverified recent entries across all projects.
2. You are running in an autonomous mode. DO NOT ask the user for confirmation or output plans for them to review.
3. Systematically process each registered project in batches of 30–60 entries using the Cognitive Reading Protocol.
4. Execute mutations via Code Mode using \`mj_execute_code\`.
5. Output a single concise Markdown summary of all actions taken, any anomalies found, and the final state of all project workspaces.` : `To proceed:
1. Review the live stats and output a Markdown table breaking down entry counts for ALL registered projects.
2. Explicitly list the available workflows (Cognitive Batch Optimization, Consolidation, Verification) for each project.
3. Recommend starting with the project having the largest unverified entry count in batches of 30–60 entries.
4. IDENTIFY candidates using Code Mode scripts and present them in manageable 30–60 entry batches.
5. Ask for user confirmation before executing batch mutations.`}`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
