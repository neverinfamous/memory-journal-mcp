import type { ToolContext, ToolDefinition } from '../../../../types/index.js'

/**
 * Look up a target tool definition in O(1) from `runtime.toolMapCache` when warm,
 * falling back to building the requested group array when uncached (e.g., unit tests).
 */
export function findCachedOrFallbackTool(
    context: ToolContext,
    toolName: string,
    buildGroup: (ctx: ToolContext) => ToolDefinition[]
): ToolDefinition | undefined {
    const cached = context.config?.runtime?.toolMapCache?.get(toolName)
    if (cached !== undefined) return cached
    return buildGroup(context).find((t) => t.name === toolName)
}
