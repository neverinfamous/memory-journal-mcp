/**
 * memory-journal-mcp — Tool Scope Map
 *
 * Builds a reverse lookup from tool name to required OAuth scope
 * by inverting TOOL_GROUPS × TOOL_GROUP_SCOPES. Computed once at
 * module load for O(1) per-call lookup.
 */

import { TOOL_GROUPS } from '../filtering/ToolFilter.js'
import { TOOL_GROUP_SCOPES, SCOPES } from './scopes.js'
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

/**
 * Get the required scope for a tool by name.
 *
 * @param toolName - The MCP tool name (e.g., "create_entry")
 * @returns The required scope, or "read" as a safe default for unknown tools
 */
export function getRequiredScope(toolName: string): StandardScope {
    return toolScopeMap.get(toolName) ?? SCOPES.READ
}

/**
 * Get the full tool-to-scope map (for testing/debugging).
 */
export function getToolScopeMap(): ReadonlyMap<string, StandardScope> {
    return toolScopeMap
}
