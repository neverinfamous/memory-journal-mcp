/**
 * memory-journal-mcp — Tool Scope Map
 *
 * Builds a reverse lookup from tool name to required OAuth scope
 * by inverting TOOL_GROUPS × TOOL_GROUP_SCOPES. Computed once at
 * module load for O(1) per-call lookup.
 */

import { TOOL_GROUPS } from '../filtering/tool-constants.js'
import { SCOPES, TOOL_GROUP_SCOPES, TOOL_SCOPE_OVERRIDES } from './scopes.js'
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
    if (scope) {
        return scope
    }

    // Dynamic fallback for synthetic & dotted Code Mode tools
    if (toolName.startsWith('mj.admin.')) {
        return SCOPES.ADMIN
    }
    if (toolName.startsWith('mj.core.')) {
        const lower = toolName.toLowerCase()
        if (lower.includes('update') || lower.includes('delete')) {
            return SCOPES.ADMIN
        }
        if (lower.includes('create')) {
            return SCOPES.WRITE
        }
        return SCOPES.READ
    }
    if (
        toolName === 'read_resource' ||
        toolName === 'mj_read_resource' ||
        toolName === 'load-briefing' ||
        toolName === 'mj_session_summary'
    ) {
        return SCOPES.READ
    }

    throw new Error(
        `CRITICAL SECURITY FAILURE: Tool '${toolName}' is missing from scope mapping`
    )
}

/**
 * Get the full tool-to-scope map (for testing/debugging).
 */
export function getToolScopeMap(): ReadonlyMap<string, StandardScope> {
    return toolScopeMap
}
