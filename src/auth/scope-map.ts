/**
 * memory-journal-mcp — Tool Scope Map
 *
 * Builds a reverse lookup from tool name to required OAuth scope
 * by inverting TOOL_GROUPS × TOOL_GROUP_SCOPES. Computed once at
 * module load for O(1) per-call lookup.
 */

import { TOOL_GROUPS } from '../filtering/tool-filter.js'
import { TOOL_GROUP_SCOPES, TOOL_SCOPE_OVERRIDES } from './scopes.js'
import type { StandardScope } from './scopes.js'
import type { ToolGroup } from '../types/index.js'

/**
 * Map from tool name to required minimum scope.
 * Built by inverting TOOL_GROUPS (group → tools[]) and
 * TOOL_GROUP_SCOPES (group → scope).
 */
const toolScopeMap = new Map<string, StandardScope>()

// Build the reverse map at module load
for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    const scope = TOOL_GROUP_SCOPES[group as ToolGroup]
    if (scope) {
        for (const toolName of tools) {
            toolScopeMap.set(toolName, scope)
        }
    }
}

// Per-tool scope overrides
for (const [toolName, scope] of Object.entries(TOOL_SCOPE_OVERRIDES)) {
    toolScopeMap.set(toolName, scope)
}

export function getRequiredScope(toolName: string): StandardScope {
    const scope = toolScopeMap.get(toolName)
    if (!scope) {
        throw new Error(`CRITICAL SECURITY FAILURE: Tool '${toolName}' is missing from scope mapping`)
    }
    return scope
}

/**
 * Get the full tool-to-scope map (for testing/debugging).
 */
export function getToolScopeMap(): ReadonlyMap<string, StandardScope> {
    return toolScopeMap
}
