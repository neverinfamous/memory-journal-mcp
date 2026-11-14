import { z } from 'zod'
import type { ToolHandlerConfig } from '../../../types/index.js'
import type { ConfigManager } from '../../../utils/config-manager.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    setActiveSessionProject,
} from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, exactRegistryKey, pairStoredScope } from '../../../utils/write-scope.js'
import { ValidationError } from '../../../types/errors.js'
import { relaxedNumber } from '../schemas.js'

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

        if (
            'project_number' in obj &&
            obj['project_number'] !== undefined &&
            obj['project_number'] !== null
        ) {
            if (typeof obj['project_number'] === 'string') {
                const trimmed = obj['project_number'].trim()
                const pMatch = /^(?:#|p-?)?(\d+)$/i.exec(trimmed) ?? /^(-?\d+)$/.exec(trimmed)
                if (pMatch?.[1] !== undefined) {
                    obj['project_number'] = Number(pMatch[1])
                } else {
                    delete obj['project_number']
                }
            }
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
            briefing_entries: z.number().int().min(0).optional(),
            briefing_summaries: z.number().int().min(0).optional(),
            briefing_include_team: z.boolean().optional(),
            briefing_issues: z.number().int().min(0).optional(),
            briefing_prs: z.number().int().min(0).optional(),
            briefing_pr_status: z.boolean().optional(),
            briefing_milestones: z.number().int().min(0).optional(),
            briefing_workflows: z.number().int().min(0).optional(),
            briefing_workflow_status: z.boolean().optional(),
            briefing_copilot: z.boolean().optional(),
            project_number: z.number().int().optional(),
            workspace_id: z.string().optional(),
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
            briefing_summaries: relaxedNumber().optional(),
            briefing_include_team: z.boolean().optional(),
            briefing_issues: relaxedNumber().optional(),
            briefing_prs: relaxedNumber().optional(),
            briefing_pr_status: z.boolean().optional(),
            briefing_milestones: relaxedNumber().optional(),
            briefing_workflows: relaxedNumber().optional(),
            briefing_workflow_status: z.boolean().optional(),
            briefing_copilot: z.boolean().optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
        .describe(
            'Updates the active MCP server configuration. Provide parameters as flat keys (e.g. tool_filter: "codemode"). Do NOT nest them inside a "config" object.'
        )
)

export type UpdateConfigurationArgs = z.infer<typeof updateConfigurationSchema>

type StoredBriefingConfig = NonNullable<
    Parameters<ConfigManager['updateConfig']>[0]['briefingConfig']
>

/** Validate and apply workspace_id / project_number scope updates without deep nesting. */
function applyScopeConfigurationUpdate(
    args: UpdateConfigurationArgs,
    newBc: StoredBriefingConfig,
    config: ToolHandlerConfig,
    updatedKeys: string[]
): boolean {
    if (args.workspace_id?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be configured as a write workspace."
        )
    }
    if (args.workspace_id === undefined && args.project_number === undefined) {
        return false
    }

    const registry = newBc.projectRegistry ?? config.projectRegistry ?? loadProjectRegistryFromConfig()
    let nextWorkspaceId = newBc.defaultWorkspaceId
    let nextProjectNumber = newBc.defaultProjectNumber

    if (args.workspace_id !== undefined && args.project_number !== undefined) {
        const canonical = findCanonicalRegistryKey(args.workspace_id, registry) ?? args.workspace_id
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
        if (args.workspace_id === undefined) {
            nextWorkspaceId = Object.entries(registry ?? {}).find(
                ([, entry]) => entry.project_number === args.project_number
            )?.[0]
        }
        updatedKeys.push('project_number')
    }

    if (args.workspace_id !== undefined) {
        const canonical = findCanonicalRegistryKey(args.workspace_id, registry) ?? args.workspace_id
        const exactKey = exactRegistryKey(canonical, activeProjectRegistry(registry)) ?? canonical
        const regProjNum = registry?.[exactKey]?.project_number
        nextWorkspaceId = exactKey
        if (args.project_number === undefined) {
            // [INVARIANT] H3: switching to an unnumbered workspace must clear the stale default
            // project so later writes are not paired with the previous project's number.
            nextProjectNumber = regProjNum
        }
        updatedKeys.push('workspace_id')
    }

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
    setActiveSessionProject(newBc.defaultWorkspaceId, newBc.defaultProjectNumber, config.runtime)
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

    if (args.tool_filter !== undefined) {
        updates.rawToolFilter = args.tool_filter
        updatedKeys.push('tool_filter')
    }

    const currentBriefingConfig = configManager.getConfig().briefingConfig
    let bcChanged = false
    const newBc = { ...currentBriefingConfig }

    if (args.briefing_entries !== undefined) { newBc.entryCount = args.briefing_entries; bcChanged = true; updatedKeys.push('briefing_entries'); }
    if (args.briefing_summaries !== undefined) { newBc.summaryCount = args.briefing_summaries; bcChanged = true; updatedKeys.push('briefing_summaries'); }
    if (args.briefing_include_team !== undefined) { newBc.includeTeam = args.briefing_include_team; bcChanged = true; updatedKeys.push('briefing_include_team'); }
    if (args.briefing_issues !== undefined) { newBc.issueCount = args.briefing_issues; bcChanged = true; updatedKeys.push('briefing_issues'); }
    if (args.briefing_prs !== undefined) { newBc.prCount = args.briefing_prs; bcChanged = true; updatedKeys.push('briefing_prs'); }
    if (args.briefing_pr_status !== undefined) { newBc.prStatusBreakdown = args.briefing_pr_status; bcChanged = true; updatedKeys.push('briefing_pr_status'); }
    if (args.briefing_milestones !== undefined) { newBc.milestoneCount = args.briefing_milestones; bcChanged = true; updatedKeys.push('briefing_milestones'); }
    if (args.briefing_workflows !== undefined) { newBc.workflowCount = args.briefing_workflows; bcChanged = true; updatedKeys.push('briefing_workflows'); }
    if (args.briefing_workflow_status !== undefined) { newBc.workflowStatusBreakdown = args.briefing_workflow_status; bcChanged = true; updatedKeys.push('briefing_workflow_status'); }
    if (args.briefing_copilot !== undefined) { newBc.copilotReviews = args.briefing_copilot; bcChanged = true; updatedKeys.push('briefing_copilot'); }

    if (applyScopeConfigurationUpdate(args, newBc, config, updatedKeys)) {
        bcChanged = true
    }

    if (bcChanged) {
        updates.briefingConfig = newBc
    }

    const persistError =
        Object.keys(updates).length > 0 ? configManager.updateConfig(updates, true) : undefined

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
