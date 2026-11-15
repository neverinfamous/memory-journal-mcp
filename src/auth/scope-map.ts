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
import { hasMethodToken } from '../codemode/method-tokens.js'
import {
    DUMMY_HEALING_TOOL_NAMES,
    DUMMY_SQL_EXECUTION_TOOL_NAMES,
    DUMMY_ENTRY_CREATION_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
    DUMMY_GREP_SEARCH_TOOL_NAMES,
} from '../handlers/tools/core/dummy-healing/alias-catalog.js'

const DUMMY_SQL_EXEC_SET = new Set<string>(DUMMY_SQL_EXECUTION_TOOL_NAMES)
const DUMMY_ENTRY_CREATE_SET = new Set<string>(DUMMY_ENTRY_CREATION_TOOL_NAMES)
const DUMMY_FS_TOOL_SET = new Set<string>([
    ...DUMMY_FILE_VIEW_TOOL_NAMES,
    ...DUMMY_DIR_LIST_TOOL_NAMES,
    ...DUMMY_GREP_SEARCH_TOOL_NAMES,
])

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

const CORE_ADMIN_VERBS = ['delete', 'update', 'merge', 'restore', 'remove', 'prune', 'archive', 'rebuild']
const CORE_WRITE_VERBS = ['create', 'add', 'link', 'import', 'register']
const CORE_READ_VERBS = [
    'get',
    'list',
    'search',
    'count',
    'read',
    'help',
    'recent',
    'exists',
    'status',
    'health',
    'describe',
    'visualize',
    'stats',
    'statistics',
    'find',
]
const CORE_MUTATING_LEADING_VERBS = [
    'set',
    'mark',
    'toggle',
    'sync',
    'reset',
    'clear',
    'write',
    'save',
    'put',
    'patch',
    'move',
    'rename',
    'share',
    'close',
    'apply',
    'execute',
    'run',
    'send',
    'upsert',
    'insert',
    'drop',
    'purge',
]

/** Leading verb of a dotted/underscored Code Mode method (e.g. `mj.core.setStatus` -> `set`). */
function leadingMethodVerb(toolName: string): string {
    const method = toolName.replace(/^mj[._]core[._]/, '')
    const match = /^[a-z]+/.exec(method.replace(/^_+/, ''))
    return match !== null ? match[0].toLowerCase() : ''
}

function scopeForCoreMethod(toolName: string): StandardScope {
    if (CORE_ADMIN_VERBS.some((verb) => hasMethodToken(toolName, verb))) return SCOPES.ADMIN
    if (CORE_WRITE_VERBS.some((verb) => hasMethodToken(toolName, verb))) return SCOPES.WRITE
    // [INVARIANT] An incidental read token (e.g. `setStatus`, `markStale`) must not downgrade a
    // method whose leading verb mutates state to READ (H5).
    if (CORE_MUTATING_LEADING_VERBS.includes(leadingMethodVerb(toolName))) return SCOPES.ADMIN
    if (CORE_READ_VERBS.some((verb) => hasMethodToken(toolName, verb))) return SCOPES.READ
    return SCOPES.ADMIN
}

/** Resource URIs that require a non-READ scope. */
function scopeForResourceUri(uri: string): StandardScope {
    if (
        uri === 'memory://team' ||
        uri.startsWith('memory://team/') ||
        uri.startsWith('memory://team?') ||
        uri === 'memory://insights/team-collaboration' ||
        uri.startsWith('memory://insights/team-collaboration?')
    ) {
        return SCOPES.TEAM
    }
    if (uri === 'memory://audit' || uri.startsWith('memory://audit/') || uri.startsWith('memory://audit?')) {
        return SCOPES.AUDIT
    }
    return SCOPES.READ
}

export const TEAM_PROMPT_NAMES = new Set([
    'team-session-summary',
    'create-team-entry',
    'update-team-entry',
    'mj_team_session_summary',
    'mj_create_team_entry',
    'mj_update_team_entry',
])

export function getRequiredScope(toolName: string): StandardScope {
    const scope = toolScopeMap.get(toolName)
    if (scope) {
        return scope
    }

    // Dynamic fallback for synthetic & dotted Code Mode tools
    if (toolName.startsWith('mj.admin.') || toolName.startsWith('mj_admin_')) {
        return SCOPES.ADMIN
    }
    if (toolName.startsWith('mj.core.') || toolName.startsWith('mj_core_')) {
        return scopeForCoreMethod(toolName)
    }
    if (DUMMY_SQL_EXEC_SET.has(toolName) || DUMMY_FS_TOOL_SET.has(toolName)) {
        return SCOPES.ADMIN
    }
    if (DUMMY_ENTRY_CREATE_SET.has(toolName)) {
        return SCOPES.WRITE
    }
    if (toolName.startsWith('memory://')) {
        return scopeForResourceUri(toolName)
    }
    if (TEAM_PROMPT_NAMES.has(toolName)) {
        return SCOPES.TEAM
    }
    if (DUMMY_HEALING_TOOL_NAMES.has(toolName)) {
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
