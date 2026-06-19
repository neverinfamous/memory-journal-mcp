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
                    const stats = db.getStatistics()
                    const totalEntries = typeof stats['totalEntries'] === 'number' ? stats['totalEntries'] : 'Unknown'
                    const deletedEntries = typeof stats['deletedEntries'] === 'number' ? stats['deletedEntries'] : 'Unknown'
                    const totalRelationships = typeof stats['totalRelationships'] === 'number' ? stats['totalRelationships'] : 'Unknown'
                    const orphanCount = typeof stats['orphanCount'] === 'number' ? stats['orphanCount'] : 'Unknown'
                    const densityRaw = stats['density']
                    const density = typeof densityRaw === 'number' ? densityRaw.toFixed(2) : 'Unknown'

                    statsSnippet = `**Live Database Health:**
- Total Entries: ${totalEntries}
- Soft-Deleted: ${deletedEntries}
- Active Relationships: ${totalRelationships}
- Orphans (0 edges): ${orphanCount}
- Graph Density: ${density}`
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
Entries scoring \`0.00\` have zero structural value (no links, low length, etc) and are safe to soft-delete. Entries \`0.01-0.14\` should be reviewed.

## Safety Rules (MANDATORY)
1. **NEVER** use \`permanent: true\` unless explicitly asked to "hard delete".
2. **ALWAYS** call \`backup_journal\` before any batch delete. Abort if it fails.
3. **ALWAYS** show the user what will be deleted before mutating.
4. **NEVER** delete entries with \`significance_type\` set.
5. Max batch size: 50 entries.
6. **Log operations**: Create a journal entry with \`entry_type: 'maintenance'\` and tag \`database-optimizer\`.

## Optimization Workflows

Select one or more workflows to run:
1. **Importance Audit**: Find all active entries with importance = 0.0. Review for soft-deletion.
2. **Orphan Cleanup**: Find active entries with 0 relationships and low importance.
3. **Type-Based Cleanup**: e.g., finding old \`technical_note\` or \`debug_log\` entries older than 30 days.

To proceed:
1. Review the live stats.
2. Tell the user your plan (which workflow you'll run).
3. Identify candidates using \`search_entries\` or \`mj_execute_code\`.
4. Ask for user confirmation before deleting!`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
