/**
 * Memory Journal MCP Server - Optimizer Prompt Definitions
 *
 * Prompts: optimize-journal
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../utils/write-scope.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { sanitizePromptTarget } from './adversarial-helpers.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { z } from 'zod'
import { ValidationError } from '../../types/errors.js'
import { coerceNumber } from '../../utils/query-helpers.js'
import { getCmsSupervisorPromptDefinitions } from './cms-supervisor.js'
import {
    buildOptimizeStandardsAndScripts,
    buildStatsSnippet,
    buildUnverifiedSnippet,
    formatAutoPruneScopeArg,
} from './optimizer-snippets.js'

const optimizeJournalArgsSchema = z.object({
    lookback: z.preprocess(
        coerceNumber,
        z.number().int().min(1).max(2000).optional().default(10)
    ),
    limit: z.preprocess(coerceNumber, z.number().int().min(0).max(50000).optional()),
    project: z.preprocess(
        (val) => (typeof val === 'string' ? val.trim() : val),
        z.string().optional()
    ),
    autoRun: z.preprocess(
        (val) =>
            val === true ||
            (typeof val === 'string' && ['true', '1', 'yes'].includes(val.trim().toLowerCase())),
        z.boolean().optional().default(false)
    ),
    mode: z.preprocess(
        (val) => (typeof val === 'string' ? val.toLowerCase() : val),
        z.enum(['quick', 'targeted', 'full']).optional().default('quick')
    ),
    targetDimension: z.preprocess(
        (val) => (typeof val === 'string' ? val.toLowerCase() : val),
        z
            .enum(['unassigned', 'relationships', 'scores', 'tags', 'all'])
            .optional()
            .default('all')
    ),
})

function resolveOptimizeTargetScope(
    targetProject: string | undefined,
    registry: BriefingConfig['projectRegistry']
): { workspaceId: string; projectNumber?: number } {
    if (targetProject === undefined || targetProject === '') {
        return { workspaceId: '*' }
    }
    const numMatch = /^#?([1-9]\d*)$/.exec(targetProject)
    if (numMatch?.[1] !== undefined) {
        const parsedNum = parseCanonicalPositiveInt(numMatch[1])
        if (parsedNum === undefined) {
            throw new ValidationError(
                `Invalid project '${targetProject}'. Expected a canonical positive integer or a registered project name.`
            )
        }
        const uniqueWorkspace = uniqueWorkspaceForProject(parsedNum, registry)
        if (registry !== undefined && uniqueWorkspace === undefined) {
            throw new ValidationError(
                `project_number ${String(parsedNum)} is not a unique registered project.`
            )
        }
        if (uniqueWorkspace === undefined) {
            return { workspaceId: '*', projectNumber: parsedNum }
        }
        return { workspaceId: uniqueWorkspace, projectNumber: parsedNum }
    }
    const matchedKey = exactRegistryKey(targetProject, registry)
    if (matchedKey !== undefined) {
        const matchedNum = registry?.[matchedKey]?.project_number
        return matchedNum !== undefined
            ? { workspaceId: matchedKey, projectNumber: matchedNum }
            : { workspaceId: matchedKey }
    }
    return { workspaceId: targetProject }
}

function buildExecutionBanner(isAutonomousFull: boolean): string {
    if (isAutonomousFull) {
        return `> [!IMPORTANT]
> **UNATTENDED FULL-DEPTH EXECUTION PROTOCOL (\`CMS-02\` NREM CONSOLIDATION — MANDATORY)**:
> \`mode: 'full'\` or \`autoRun: true\` is active. You MUST **execute all phases (Option A, Option B, AND Option C / Comprehensive Multi-Agent Domain Audit, Episodic-to-Semantic Compaction, Tag Consolidation & Graph Defrag)** continuously across ALL projects (\`workspace_id: '*'\`) and ALL historical entries without stopping.
> - **DO NOT** pause to ask the user for confirmation, approval, or thoroughness preferences.
> - **Data-Plane / Zero-Build Guardrail**: This workflow operates strictly on SQLite and Vector Index data via MCP tools. **NEVER** run \`pnpm run lint\`, \`pnpm run typecheck\`, \`pnpm run build\`, \`npx vitest\`, or \`npx playwright\` during database optimization.`
    }
    return `> [!IMPORTANT]
> **AUTOMATED INITIAL EXECUTION PROTOCOL (MANDATORY)**:
> When this prompt starts, you MUST **automatically execute Option A and Option B** first without waiting for additional user instructions:
> 1. **Option A (Safety Backup & Priority Unassigned Scan)**: Immediately create a database safety backup via \`backup_journal\` and run the unassigned workspace scan across all projects (\`workspace_id: '*'\`). If any default/unassigned entries are found, auto-repair/migrate them immediately and formulate a root-cause analysis.
> 2. **Option B (Targeted Quality Dimension Scan)**: Perform a fast baseline scan of recent entries lacking relationships, trust/impact scores, or technical subsystem tags.
> 3. **Report Initial Findings**: Present the mandatory health summary, safety backup details, and unassigned status to the user.

> [!TIP]
> **INTERACTIVE HANDOVER FOR COMPREHENSIVE MULTI-AGENT DOMAIN AUDIT**:
> Upon completing the initial automated execution (Option A & B), present **Comprehensive Multi-Agent Domain Audit & Noise Pruning** to the user as an available next step.
> Explicitly inform the user that they can choose to execute it directly or customize it with natural commands, such as:
> - *"Proceed with Comprehensive Multi-Agent Domain Audit"*
> - *"Do it across all entries (limit: 0)"*
> - *"Run Multi-Agent Audit on project mysql-mcp"*
> - *"Run Multi-Agent Audit focusing on missing relationships and noise pruning"*`
}

function buildOptimizeWorkflowOptionsSection(
    targetDimension: string,
    optionCHeading: string,
    targetProject: string | undefined,
    limitDisplay: string
): string {
    const autoPruneArg = formatAutoPruneScopeArg(targetProject)
    return `## Workflow Execution Options

### Option A: Quick Health & Priority Workspace Unassigned Audit (Executed Automatically)
1. **Safety Backup & Retention**: Inspect \`memory://health\` first to check whether \`teamDatabase.configured\` is \`true\`. Call \`backup_journal\` and \`cleanup_backups({ keep_count: 15 })\` before any mutations (abort if backup creation fails); when \`teamDatabase.configured\` is \`true\`, also call \`team_backup\` (\`mj.team.teamBackup({})\`).
2. **Priority Zero-Tolerance Unassigned & Default Scan & Auto-Repair**:
   - Run the Unassigned Scan script across all workspaces (\`workspace_id: '*'\`).
   - Auto-repair entries: if an entry belongs to \`workspaceId: 'default'\` or has a missing/invalid \`projectNumber\`, migrate it immediately using \`mj.admin.updateEntry({ entry_id: id, project_number: correctProject, target_workspace_id: correctWorkspace, workspace_id: '*' })\`.
   - **Root-Cause Investigation**: Investigate why any unassigned/default entries bypassed project assignment and formulate a remediation plan.

### Option B: Ground-Truth Verification, Staleness Sweep & Targeted Quality Audit (Executed Automatically)
1. **Ground-Truth Verification & Staleness Sweep**:
   - Cross-check recent \`session-summary\`, \`bug_fix\`, \`project_decision\`, and \`planning\` entries against Git/GitHub truth (\`mj.git.getCommitHistory\`, \`mj.github.getGithubIssues\`, \`mj.github.getGithubPrs\`).
   - Run \`mj.git.checkEntryStaleness({ entry_id: id, workspace_id: '*' })\` and update stale anchors via \`mj.core.markAnchorsStale\` (do **NOT** pass \`readonly: true\` to \`mj_execute_code\` when calling \`checkEntryStaleness\`, because it persists refreshed anchor statuses; do **NOT** call \`checkEntryStaleness({ workspace_id: '*' })\` more than once without \`entry_id\` in a single script to avoid 30s worker timeouts; pass \`workspace_id: '*'\` on inner \`getEntryById\` calls across domains, and pass the entry's concrete \`workspace_id\` and \`project_number\` on \`linkEntries\` — never \`workspace_id: '*'\` on \`linkEntries\`, while \`createEntry\` \`relationships\` resolves target IDs strictly within the same database).
2. **Quality Dimension Audit (\`${targetDimension}\`)**:
   - \`unassigned\`: Audit only unassigned or default workspace entries.
   - \`relationships\`: Audit only orphan entries lacking graph anchors.
   - \`scores\`: Audit only entries with \`trust_score < 0.9\` or unrated \`impact_score\`.
   - \`tags\`: Audit entries with generic or empty tag arrays.
3. Process entries in sequential single-batch calls of **\`<= 25–30\`** entries per \`mj_execute_code\` invocation (1 batch per call — avoid multi-batch loops inside a single worker run to stay well within sandbox memory/timeout budgets), updating metadata via \`mj.admin.batchUpdateEntries\`.

${optionCHeading}
1. **Domain-Based Subagent Partitioning**: Partition entries by **Project Workspace Domain** (or focus exclusively on \`${targetProject !== undefined && targetProject !== '' ? targetProject : 'all projects'}\` capped at \`${limitDisplay}\` entries). Domain partitioning preserves contextual coherence across commit narratives, retrospectives, and technical subsystem tags.
2. **Full Content, Episodic Compaction & 5-Dimension Single-Pass Optimization**:
   - Instruct subagents (or execute directly in Code Mode batches) to optimize all core entry dimensions while compacting and pruning noise simultaneously:
     - 🔗 **Graph Anchors**: Link related entries within the same project workspace via Code Mode (\`mj.relationships.linkEntries({ from_entry_id, to_entry_id, relationship_type, workspace_id: domainWorkspaceId, project_number: domainProjectNumber })\` — never pass \`workspace_id: '*'\` to \`linkEntries\`; for same-DB references when creating maintenance/compaction entries, pass \`relationships: [{ targetId, relationType }]\` directly to \`mj.core.createEntry\`) using canonical relationship types (\`references\`, \`implements\`, \`evolves_from\`, \`resolved\`, \`blocked_by\`, \`caused\`, \`clarifies\`, \`response_to\`).
     - 🧠 **Episodic-to-Semantic Compaction**: When \`>10\` granular \`test_entry\` or incremental \`development_note\` entries older than \`14 days\` exist for the same feature/session, synthesize a single semantic \`retrospective\` or \`project_decision\` entry linked via \`evolves_from\` (tagged \`semantic-summary\`; do **NOT** tag synthesized compaction entries with \`session-summary\`, which is reserved for end-of-session 4-header retrospectives) and archive the raw fragments (\`is_archived: true\`).
     - 🛡️ **Trust Calibration**: Normalize trust scores (\`trust_score\` between \`0.90\`–\`1.00\` for verified code/tests).
     - 💥 **Impact Calibration**: Calibrate impact scores (\`impact_score\` between \`0.30\`–\`0.80\` based on blast radius).
     - 🏷️ **Tag Consolidation & Significance**: Assign explicit \`significance_type\`, enrich empty/generic tag lists, and merge synonymous tags globally via \`mj.admin.mergeTags({ source_tag, target_tag, workspace_id: '*' })\` (never iterate per-workspace to avoid "Tag not found" on subsequent scopes).
     - 🧹 **Noise Pruning, Auto-Prune, Vector & Team Parity**: Soft-delete zero-value transient noise (\`significanceType === null\`) via \`mj.admin.deleteEntry\`, run \`mj.admin.runAutoPrune(${autoPruneArg})\`, and verify \`mj.search.getVectorIndexStats({})\` (rebuilding via \`mj.admin.rebuildVectorIndex(${autoPruneArg})\` if drifted). When \`teamDatabase.configured\` is \`true\`, also link unlinked team entries (\`mj.team.teamLinkEntries\`), merge duplicate team tags (\`mj.team.teamMergeTags\`) if needed, and verify \`mj.team.teamGetVectorIndexStats({})\` (rebuilding via \`mj.team.teamRebuildVectorIndex({})\` if drifted).
3. **Subagent Batch Parallelization & Strict Isolation**:
   - Delegate domain project workloads to parallel subagents using \`Model: 'inherit'\`.
   - **Strict Isolation**: Subagents MUST NEVER write files to project directories; all scratch files must be saved in \`<appDataDir>\\\\brain\\\\<conversation-id>\\\\scratch\\\\\`.
4. **Parent Agent Resource Reclamation Guarantee**:
   - As soon as each subagent reports completion, the parent agent MUST immediately terminate it using \`manage_subagents\` with \`Action: 'kill'\` and its \`ConversationId\` to free system resources.

---

## Mandatory Report Structure
Every execution report MUST follow this exact 5-part Markdown layout plus the Reference Parameters Addendum:
1. **Global Database Health & Resource Metrics**: Summary of total entries, unique tags, active relationships & avg density, relationship types breakdown, orphan count & %, and DB/Vector Index health.
2. **Project & Workspace Matrix Table**: A complete table listing entry counts and unassigned status across ALL registered projects (Note: Always retrieve global multi-project breakdown using \`mj.analytics.getStatistics({ project_breakdown: true, workspace_id: '*' })\` or \`mj.analytics.getCrossProjectInsights({ workspace_id: '*' })\`):
   | Project Name | Project # | Total Entries | Unassigned / Default | Status |
3. **Unassigned / Default Workspace Investigation & Fix Plan**:
   - Details of any migrated entries.
   - Root cause analysis explaining how the misallocation occurred.
   - Actionable fix plan / task recommendations to prevent future occurrences (or "Zero unassigned entries found" if clear).
4. **The 3 Optimization Workflow Options**:
   - Detailed breakdown of Option A (Safety Backup & Priority Unassigned Scan - Executed Automatically).
   - Detailed breakdown of Option B (Ground-Truth, Staleness & Targeted Quality Dimension Audit - Executed Automatically).
5. **Comprehensive Multi-Agent Domain Audit, Episodic Compaction & Noise Pruning (Advanced Tier)**:
   - Domain-based subagent partitioning description.
   - 5-Dimension single-pass optimization, episodic compaction & noise pruning breakdown.
   - Subagent parallelization & parent agent resource reclamation guarantee.

---

### Addendum: Optimization Reference Parameters
Include the reference table of configurable prompt parameters (\`mode\`, \`targetDimension\`, \`project\`, \`limit\`, \`lookback\`, \`autoRun\`) formatted with single-line markdown table rows:
| Parameter | Type / Values | Default | Purpose |
| :--- | :--- | :---: | :--- |
| \`mode\` | \`'quick'\` \\| \`'targeted'\` \\| \`'full'\` | \`'quick'\` | Controls overall execution depth (\`'full'\` runs all tiers non-interactively). |
| \`targetDimension\` | \`'unassigned'\` \\| \`'relationships'\` \\| \`'scores'\` \\| \`'tags'\` \\| \`'all'\` | \`'all'\` | Narrows optimization to specific quality defects. |
| \`project\` | Project name or number (e.g., \`'mysql-mcp'\` or \`9\`) | \`undefined\` (all) | Restricts analysis/pruning to a single project domain. |
| \`limit\` | Number (\`0\` = unlimited, or \`1 – 50000\`) | \`500\` (\`0\` in \`full\`/\`autoRun\`) | Processing cap for entry auditing (\`0\` scans all history). |
| \`lookback\` | Number (\`1 – 2000\`) | \`10\` | Recent unverified entry lookback window. |
| \`autoRun\` | Boolean (\`true\` \\| \`false\`) | \`false\` | Enables unattended maximum-depth execution without stopping. |`
}

function parseOptimizePromptArgs(rawArgs: Record<string, string>): {
    lookback: number
    targetProject: string | undefined
    autoRun: boolean
    mode: string
    targetDimension: string
    isAutonomousFull: boolean
    entryLimit: number
} {
    const lookbackRes = optimizeJournalArgsSchema.shape.lookback.safeParse(rawArgs['lookback'])
    const lookback = lookbackRes.success ? lookbackRes.data : 10
    const projectRes = optimizeJournalArgsSchema.shape.project.safeParse(rawArgs['project'])
    const rawTargetProject = projectRes.success ? projectRes.data : undefined
    const targetProject =
        rawTargetProject !== undefined && rawTargetProject !== ''
            ? sanitizePromptTarget(rawTargetProject)
            : undefined
    const autoRunRes = optimizeJournalArgsSchema.shape.autoRun.safeParse(rawArgs['autoRun'])
    const autoRun = autoRunRes.success ? autoRunRes.data : false
    const modeRes = optimizeJournalArgsSchema.shape.mode.safeParse(rawArgs['mode'])
    const mode = modeRes.success ? modeRes.data : 'quick'
    const dimRes = optimizeJournalArgsSchema.shape.targetDimension.safeParse(
        rawArgs['targetDimension']
    )
    const targetDimension = dimRes.success ? dimRes.data : 'all'
    const isAutonomousFull = autoRun || mode === 'full'
    const limitRes = optimizeJournalArgsSchema.shape.limit.safeParse(rawArgs['limit'])
    const entryLimit =
        limitRes.success && limitRes.data !== undefined
            ? limitRes.data
            : isAutonomousFull
              ? 0
              : 500
    return {
        lookback,
        targetProject,
        autoRun,
        mode,
        targetDimension,
        isAutonomousFull,
        entryLimit,
    }
}

function buildOptimizePromptResponse(params: {
    mode: string
    targetDimension: string
    targetProject: string | undefined
    entryLimit: number
    autoRun: boolean
    isAutonomousFull: boolean
    statsSnippet: string
    unverifiedSnippet: string
    mjProjectNumber: number | undefined
}): { messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
    const targetProjectText =
        params.targetProject !== undefined && params.targetProject !== ''
            ? ` | **Target Project**: \`${params.targetProject}\``
            : ''
    const limitDisplay =
        params.entryLimit === 0 ? '0 (Unlimited / All Time)' : String(params.entryLimit)
    const limitText = ` | **Entry Limit**: \`${limitDisplay}\``
    const autoRunText = params.autoRun ? ` | **Auto-Run**: \`true\`` : ''
    const executionBanner = buildExecutionBanner(params.isAutonomousFull)
    const optionCHeading = params.isAutonomousFull
        ? '### Option C: Comprehensive Multi-Agent Domain Audit, Episodic Compaction & Noise Pruning (Executed Automatically in Full/AutoRun Mode)'
        : '### Comprehensive Multi-Agent Domain Audit & Noise Pruning (Presented to User for Choice)'
    const scanLoopCondition =
        params.entryLimit === 0
            ? 'for (let _page = 0; _page < 200; _page++)'
            : `while (processed < ${String(params.entryLimit)})`

    const standardsAndScripts = buildOptimizeStandardsAndScripts(
        params.targetProject,
        scanLoopCondition,
        params.mjProjectNumber
    )
    const workflowOptions = buildOptimizeWorkflowOptionsSection(
        params.targetDimension,
        optionCHeading,
        params.targetProject,
        limitDisplay
    )

    return {
        messages: [
            {
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: `# Journal Optimizer & Verification Workflow

You are executing the guided workflow for intelligently pruning, verifying, consolidating, and auditing the global memory journal database. Every operation uses soft-deletion or archival as a safe first pass.

**Requested Mode**: \`${params.mode}\` | **Quality Dimension**: \`${params.targetDimension}\`${targetProjectText}${limitText}${autoRunText}

${params.statsSnippet}

## Unverified Recent Entries
${markUntrustedContent(params.unverifiedSnippet)}

${executionBanner}

---

${standardsAndScripts}

---

${workflowOptions}
`,
                },
            },
        ],
    }
}

export function getOptimizerPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'optimize-journal',
            description:
                "Guided database pruning, graph verification, episodic-to-semantic compaction, and multi-agent audit workflow. Optional arguments: `lookback` (Number of recent entries, default: 10), `limit` (Entry processing cap; pass `0` for unlimited across all history, default: 500 or 0 in full/autoRun mode), `project` (Target project name or number, optional), `autoRun` (boolean, default: false), `mode` ('quick' | 'targeted' | 'full', default: 'quick'), `targetDimension` ('unassigned' | 'relationships' | 'scores' | 'tags' | 'all', default: 'all').",
            icons: [ICON_PROMPT],
            capabilities: { requiresAdminScope: true },
            arguments: [
                {
                    name: 'lookback',
                    description: 'Number of recent entries to inspect for unverified status (default: 10)',
                    required: false,
                },
                {
                    name: 'limit',
                    description: 'Entry processing cap (0 = unlimited across all time, default: 500 or 0 in full/autoRun mode)',
                    required: false,
                },
                {
                    name: 'project',
                    description: 'Target project name or number (omit to optimize all projects globally)',
                    required: false,
                },
                {
                    name: 'autoRun',
                    description: 'Set to "true" to execute all phases including Multi-Agent Domain Audit without interactive stopping',
                    required: false,
                },
                {
                    name: 'mode',
                    description: "Execution depth: 'quick' | 'targeted' | 'full' (default: 'quick')",
                    required: false,
                },
                {
                    name: 'targetDimension',
                    description: "Quality dimension filter: 'unassigned' | 'relationships' | 'scores' | 'tags' | 'all' (default: 'all')",
                    required: false,
                },
            ],
            handler: (
                args: Record<string, string> | undefined,
                db: IDatabaseAdapter,
                _teamDb?: unknown,
                _github?: unknown,
                briefingConfig?: Partial<BriefingConfig>
            ) => {
                // [INVARIANT] H27: Parse each field independently so one invalid numeric/enum
                // option (e.g., lookback) never discards `project` scope or valid siblings.
                const parsed = parseOptimizePromptArgs(args ?? {})
                const registry = briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
                const targetScope = resolveOptimizeTargetScope(parsed.targetProject, registry)
                const statsSnippet = buildStatsSnippet(
                    db,
                    targetScope.workspaceId,
                    targetScope.projectNumber
                )
                const unverifiedSnippet = buildUnverifiedSnippet(
                    db,
                    parsed.lookback,
                    targetScope.workspaceId,
                    targetScope.projectNumber
                )
                const mjRegistryKey = exactRegistryKey('memory-journal-mcp', registry)
                const mjProjectNumber =
                    mjRegistryKey !== undefined
                        ? registry?.[mjRegistryKey]?.project_number
                        : undefined

                return buildOptimizePromptResponse({
                    ...parsed,
                    statsSnippet,
                    unverifiedSnippet,
                    mjProjectNumber,
                })
            },
        },
        ...getCmsSupervisorPromptDefinitions(),
    ]
}
