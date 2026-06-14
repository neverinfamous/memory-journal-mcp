import { z } from 'zod'
import type { ToolHandlerConfig } from '../../../types/index.js'
import type { ConfigManager } from '../../../utils/config-manager.js'

export const updateConfigurationSchema = z.object({
    instruction_level: z.enum(['essential', 'standard', 'full']).optional(),
    tool_filter: z.string().optional(),
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
}).strict()

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

    if (args.instruction_level) {
        updates.instructionLevel = args.instruction_level
        updatedKeys.push('instruction_level')
    }
    
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
