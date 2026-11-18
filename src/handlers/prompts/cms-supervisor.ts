/**
 * Memory Journal MCP Server - CMS REM Meta-Cognitive Supervisor Prompt Definitions
 *
 * Prompts: cms-rem-supervisor
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef, PromptMessage } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { exactRegistryKey } from '../../utils/write-scope.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { z } from 'zod'
import { ValidationError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'

function parseSupervisorLookbackHours(val: unknown): unknown {
    if (val === undefined) return undefined
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (trimmed === '') return undefined
        if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
    }
    return val
}

function parseSupervisorBoolean(val: unknown): unknown {
    if (val === undefined) return undefined
    if (typeof val === 'boolean') return val
    if (typeof val === 'string') {
        const normalized = val.trim().toLowerCase()
        if (normalized === '') return undefined
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
            return true
        }
        if (
            normalized === 'false' ||
            normalized === '0' ||
            normalized === 'no' ||
            normalized === 'off' ||
            normalized === 'disabled'
        ) {
            return false
        }
    }
    return val
}

const cmsSupervisorArgsSchema = z.object({
    lookbackHours: z.preprocess(
        parseSupervisorLookbackHours,
        z.number().int().min(1).max(168).optional().default(24)
    ),
    autoRestore: z.preprocess(parseSupervisorBoolean, z.boolean().optional().default(true)),
})

function fetchLatestNremSnippet(db: IDatabaseAdapter): string {
    try {
        const searchRes = db.searchEntries('', {
            tags: ['database-optimizer'],
            limit: 3,
            workspaceId: '*',
        })
        const latest = searchRes.entries[0]
        if (latest !== undefined) {
            return `ID: #${String(latest.id)} | Timestamp: ${latest.timestamp} | Type: ${latest.entryType} | Tags: ${latest.tags.join(', ')}\n${latest.content.slice(0, 1200)}`
        }
        return '_No recent CMS-02 / database-optimizer entry found._'
    } catch (error: unknown) {
        logger.warning('CMS supervisor could not read the latest NREM entry', {
            error: error instanceof Error ? error.message : String(error),
        })
        return '_Latest NREM entry query failed._'
    }
}

function fetchDeletedEntriesSnapshot(db: IDatabaseAdapter, lookbackHours: number): string {
    try {
        const deletedRes = db.getDeletedEntries({ limit: 25, workspaceId: '*' })
        if (deletedRes.entries.length === 0) {
            return `_No soft-deleted entries found (lookback window: ${String(lookbackHours)}h)._`
        }
        const cutoffMs = Date.now() - lookbackHours * 3600_000
        let flaggedDeletionsCount = 0
        const rows = deletedRes.entries.map((e) => {
            const isHighValue =
                e.significanceType !== null ||
                (e.impactScore !== undefined && e.impactScore >= 0.5)
            const deletedMs =
                e.deletedAt !== undefined && e.deletedAt !== null ? Date.parse(e.deletedAt) : NaN
            const inWindow = Number.isNaN(deletedMs) || deletedMs >= cutoffMs
            if (isHighValue && inWindow) flaggedDeletionsCount++
            const flag = isHighValue
                ? inWindow
                    ? '⚠️ [HIGH-VALUE CANDIDATE FOR RESTORE] '
                    : '⏳ [OUTSIDE LOOKBACK WINDOW] '
                : ''
            return `${flag}ID: #${String(e.id)} | Type: ${e.entryType} | Significance: ${String(e.significanceType)} | Impact: ${String(e.impactScore)} | DeletedAt: ${String(e.deletedAt)}\nSnippet: ${e.content.slice(0, 140)}`
        })
        return (
            `Total Soft-Deleted Count: ${String(deletedRes.count)} (Lookback Window: ${String(lookbackHours)}h | Flagged High-Value in window: ${String(flaggedDeletionsCount)})\n` +
            rows.join('\n---\n')
        )
    } catch (error: unknown) {
        logger.warning('CMS supervisor could not read soft-deleted entries', {
            error: error instanceof Error ? error.message : String(error),
        })
        return '_Soft-deleted entry query failed._'
    }
}

interface CmsSupervisorPromptParams {
    lookbackHours: number
    autoRestore: boolean
    totalEntries: number | string
    orphanCount: number | string
    latestNremSnippet: string
    deletedSnippet: string
    supervisorProjectLabel: string
    supervisorProjectField: string
}

function buildCmsSupervisorText(params: CmsSupervisorPromptParams): string {
    return `# CMS-04: REM Meta-Cognitive Supervisor & Self-Adaptation Workflow

You are executing the **REM Meta-Cognitive Supervisor (\`CMS-04\`)** workflow across the global memory journal ecosystem.
**Lookback Window**: \`${String(params.lookbackHours)}h\` | **Auto-Restore High-Value Deletions**: \`${String(params.autoRestore)}\`
**Active Global Entries**: \`${String(params.totalEntries)}\` | **Current Orphans**: \`${String(params.orphanCount)}\`

## Latest NREM Consolidation (\`CMS-02\`) Report Snapshot
${markUntrustedContent(params.latestNremSnippet)}

## Recent Soft-Deleted Entries Audit
${markUntrustedContent(params.deletedSnippet)}

---

## Execution Protocol (Execute All 4 Phases Without Stopping)

### Phase A — Post-NREM Supervisor Audit & Safety Rollback
1. **Verify \`CMS-02\` Pruning Safety**:
   - Inspect the recent soft-deleted entries above (or query \`await mj.search.listDeletedEntries({ limit: 50, workspace_id: '*' })\` and \`await mj.admin.searchAuditLog({ limit: 100, category: 'write' })\` via \`mj_execute_code\`).
   - If any soft-deleted entry from the last \`${String(params.lookbackHours)}h\` has \`significanceType !== null\`, \`impactScore >= 0.5\`, or active relationships, ${params.autoRestore ? `**immediately restore it** via \`await mj.admin.restoreEntry({ entry_id, workspace_id: '*' })\` and record the false-positive pruning pattern.` : `**do NOT restore it automatically** (\`autoRestore\` is off): list it as a restore candidate with its id, workspace, and reason, and record the false-positive pruning pattern for user review.`}
2. **Global Invariant Verification**:
   - Confirm \`0\` unassigned (\`workspaceId === 'default'\` or \`projectNumber <= 0\`) entries exist across \`workspace_id: '*'\`.
   - Check vector index parity via \`await mj.search.getVectorIndexStats({})\`; if vector count drifts from active entry count, run \`await mj.admin.rebuildVectorIndex({ workspace_id: '*' })\`.

### Phase B — Cross-Run Experience, Telemetry Mining & Automation Self-Improvement
1. Inspect \`logs/agent-issues.jsonl\` and \`logs/mcp-audit.jsonl\` for recurring tool validation failures, parameter hallucinations, or unhandled edge cases.
2. Review the **Root-Cause Investigation** section of the latest \`CMS-02\` maintenance entry and recent \`session-summary\` \`## Unfinished / Blocked\` sections across projects.
3. Formulate targeted, minimal code/schema/prompt/automation adaptations for any recurring friction or improvement opportunities discovered (e.g., adding parameter alias coercions in \`src/handlers/tools/schemas/hallucination-healer.ts\`, refining prompt instructions in \`src/handlers/prompts/\`, updating server docs, or refining scheduled CMS automation templates).

### Phase C — Batched Adaptation & Dirty-Tree Conditional Single-Pass Validation Gate
> [!IMPORTANT]
> **LOAD OPTIMIZATION INVARIANT (DIRTY-TREE CONDITIONAL SINGLE-PASS VALIDATION GATE)**:
> Full-suite validation (\`lint\`, \`typecheck\`, \`build\`, \`vitest\`, \`playwright\`) is resource-intensive and MUST ONLY run when repository files have actually been modified.
> **HITL CODE MODIFICATION GUARDRAIL**: Do NOT modify executable source code or global environment files without explicit user approval unless running in an explicitly approved autonomous maintenance session.

1. Apply all approved code, schema, prompt, or documentation fixes in a single cohesive batch.
2. Check working tree status via \`git status --porcelain\`.
3. **If \`0\` files are modified/untracked in \`memory-journal-mcp\`**:
   - **SKIP** \`pnpm run lint\`, \`pnpm run typecheck\`, \`pnpm run build\`, \`pnpm exec vitest run\`, and \`pnpm exec playwright test\` completely! Proceed directly to step 5 / Phase D.
4. **If \`>= 1\` files are modified in \`memory-journal-mcp\`**:
   - Terminate stalled audit subagents (\`manage_subagents\` \`Action: 'kill'\` with explicit IDs) and verify no competing \`vitest\`, \`playwright\`, or \`tsc\` process is active.
   - Run the 5-stage validation gate **strictly sequentially once** (never concurrently):
     1. \`pnpm run lint\`
     2. \`pnpm run typecheck\`
     3. \`pnpm run build\`
     4. \`pnpm exec vitest run\`
     5. \`pnpm exec playwright test\`
   - Commit the verified changes via \`git add <changed_files>; git commit -m "fix(cms): <summary>"\`.
5. If any client automation template or CMS guide was improved, commit those explicit changes separately in their own repository.

### Phase D — Telemetry Cleanup & Supervisor Journal Entry
1. If \`logs/agent-issues.jsonl\` contained issues that were resolved and validated in Phase C, clear \`logs/agent-issues.jsonl\`.
2. Log the completed supervisor run in \`memory-journal-mcp\` (${params.supervisorProjectLabel}) using \`mj.core.createEntry\` with:
   - \`workspace_id: 'memory-journal-mcp'\`, ${params.supervisorProjectField}
   - \`entry_type: 'maintenance'\`
   - \`significance_type: 'milestone'\`
   - \`tags: ['cms', 'cms-04-rem-supervisor', 'meta-learning', 'maintenance']\`
   - \`trust_score: 1.0\`, \`impact_score: 0.6\`, \`validation_status: 'passed'\`
   - Link via \`relationships: [{ targetId: <prior_cms04_id>, relationType: 'evolves_from' }, { targetId: <latest_cms02_id>, relationType: 'references' }]\` (or top-level \`evolves_from\` and \`references\` fields).
`
}

function handleCmsSupervisorPrompt(
    args: Record<string, string> | undefined,
    db: IDatabaseAdapter,
    briefingConfig?: Partial<BriefingConfig>
): { messages: PromptMessage[] } {
    const rawArgs = args ?? {}
    const lookbackRes = cmsSupervisorArgsSchema.shape.lookbackHours.safeParse(rawArgs['lookbackHours'])
    if (!lookbackRes.success) {
        throw new ValidationError(
            `Invalid lookbackHours value '${String(rawArgs['lookbackHours'])}'. Expected an integer between 1 and 168.`
        )
    }
    const lookbackHours = lookbackRes.data
    const restoreRes = cmsSupervisorArgsSchema.shape.autoRestore.safeParse(rawArgs['autoRestore'])
    if (!restoreRes.success) {
        throw new ValidationError(
            `Invalid autoRestore value '${String(rawArgs['autoRestore'])}'. Expected boolean (true/false, on/off, yes/no, 1/0, disabled).`
        )
    }
    const autoRestore = restoreRes.data
    const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const mjKey = exactRegistryKey('memory-journal-mcp', registry)
    const mjProjectNumber = mjKey !== undefined ? registry?.[mjKey]?.project_number : undefined
    const supervisorProjectLabel =
        mjProjectNumber !== undefined
            ? `project #${String(mjProjectNumber)}`
            : 'its resolved registry `project_number` (via `memory://agent-context/memory-journal-mcp` or `mj.admin.listProjects()`)'
    const supervisorProjectField =
        mjProjectNumber !== undefined
            ? `\`project_number: ${String(mjProjectNumber)}\``
            : '`project_number: <resolved_project_number>`'
    const latestNremSnippet = fetchLatestNremSnippet(db)
    const deletedSnippet = fetchDeletedEntriesSnapshot(db, lookbackHours)

    let orphanCount: number | string = 'Unknown'
    let totalEntries: number | string = 'Unknown'
    try {
        totalEntries = db.getActiveEntryCount('*')
        orphanCount = db.getOrphanCount('*')
    } catch (err) {
        logger.debug('Could not read entry/orphan counts for CMS supervisor prompt', {
            module: 'CmsSupervisor',
            error: err instanceof Error ? err.message : String(err),
        })
    }

    return {
        messages: [
            {
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: buildCmsSupervisorText({
                        lookbackHours,
                        autoRestore,
                        totalEntries,
                        orphanCount,
                        latestNremSnippet,
                        deletedSnippet,
                        supervisorProjectLabel,
                        supervisorProjectField,
                    }),
                },
            },
        ],
    }
}

export function getCmsSupervisorPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'cms-rem-supervisor',
            description:
                'REM Meta-Cognitive Supervisor & Self-Adaptation workflow (CMS-04). Audits recent NREM consolidation (CMS-02) mutations and soft-deletions, mines cross-run telemetry and unresolved blockers, and enforces the Dirty-Tree Conditional Single-Pass Validation Gate.',
            icons: [ICON_PROMPT],
            capabilities: { requiresAdminScope: true },
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
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                _teamDb?: IDatabaseAdapter,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>
            ) => handleCmsSupervisorPrompt(args, db, briefingConfig),
        },
    ]
}
