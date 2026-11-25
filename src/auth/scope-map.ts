/**
 * memory-journal-mcp — Tool Scope Map
 *
 * Builds a reverse lookup from tool name to required OAuth scope
 * by inverting TOOL_GROUPS × TOOL_GROUP_SCOPES. Computed once at
 * module load for O(1) per-call lookup.
 */

import { TOOL_GROUPS } from '../filtering/tool-constants.js'
import { isToolGroup, SCOPES, TOOL_GROUP_SCOPES, TOOL_SCOPE_OVERRIDES } from './scopes.js'
import type { StandardScope } from './scopes.js'
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
export const DUMMY_FS_TOOL_SET = new Set<string>([
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
    if (!isToolGroup(group)) continue
    const scope = TOOL_GROUP_SCOPES[group]
    for (const toolName of tools) {
        toolScopeMap.set(toolName, scope)
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
    const match = /^[A-Za-z][a-z]*/.exec(method.replace(/^_+/, ''))
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

/** Canonicalize a `memory://` URI (trim, lowercase scheme/host, decode percent escapes, collapse dot segments, strip fragment). */
export function canonicalizeMemoryResourceUri(rawUri: string): string {
    const trimmed = rawUri.trim().replace(/#.*$/, '')
    if (!/^memory:\/\//i.test(trimmed)) return trimmed
    try {
        const parsed = new URL(trimmed)
        let decodedPath = parsed.pathname
        try {
            decodedPath = decodeURIComponent(parsed.pathname)
        } catch {
            // Keep raw pathname if percent-encoding is malformed
        }
        let decodedHost = parsed.hostname
        try {
            decodedHost = decodeURIComponent(parsed.hostname)
        } catch {
            // Keep raw hostname if percent-encoding is malformed
        }
        const normalizedHost = decodedHost.toLowerCase()
        const normalizedSegments: string[] = []
        for (const seg of decodedPath.split('/')) {
            if (seg === '' || seg === '.') continue
            if (seg === '..') {
                normalizedSegments.pop()
                continue
            }
            normalizedSegments.push(seg)
        }
        const pathSuffix =
            normalizedSegments.length > 0 ? `/${normalizedSegments.join('/')}` : ''
        return `memory://${normalizedHost}${pathSuffix}${parsed.search}`
    } catch {
        return trimmed.toLowerCase()
    }
}

export function normalizePromptAliasForScope(name: string): string {
    return name
        .trim()
        .replace(/^mj[_-]/i, '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase()
}

/** Resource URIs that require a non-READ scope. */
function scopeForResourceUri(uri: string): StandardScope {
    const baseUri = canonicalizeMemoryResourceUri(uri).toLowerCase()
    if (
        baseUri === 'memory://team' ||
        baseUri.startsWith('memory://team/') ||
        baseUri.startsWith('memory://team?') ||
        baseUri === 'memory://insights/team-collaboration' ||
        baseUri.startsWith('memory://insights/team-collaboration/') ||
        baseUri.startsWith('memory://insights/team-collaboration?')
    ) {
        return SCOPES.TEAM
    }
    if (
        baseUri === 'memory://audit' ||
        baseUri.startsWith('memory://audit/') ||
        baseUri.startsWith('memory://audit?') ||
        baseUri === 'memory://metrics/users' ||
        baseUri.startsWith('memory://metrics/users/') ||
        baseUri.startsWith('memory://metrics/users?')
    ) {
        return SCOPES.AUDIT
    }
    return SCOPES.READ
}

export const TEAM_PROMPT_NAMES = new Set([
    'team-session-summary',
    'create-team-entry',
    'update-team-entry',
    'team_session_summary',
    'mj_team_session_summary',
    'mj_create_team_entry',
    'mj_update_team_entry',
])

export const ADMIN_PROMPT_NAMES = new Set([
    'project-setup',
    'optimize-journal',
    'cms-rem-supervisor',
    'project_setup',
    'optimize_journal',
    'cms_rem_supervisor',
])

export function getRequiredScope(toolName: string): StandardScope {
    const trimmedName = toolName.trim()
    const scope = toolScopeMap.get(trimmedName)
    if (scope) {
        return scope
    }

    // Dynamic fallback for synthetic & dotted Code Mode tools
    if (trimmedName.startsWith('mj.admin.') || trimmedName.startsWith('mj_admin_')) {
        return SCOPES.ADMIN
    }
    if (trimmedName.startsWith('mj.core.') || trimmedName.startsWith('mj_core_')) {
        return scopeForCoreMethod(trimmedName)
    }
    if (DUMMY_SQL_EXEC_SET.has(trimmedName) || DUMMY_FS_TOOL_SET.has(trimmedName)) {
        return SCOPES.ADMIN
    }
    if (DUMMY_ENTRY_CREATE_SET.has(trimmedName)) {
        return SCOPES.WRITE
    }
    if (/^memory:\/\//i.test(trimmedName)) {
        return scopeForResourceUri(trimmedName)
    }
    const normalizedPrompt = normalizePromptAliasForScope(trimmedName)
    if (TEAM_PROMPT_NAMES.has(trimmedName) || TEAM_PROMPT_NAMES.has(normalizedPrompt)) {
        return SCOPES.TEAM
    }
    if (ADMIN_PROMPT_NAMES.has(trimmedName) || ADMIN_PROMPT_NAMES.has(normalizedPrompt)) {
        return SCOPES.ADMIN
    }
    if (DUMMY_HEALING_TOOL_NAMES.has(trimmedName)) {
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
