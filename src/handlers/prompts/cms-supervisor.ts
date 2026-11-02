/**
 * Memory Journal MCP Server - CMS REM Meta-Cognitive Supervisor Prompt Definitions
 *
 * Prompts: cms-rem-supervisor
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { z } from 'zod'
import { coerceNumber } from '../../utils/query-helpers.js'

export function getCmsSupervisorPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'cms-rem-supervisor',
            description:
                'REM Meta-Cognitive Supervisor & Self-Adaptation workflow (CMS-04). Audits recent NREM consolidation (CMS-02) mutations and soft-deletions, mines cross-run telemetry and unresolved blockers, and enforces the Dirty-Tree Conditional Single-Pass Validation Gate.',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'lookbackHours',
                    description: 'Hours to look back for CMS-02 maintenance entries and soft-deleted entries (default: 24)',
                    required: false,
                },
                {
                    name: 'autoRestore',
                    description: 'Set to "true" to automatically restore any high-significance entry erroneously soft-deleted (default: true)',
                    required: false,
                },
            ],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const schema = z.object({
                    lookbackHours: z.preprocess(
                        coerceNumber,
                        z.number().int().min(1).max(168).optional().default(24)
                    ),
                    autoRestore: z.preprocess(
                        (val) => val !== 'false' && val !== false,
                        z.boolean().optional().default(true)
                    ),
                })

                const parsed = schema.safeParse(args ?? {})
                const lookbackHours = parsed.success ? parsed.data.lookbackHours : 24
                const autoRestore = parsed.success ? parsed.data.autoRestore : true

                let latestNremSnippet = '_No recent CMS-02 / database-optimizer entry found._'
                try {
                    const searchRes = db.searchEntries('', {
                        tags: ['database-optimizer'],
                        limit: 3,
                        workspaceId: '*',
                    })
                    const latest = searchRes.entries[0]
                    if (latest !== undefined) {
                        latestNremSnippet = `ID: #${String(latest.id)} | Timestamp: ${latest.timestamp} | Type: ${latest.entryType} | Tags: ${latest.tags.join(', ')}\n${latest.content.slice(0, 1200)}`
                    }
                } catch {
                    // ignore
                }

                let deletedSnippet = '_No soft-deleted entries found._'
                let flaggedDeletionsCount = 0
                try {
                    const deletedRes = db.getDeletedEntries({ limit: 25, workspaceId: '*' })
                    if (deletedRes.entries.length > 0) {
                        const rows = deletedRes.entries.map((e) => {
                            const isHighValue =
                                e.significanceType !== null ||
                                (e.impactScore !== undefined && e.impactScore >= 0.5)
                            if (isHighValue) flaggedDeletionsCount++
                            const flag = isHighValue ? '⚠️ [HIGH-VALUE CANDIDATE FOR RESTORE] ' : ''
                            return `${flag}ID: #${String(e.id)} | Type: ${e.entryType} | Significance: ${String(e.significanceType)} | Impact: ${String(e.impactScore)} | DeletedAt: ${String(e.deletedAt)}\nSnippet: ${e.content.slice(0, 140)}`
                        })
                        deletedSnippet = `Total Soft-Deleted Count: ${String(deletedRes.count)} (Flagged High-Value in recent 25: ${String(flaggedDeletionsCount)})\n` + rows.join('\n---\n')
                    }
                } catch {
                    // ignore
                }

                let orphanCount: number | string = 'Unknown'
                let totalEntries: number | string = 'Unknown'
                try {
                    totalEntries = db.getActiveEntryCount('*')
                    orphanCount = db.getOrphanCount('*')
                } catch {
                    // ignore
                }

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# CMS-04: REM Meta-Cognitive Supervisor & Self-Adaptation Workflow

You are executing the **REM Meta-Cognitive Supervisor (\`CMS-04\`)** workflow across the global memory journal ecosystem.
**Lookback Window**: \`${String(lookbackHours)}h\` | **Auto-Restore High-Value Deletions**: \`${String(autoRestore)}\`
**Active Global Entries**: \`${String(totalEntries)}\` | **Current Orphans**: \`${String(orphanCount)}\`

## Latest NREM Consolidation (\`CMS-02\`) Report Snapshot
${markUntrustedContent(latestNremSnippet)}

## Recent Soft-Deleted Entries Audit
${markUntrustedContent(deletedSnippet)}

---

## Execution Protocol (Execute All 4 Phases Without Stopping)

### Phase A — Post-NREM Supervisor Audit & Safety Rollback
1. **Verify \`CMS-02\` Pruning Safety**:
   - Inspect the recent soft-deleted entries above (or query \`await mj.admin.listDeletedEntries({ limit: 50 })\` via \`mj_execute_code\`).
   - If any soft-deleted entry from the last \`${String(lookbackHours)}h\` has \`significanceType !== null\`, \`impactScore >= 0.5\`, or active relationships, **immediately restore it** via \`await mj.admin.restoreEntry({ entry_id })\` and record the false-positive pruning pattern.
2. **Global Invariant Verification**:
   - Confirm \`0\` unassigned (\`workspaceId === 'default'\` or \`projectNumber <= 0\`) entries exist across \`workspace_id: '*'\`.
   - Check vector index parity via \`await mj.search.getVectorIndexStats({})\`; if vector count drifts from active entry count, run \`await mj.admin.rebuildVectorIndex({})\`.

### Phase B — Cross-Run Experience & Telemetry Mining
1. Inspect \`logs/agent-issues.jsonl\` and \`logs/mcp-audit.jsonl\` for recurring tool validation failures, parameter hallucinations, or unhandled edge cases.
2. Review the **Root-Cause Investigation** section of the latest \`CMS-02\` maintenance entry and recent \`session-summary\` \`## Unfinished / Blocked\` sections across projects.
3. Formulate targeted, minimal code/schema/prompt adaptations for any recurring friction discovered (e.g., adding parameter alias coercions in \`src/handlers/tools/schemas/hallucination-healer.ts\`, refining prompt instructions in \`src/handlers/prompts/\`, or updating \`.agents/workflows/heal-mcp-server.md\`).

### Phase C — Batched Adaptation & Dirty-Tree Conditional Single-Pass Validation Gate
> [!IMPORTANT]
> **LOAD OPTIMIZATION INVARIANT (DIRTY-TREE CONDITIONAL SINGLE-PASS VALIDATION GATE)**:
> Full-suite validation (\`lint\`, \`typecheck\`, \`build\`, \`vitest\`, \`playwright\`) is resource-intensive and MUST ONLY run when repository files have actually been modified.
> **HITL CODE MODIFICATION GUARDRAIL**: Do NOT modify executable source code or global environment files without explicit user approval unless running in an explicitly approved autonomous maintenance session.

1. Apply all approved code, schema, prompt, or documentation fixes in a single cohesive batch.
2. Check working tree status via \`bun .\\.agents\\scripts\\get-git-history-json.ts --uncommitted --stats\`.
3. **If \`0\` files are modified/untracked in \`memory-journal-mcp\`**:
   - **SKIP** \`pnpm run lint\`, \`pnpm run typecheck\`, \`pnpm run build\`, \`npx vitest run\`, and \`npx playwright test\` completely! Proceed directly to Phase D.
4. **If \`>= 1\` files are modified in \`memory-journal-mcp\`**:
   - Terminate all subagents (\`manage_subagents\` \`Action: 'kill_all'\`) and verify no competing \`vitest\`, \`playwright\`, or \`tsc\` process is active.
   - Run the 5-stage validation gate **strictly sequentially once** (never concurrently):
     1. \`pnpm run lint\`
     2. \`pnpm run typecheck\`
     3. \`pnpm run build\`
     4. \`npx vitest run\`
     5. \`npx playwright test\`
   - Commit the verified changes via \`bun .\\.agents\\scripts\\commit.ts --msg "fix(cms): <summary>" --impact 0.5 --confidence 0.95 --validation passed --journal --add .\`.

### Phase D — Telemetry Cleanup & Supervisor Journal Entry
1. If \`logs/agent-issues.jsonl\` contained issues that were resolved and validated in Phase C, clear \`logs/agent-issues.jsonl\`.
2. Log the completed supervisor run in \`memory-journal-mcp\` (project #5) using \`mj.core.createEntry\` with:
   - \`entry_type: 'maintenance'\`
   - \`significance_type: 'milestone'\`
   - \`tags: ['cms', 'cms-04-rem-supervisor', 'meta-learning', 'maintenance']\`
   - \`trust_score: 1.0\`, \`impact_score: 0.6\`, \`validation_status: 'passed'\`
   - Link via \`evolves_from\` to the prior \`cms-04-rem-supervisor\` entry and via \`references\` to the latest \`cms-02-nrem-consolidation\` entry.
`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
