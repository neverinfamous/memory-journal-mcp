/**
 * Memory Journal MCP Server - Optimizer Prompt Definitions
 *
 * Prompts: optimize-journal
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'

export function getOptimizerPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'optimize-journal',
            description: 'Guided database pruning and optimization workflow with live metrics',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (_args: Record<string, string>, db: IDatabaseAdapter) => {
                let statsSnippet = '_Could not fetch database statistics_'
                try {
                    interface Stats {
                        totalEntries?: unknown;
                        relationshipComplexity?: {
                            totalRelationships?: unknown;
                            avgPerEntry?: unknown;
                        };
                    }
                    const stats = db.getStatistics() as Stats
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
                        orphanCount = db.getOrphanCount()
                        if (typeof totalEntries === 'number' && totalEntries > 0) {
                            orphanDensity = Math.round((orphanCount / totalEntries) * 100) + '%'
                        }
                    } catch {
                        // fallback
                    }

                    statsSnippet = `**Live Database Health:**
- Total Entries: ${totalEntries}
- Active Relationships: ${totalRelationships} (Avg: ${avgPerEntry}/entry)
- Orphans: ${orphanCount} (${orphanDensity} density)`
                } catch {
                    // ignore
                }

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Journal Optimizer

You are initiating a guided workflow for intelligently pruning and optimizing the memory-journal-mcp database. Every operation uses the soft-delete system as a safe first pass.

${statsSnippet}

## Importance Score Guide
Entries have an \`importance\` score (0.00 to 1.00), which includes a baseline **recency boost** (usually \`+0.15\` for recent entries).
- **Base Importance**: To find truly low-value entries, look at their base score by checking \`importanceBreakdown.recency\`.
- **Review Threshold**: Recent orphans will score around \`0.15\` due to the recency boost. Consider \`baseScore === 0\` as the true threshold for soft-deletion.

## Safety Rules (MANDATORY)
1. **NEVER** use \`permanent: true\` unless explicitly asked to "hard delete".
2. **ALWAYS** call \`backup_journal\` before any batch delete. Abort if it fails.
3. **ALWAYS** show the user what will be deleted before mutating.
4. **NEVER** delete entries with \`significance_type\` set.
5. Max batch size: 50 entries.
6. **Log operations**: Create a journal entry with \`entry_type: 'maintenance'\` and tag \`database-optimizer\`.

## Identifying Orphans Safely
Do NOT use \`search_entries\` to dump the database. Use this pre-optimized Code Mode script in \`mj_execute_code\`. Because Code Mode executes directly against the sandboxed SQLite adapter, you can safely perform 500+ read iterations in milliseconds without triggering RPC serialization limits:

\`\`\`javascript
const orphans = [];
let cursor = undefined;
let processed = 0;

while (processed < 500) {
  const res = await mj.core.getRecentEntries({ limit: 50, cursor, workspace_id: 'default' });
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

## Optimization Workflows

Select one or more workflows to run:
1. **Importance Audit**: Find older orphans with a base importance of 0.0. Review for soft-deletion. (SKIP this if Orphans is 0).
2. **Type-Based Cleanup**: e.g., finding old \`technical_note\` or \`debug_log\` entries older than 30 days.

To proceed:
1. Review the live stats.
2. Tell the user your plan (which workflow you'll run).
3. Identify candidates using the Code Mode script above (MAX_QUERY_LIMIT is 500).
4. Ask for user confirmation before deleting!`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
