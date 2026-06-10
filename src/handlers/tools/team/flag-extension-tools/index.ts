import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getListFlagsTool } from './list-flags.js'
import { getUpdateFlagTool } from './update-flag.js'
import { getFlagAnalyticsTool } from './analytics.js'

export function getTeamFlagExtensionTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getListFlagsTool(context),
        ...getUpdateFlagTool(context),
        ...getFlagAnalyticsTool(context),
    ]
}
