import { z } from 'zod'
import type { ToolHandlerConfig } from '../../../types/index.js'
import type {
    BriefingConfigurableKey,
    ConfigManager,
    MutatedConfigFields,
} from '../../../utils/config-manager.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, exactRegistryKey, pairStoredScope } from '../../../utils/write-scope.js'
import { ValidationError } from '../../../types/errors.js'
import { isForbiddenProjectKey } from '../../../utils/project-registry-guards.js'
import { relaxedNumber } from '../schemas.js'

function normalizeConfigProjectNumber(obj: Record<string, unknown>): void {
    const raw = obj['project_number']
    if (typeof raw !== 'string') return
    const pMatch = /^(?:#|p-?)?([1-9]\d*)$/i.exec(raw.trim())
    if (pMatch?.[1] === undefined) return
    const parsed = Number(pMatch[1])
    if (Number.isSafeInteger(parsed)) {
        obj['project_number'] = parsed
    }
}

function preprocessUpdateConfig(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        let obj = { ...(val as Record<string, unknown>) }
        if (typeof obj['config'] === 'object' && obj['config'] !== null) {
            obj = { ...obj, ...(obj['config'] as Record<string, unknown>) }
            delete obj['config']
        }

        if ('filter' in obj) {
            if (!('tool_filter' in obj)) {
                obj['tool_filter'] = obj['filter']
            }
            delete obj['filter']
        }

        if ('project_number' in obj) {
            normalizeConfigProjectNumber(obj)
        }

        for (const key of [
            'mcp_servers',
            'mcpServers',
            'servers',
            'session_id',
            'update_notes',
            'notes',
            'title',
            'content',
            'tags',
            'description',
            'target',
            'scope',
            'action',
            'mode',
            'type',
            'name',
            'target_user',
            'params',
            'input',
            'args',
            'entry_type',
            'entryType',
            'category',
            'metadata',
        ]) {
            if (key in obj) {
                Reflect.deleteProperty(obj, key)
            }
        }
        return obj
    }
    return val
}

export const updateConfigurationSchema = z.preprocess(
    preprocessUpdateConfig,
    z
        .object({
            tool_filter: z
                .string()
                .optional()
                .describe('A comma-separated list of tool groups to enable, or "all"'),
            briefing_entries: z.number().int().min(0).max(100).optional(),
            briefing_commits: z.number().int().min(0).max(100).optional(),
            briefing_importance_threshold: z.number().min(0).max(1).optional(),
            briefing_insights: z
                .boolean()
                .optional()
                .describe('Show the Insights row (GitHub repo stats/traffic + analytics digest); false skips those calls'),
            briefing_summaries: z.number().int().min(0).max(100).optional(),
            briefing_include_team: z.boolean().optional(),
            briefing_issues: z.number().int().min(0).max(100).optional(),
            briefing_prs: z.number().int().min(0).max(100).optional(),
            briefing_pr_status: z.boolean().optional(),
            briefing_milestones: z.number().int().min(0).max(100).optional(),
            briefing_workflows: z.number().int().min(0).max(100).optional(),
            briefing_workflow_status: z.boolean().optional(),
            briefing_copilot: z.boolean().optional(),
            briefing_graph: z
                .boolean()
                .optional()
                .describe('Show graph/git pivots (entry link degree, commit→entry refs, active threads) in the briefing'),
            project_number: z.number().int().positive().optional(),
            workspace_id: z.string().max(255).optional(),
        })
        .strict()
        .describe(
            'Updates the active MCP server configuration. Provide parameters as flat keys (e.g. tool_filter: "codemode"). Do NOT nest them inside a "config" object.'
        )
)

export const updateConfigurationSchemaMcp = z.preprocess(
    preprocessUpdateConfig,
    z
        .object({
            tool_filter: z
                .string()
                .optional()
                .describe('A comma-separated list of tool groups to enable, or "all"'),
            briefing_entries: relaxedNumber().optional(),
            briefing_commits: relaxedNumber().optional(),
            briefing_importance_threshold: relaxedNumber().optional(),
            briefing_insights: z
                .boolean()
                .optional()
                .describe('Show the Insights row (GitHub repo stats/traffic + analytics digest); false skips those calls'),
            briefing_summaries: relaxedNumber().optional(),
            briefing_include_team: z.boolean().optional(),
            briefing_issues: relaxedNumber().optional(),
            briefing_prs: relaxedNumber().optional(),
            briefing_pr_status: z.boolean().optional(),
            briefing_milestones: relaxedNumber().optional(),
            briefing_workflows: relaxedNumber().optional(),
            briefing_workflow_status: z.boolean().optional(),
            briefing_copilot: z.boolean().optional(),
            briefing_graph: z
                .boolean()
                .optional()
                .describe('Show graph/git pivots (entry link degree, commit→entry refs, active threads) in the briefing'),
            project_number: relaxedNumber().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
        .describe(
            'Updates the active MCP server configuration. Provide parameters as flat keys (e.g. tool_filter: "codemode"). Do NOT nest them inside a "config" object.'
        )
)

export type UpdateConfigurationArgs = z.infer<typeof updateConfigurationSchema>

type BriefingArgKey = Extract<keyof UpdateConfigurationArgs, `briefing_${string}`>

/** [INVARIANT] One row per `briefing_*` arg; keep in parity with `BRIEFING_CONFIG_KEY_MAP`. */
const BRIEFING_ARG_TARGETS: readonly (readonly [BriefingArgKey, BriefingConfigurableKey])[] = [
    ['briefing_commits', 'commitCount'],
    ['briefing_entries', 'entryCount'],
    ['briefing_summaries', 'summaryCount'],
    ['briefing_include_team', 'includeTeam'],
    ['briefing_issues', 'issueCount'],
    ['briefing_prs', 'prCount'],
    ['briefing_pr_status', 'prStatusBreakdown'],
    ['briefing_milestones', 'milestoneCount'],
    ['briefing_workflows', 'workflowCount'],
    ['briefing_workflow_status', 'workflowStatusBreakdown'],
    ['briefing_copilot', 'copilotReviews'],
    ['briefing_importance_threshold', 'briefingImportanceThreshold'],
    ['briefing_graph', 'graphPivots'],
    ['briefing_insights', 'insights'],
]

type StoredBriefingConfig = NonNullable<
    Parameters<ConfigManager['updateConfig']>[0]['briefingConfig']
>

function validateScopeConfigurationInputs(args: UpdateConfigurationArgs): string | undefined {
    if (args.workspace_id?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be configured as a write workspace."
        )
    }
    if (args.workspace_id?.trim() === '') {
        throw new ValidationError('workspace_id cannot be empty.')
    }
    if (args.workspace_id !== undefined && isForbiddenProjectKey(args.workspace_id)) {
        throw new ValidationError(`Invalid workspace_id '${args.workspace_id}'.`)
    }
    if (
        args.project_number !== undefined &&
        (!Number.isInteger(args.project_number) || args.project_number <= 0)
    ) {
        throw new ValidationError('project_number must be a positive integer.')
    }
    const trimmedInputWs = args.workspace_id?.trim()
    if (trimmedInputWs === undefined) return undefined
    return trimmedInputWs.toLowerCase() === 'default' ? 'default' : trimmedInputWs
}

function resolveScopeWorkspaceAndProject(
    args: UpdateConfigurationArgs,
    normalizedInputWs: string | undefined,
    registry: ToolHandlerConfig['projectRegistry'],
    newBc: StoredBriefingConfig,
    updatedKeys: string[]
): { nextWorkspaceId: string | undefined; nextProjectNumber: number | undefined } {
    let nextWorkspaceId = newBc.defaultWorkspaceId
    let nextProjectNumber = newBc.defaultProjectNumber

    if (normalizedInputWs !== undefined && args.project_number !== undefined) {
        const canonical = findCanonicalRegistryKey(normalizedInputWs, registry) ?? normalizedInputWs
        const exactKey = exactRegistryKey(canonical, activeProjectRegistry(registry)) ?? canonical
        const regProjNum = registry?.[exactKey]?.project_number
        if (regProjNum !== undefined && args.project_number !== regProjNum) {
            throw new ValidationError(
                `workspace '${exactKey}' uses project_number ${String(regProjNum)}, not ${String(args.project_number)}.`
            )
        }
    }

    if (args.project_number !== undefined) {
        nextProjectNumber = args.project_number
        if (normalizedInputWs === undefined) {
            const matches = Object.entries(registry ?? {}).filter(
                ([, entry]) => entry.project_number === args.project_number
            )
            if (matches.length > 1) {
                throw new ValidationError(
                    `project_number ${String(args.project_number)} is ambiguous across multiple workspaces.`
                )
            }
            if (matches[0] !== undefined) nextWorkspaceId = matches[0][0]
        }
        updatedKeys.push('project_number')
    }

    if (normalizedInputWs !== undefined) {
        const canonical =
            normalizedInputWs === 'default'
                ? 'default'
                : (findCanonicalRegistryKey(normalizedInputWs, registry) ?? normalizedInputWs)
        const exactKey =
            normalizedInputWs === 'default'
                ? 'default'
                : (exactRegistryKey(canonical, activeProjectRegistry(registry)) ?? canonical)
        nextWorkspaceId = exactKey
        if (args.project_number === undefined) {
            // [INVARIANT] H3: switching to an unnumbered workspace must clear the stale default
            // project so later writes are not paired with the previous project's number.
            nextProjectNumber = registry?.[exactKey]?.project_number
        }
        updatedKeys.push('workspace_id')
    }

    return { nextWorkspaceId, nextProjectNumber }
}

/** Validate and apply workspace_id / project_number scope updates without deep nesting. */
function applyScopeConfigurationUpdate(
    args: UpdateConfigurationArgs,
    newBc: StoredBriefingConfig,
    config: ToolHandlerConfig,
    updatedKeys: string[]
): boolean {
    const normalizedInputWs = validateScopeConfigurationInputs(args)
    if (args.workspace_id === undefined && args.project_number === undefined) {
        return false
    }

    const registry = newBc.projectRegistry ?? config.projectRegistry ?? loadProjectRegistryFromConfig()
    const { nextWorkspaceId, nextProjectNumber } = resolveScopeWorkspaceAndProject(
        args,
        normalizedInputWs,
        registry,
        newBc,
        updatedKeys
    )

    const paired = pairStoredScope(nextWorkspaceId, nextProjectNumber, activeProjectRegistry(registry))
    if (paired.workspaceId !== undefined) {
        newBc.defaultWorkspaceId = paired.workspaceId
        config.defaultWorkspaceId = paired.workspaceId
    } else {
        delete newBc.defaultWorkspaceId
        delete config.defaultWorkspaceId
    }
    if (typeof paired.projectNumber === 'number') {
        newBc.defaultProjectNumber = paired.projectNumber
        config.defaultProjectNumber = paired.projectNumber
    } else {
        delete newBc.defaultProjectNumber
        delete config.defaultProjectNumber
    }
    setActiveSessionProject(newBc.defaultWorkspaceId, newBc.defaultProjectNumber ?? null, config.runtime)
    return true
}

export function handleUpdateConfiguration(
    args: UpdateConfigurationArgs,
    config: ToolHandlerConfig
): Promise<{ success: boolean; updated: string[] }> {
    if (!config.runtime) throw new Error('Runtime is not available')
    const configManager = config.runtime.configManager as ConfigManager | undefined

    if (!configManager) {
        throw new Error('ConfigManager is not initialized in this runtime')
    }

    const updates: Partial<Parameters<ConfigManager['updateConfig']>[0]> = {}
    const updatedKeys: string[] = []
    const mutatedBriefingKeys: BriefingConfigurableKey[] = []
    const mutatedFields: MutatedConfigFields = {}

    if (args.tool_filter !== undefined) {
        updates.rawToolFilter = args.tool_filter
        updatedKeys.push('tool_filter')
        mutatedFields.rawToolFilter = true
    }

    const currentBriefingConfig = configManager.getConfig().briefingConfig
    const newBc = { ...currentBriefingConfig }
    for (const [argKey, target] of BRIEFING_ARG_TARGETS) {
        const value = args[argKey]
        if (value === undefined) continue
        Object.assign(newBc, { [target]: value })
        updatedKeys.push(argKey)
        mutatedBriefingKeys.push(target)
    }
    let bcChanged = mutatedBriefingKeys.length > 0
    if (mutatedBriefingKeys.length > 0) {
        mutatedFields.briefingKeys = mutatedBriefingKeys
    }
    if (applyScopeConfigurationUpdate(args, newBc, config, updatedKeys)) {
        bcChanged = true
        if (args.workspace_id !== undefined || newBc.defaultWorkspaceId !== undefined) {
            mutatedFields.defaultWorkspaceId = true
        }
        if (args.project_number !== undefined || args.workspace_id !== undefined) {
            mutatedFields.defaultProjectNumber = true
        }
    }

    if (bcChanged) {
        updates.briefingConfig = newBc
    }

    const persistError =
        Object.keys(updates).length > 0
            ? configManager.updateConfig(updates, true, { mutatedFields })
            : undefined

    return Promise.resolve({
        success: true,
        updated: updatedKeys,
        ...(updatedKeys.length === 0
            ? { warning: 'No recognized configuration keys were supplied; nothing was changed.' }
            : {}),
        ...(persistError !== undefined
            ? {
                  persisted: false,
                  warning: `Configuration applied to the running server but could not be written to the config file: ${persistError}`,
              }
            : {}),
    })
}
