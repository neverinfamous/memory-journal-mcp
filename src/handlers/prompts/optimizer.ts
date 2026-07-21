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

1. **Orphan Resolution & Project Consolidation (Highest Priority)**: Dealing with "Others" (entries not in active projects) is a priority option. Audit the entries for historical bugs and anomalies:
   - *Miscategorized Projects*: Entries missing a \`project_number\` or assigned to hallucinated projects (e.g. parsed from absolute file paths). **Inform the user of the situation and get their approval before consolidating them to the correct, active project.**
   - *Missing Metadata*: Audit for missing timestamps or missing impact scores. Inject appropriate defaults or fixes for these anomalies.
2. **Agent-Managed Cognitive Optimization (Subagent Pattern)**: 
   - **Scope**: Process ONE project at a time.
   - **Batching**: Extract entries in manageable optimal batches of 30-50.
   - **Parallel Subagents**: Employ specialized subagents to perform the cognitive load (inferring tags, relationships, cleaning noise/test artifacts, checking project assignment). Ensure you explicitly kill subagents when their tasks are completed.
   - **Execution Paradigm**: For most updates, compile the subagent outputs into a JavaScript Code Mode payload and use the \`mj.updateEntry(id, payload)\` API via \`mj_execute_code\`. This transparently handles the connection and any database encryption.
   - **Bulk Execution Fallback**: Required if writing a standalone script for massive bulk operations (Code Mode blocks \`fs.\`, preventing you from reading local JSON batch files): (1) You MUST run it using Node (e.g., \`pnpm tsx\`) since the native \`better-sqlite3\` driver is incompatible with \`bun\`. (2) If the database is encrypted, you MUST inject the \`DB_ENCRYPTION_KEY\` into the shell environment natively (e.g., \`$env:DB_ENCRYPTION_KEY="<key>"; pnpm tsx script.ts\`). The \`NativeConnectionManager\` strictly reads from \`process.env\` and ignores the \`encryptionKey\` property passed in the adapter config object. (3) If updating entries outside the \`default\` workspace using \`DatabaseAdapter\`, you MUST explicitly include \`workspaceId: '*'\` directly in your update payload (e.g., \`db.updateEntry(id, { ...payload, workspaceId: '*' })\`) to prevent \`ConflictError\`s. Setting it in the constructor config is insufficient.
3. **Importance Audit** (Pruning): Find older orphans with a base importance of 0.0. Review for soft-deletion. (SKIP this if Orphans is 0).
4. **Type-Based Cleanup** (Pruning): e.g., finding old \`technical_note\` or \`debug_log\` entries older than 30 days.
5. **Tier 1: Fast Sanity Check** (Verification): For the \`Unverified Recent Entries\` provided above, instruct the agent to use the native MCP tool via Code Mode (e.g. \`mj.git.getCommitHistory({ techDebtAudit: true })\`) to verify that commits match the entry claims. Ensure structural changes were correctly reflected by running \`bun scripts/update-code-map.ts\` if applicable.
6. **Tier 2: Deep Code & Drift Verification** (Verification): Use \`gh copilot\` for code validation (if available and desired, otherwise fallback to standard file reading and manual validation). Verify semantic drift against \`src/filtering/tool-constants.ts\` (the SSoT) and the \`memory://instructions\` resource. Mandate that any new tools claimed in an entry MUST have corresponding testing coverage explicitly verified in \`test-server/codemode\`, \`test-server/standard\`, or \`test-server/usability\`. Remind agents to use \`bun scripts/update-code-map.ts\` instead of manually editing \`code-map.md\`.

### Scoring Protocol for Verification:
After a verification workflow, you MUST explicitly update the target entries using \`mj_execute_code\` (e.g. \`mj.updateEntry(id, payload)\`):
- **Verified**: If claims are true, increase \`trust_score\` to \`0.9\` or \`1.0\` and set \`validation_status\` to \`"passed"\`.
- **Failed**: If claims are false or hallucinatory, heavily downgrade \`trust_score\` (e.g. \`0.1\`) and set \`validation_status\` to \`"failed"\`.
- **Impact**: Adjust \`impact_score\` if the original claim exaggerated the work done.

${autoRun ? `To proceed (AUTO-RUN MODE):
1. Review the live stats and the unverified recent entries.
2. You are running in an autonomous mode. DO NOT ask the user for confirmation or output plans for them to review.
3. Automatically select the most appropriate workflows (Pruning, Consolidation, Tier 1/Tier 2 Verification) based on the unverified entries and stats.
4. Execute the chosen workflows autonomously. If pruning, identify candidates using the Code Mode script above (MAX_QUERY_LIMIT is 500) and soft-delete them. If verifying, apply Tier 1 or Tier 2 steps and use the Scoring Protocol to update entries.
5. Once all automatic optimizations and verifications are complete, output a single concise Markdown summary of all actions taken, any anomalies found, and the final state of the database.` : `To proceed:
1. Review the live stats and the unverified recent entries.
2. Output a concise Markdown table breaking down the total entries by project name to the user (use the Project Breakdown data provided above).
3. Explicitly list the available workflows (Pruning, Consolidation, Tier 1/Tier 2 Verification) so the user understands their options. Let them know they can request verification on specific entries (even if they already passed) or use different subagents for the task.
4. Tell the user your initial plan or recommendation based on the data.
5. If pruning, identify candidates using the Code Mode script above (MAX_QUERY_LIMIT is 500).
6. If verifying, apply Tier 1 or Tier 2 steps, and then use the Scoring Protocol to update entries via \`mj_execute_code\`.
7. Ask for user confirmation before deleting or consolidating projects, or before running intensive verification!`}`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
