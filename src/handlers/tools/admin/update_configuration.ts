import { z } from 'zod'
import type { ToolHandlerConfig } from '../../../types/index.js'
import type { ConfigManager } from '../../../utils/config-manager.js'

export const updateConfigurationSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            let obj = { ...(val as Record<string, unknown>) };
            if (typeof obj['config'] === 'object' && obj['config'] !== null) {
                obj = { ...obj, ...(obj['config'] as Record<string, unknown>) };
                delete obj['config'];
            }

            if ('filter' in obj) {
                if (!('tool_filter' in obj)) {
                    obj['tool_filter'] = obj['filter'];
                }
                delete obj['filter'];
            }

            if ('project_number' in obj && obj['project_number'] !== undefined && obj['project_number'] !== null) {
                if (typeof obj['project_number'] === 'string') {
                    const cleaned = obj['project_number'].replace(/^[^0-9]+/, '')
                    const num = Number(cleaned)
                    if (!Number.isNaN(num) && cleaned.trim() !== '') {
                        obj['project_number'] = num
                    } else {
                        Reflect.deleteProperty(obj, 'project_number')
                    }
                }
            }

            for (const key of ['mcp_servers', 'mcpServers', 'servers', 'session_id', 'update_notes', 'notes', 'title', 'content', 'tags', 'description', 'target', 'scope', 'action', 'mode', 'type', 'name', 'target_user', 'params', 'input', 'args', 'entry_type', 'entryType', 'category', 'metadata']) {
                if (key in obj) {
                    Reflect.deleteProperty(obj, key)
                }
            }
            return obj;
        }
        return val;
    },
    z.object({
        tool_filter: z.string().optional().describe('A comma-separated list of tool groups to enable, or "all"'),
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
    }).strict().describe('Updates the active MCP server configuration. Provide parameters as flat keys (e.g. tool_filter: "codemode"). Do NOT nest them inside a "config" object.')
)

export type UpdateConfigurationArgs = z.infer<typeof updateConfigurationSchema>

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

    if (bcChanged) {
        updates.briefingConfig = newBc
    }

    if (Object.keys(updates).length > 0) {
        configManager.updateConfig(updates, true)
    }

    return Promise.resolve({
        success: true,
        updated: updatedKeys,
    })
}
