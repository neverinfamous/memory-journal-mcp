import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getMcpFallbackToolDefinitions } from './mcp-fallbacks.js'
import { getFsFallbackToolDefinitions } from './fs-fallbacks.js'
import { getEntryAndCodemodeFallbackToolDefinitions } from './entry-fallbacks.js'

export * from './alias-catalog.js'
export * from './mcp-fallbacks.js'
export * from './fs-fallbacks.js'
export * from './entry-fallbacks.js'

export function getDummyHealingTools(context?: ToolContext): ToolDefinition[] {
    return [
        ...getEntryAndCodemodeFallbackToolDefinitions(context),
        ...getMcpFallbackToolDefinitions(context),
        ...getFsFallbackToolDefinitions(context),
    ]
}
