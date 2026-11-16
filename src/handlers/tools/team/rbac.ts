import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { AuthorizationError } from '../../../types/errors.js'
import type { TeamRole } from '../../../database/core/interfaces.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import {
    findCanonicalRegistryKey,
    resolveWorkspaceFromFilePath,
    resolveWorkspaceId,
} from '../../../utils/workspace-resolver.js'

import { formatHandlerError } from '../../../utils/error-helpers.js'

function roleRank(role: TeamRole | null): number {
    if (role === 'admin') return 3
    if (role === 'member') return 2
    if (role === 'viewer') return 1
    return 0
}

/**
 * Resolves `author` via workspace-scoped alias mapping when a concrete workspace ID is available.
 * Never invokes unscoped `'*'` alias resolution so aliases cannot bleed across tenants.
 */
export function canonicalizeTeamAuthor(
    teamDb: ToolContext['teamDb'],
    author: string,
    workspaceId?: string
): string {
    const trimmedWs = workspaceId?.trim()
    if (
        !teamDb ||
        typeof teamDb.resolveAuthor !== 'function' ||
        trimmedWs === undefined ||
        trimmedWs === '' ||
        trimmedWs === '*'
    ) {
        return author
    }
    return teamDb.resolveAuthor(author, trimmedWs)
}

function normalizeResolvedRole(role: unknown): TeamRole | null {
    return role === 'admin' || role === 'member' || role === 'viewer' ? role : null
}

/**
 * Resolves the caller's effective TeamRole using both direct membership and workspace-scoped alias canonicalization.
 */
export function resolveScopedTeamRole(
    teamDb: ToolContext['teamDb'],
    author: string,
    defaultRole: TeamRole | 'denied',
    workspaceId?: string
): TeamRole | null {
    if (!teamDb || typeof teamDb.resolveTeamRole !== 'function') {
        return defaultRole === 'denied' ? null : defaultRole
    }
    const directRole = normalizeResolvedRole(teamDb.resolveTeamRole(author, defaultRole))
    if (directRole === 'admin') {
        return 'admin'
    }
    const canonical = canonicalizeTeamAuthor(teamDb, author, workspaceId)
    if (canonical !== author) {
        const canonicalRole = normalizeResolvedRole(teamDb.resolveTeamRole(canonical, defaultRole))
        if (roleRank(canonicalRole) > roleRank(directRole)) {
            return canonicalRole
        }
    }
    return directRole
}

function resolveTargetWorkspace(
    workspaceId: string | undefined,
    config: ToolContext['config']
): string | undefined {
    const trimmed = workspaceId?.trim()
    if (trimmed === '*') return '*'
    if (trimmed !== undefined && trimmed !== '') return trimmed
    const fallbackWs = resolveWorkspaceId(undefined, undefined, config)
    return fallbackWs !== '*' ? fallbackWs : '*'
}

const GLOBAL_TEAM_TOOLS = new Set([
    'team_add_member',
    'team_remove_member',
    'team_update_member_role',
    'team_list_members',
    'team_get_member',
    'team_backup',
    'team_list_backups',
    'team_get_vector_index_stats',
])

const WORKSPACE_SCOPE_KEYS = [
    'workspace_id',
    'workspaceId',
    'workspace',
    'repo',
    'repo_name',
    'repoName',
    'repository',
] as const

const PROJECT_SCOPE_KEYS = [
    'project_number',
    'projectNumber',
    'project_id',
    'projectId',
    'project',
] as const

const REPO_ALIAS_KEYS = new Set(['repo', 'repo_name', 'repoName', 'repository'])

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function collectScopeContainers(params: unknown): Record<string, unknown>[] {
    if (!isPlainRecord(params)) return []
    const containers: Record<string, unknown>[] = [params]
    for (const nestedKey of ['filters', 'filter', 'entry'] as const) {
        const nested = params[nestedKey]
        if (isPlainRecord(nested)) containers.push(nested)
    }
    return containers
}

function readFirstScopeProp(
    containers: Record<string, unknown>[],
    keys: readonly string[]
): { key: string; value: unknown } | undefined {
    for (const container of containers) {
        for (const key of keys) {
            const val = container[key]
            if (val !== undefined && val !== null) return { key, value: val }
        }
    }
    return undefined
}

function normalizeRepoOrWorkspaceRaw(
    rawWs: string,
    key: string,
    config: ToolContext['config']
): string {
    const trimmed = rawWs.trim()
    if (trimmed === '*' || !REPO_ALIAS_KEYS.has(key)) return trimmed
    const registry = config?.projectRegistry
    const directKey = findCanonicalRegistryKey(trimmed, registry)
    if (directKey !== undefined) return directKey
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        const leaf = trimmed.split(/[/\\]/).filter(Boolean).pop()?.trim()
        if (leaf !== undefined && leaf !== '') {
            return findCanonicalRegistryKey(leaf, registry) ?? leaf
        }
    }
    return trimmed
}

function extractTargetWorkspaceId(
    params: unknown,
    config: ToolContext['config']
): string | undefined {
    const containers = collectScopeContainers(params)
    if (containers.length === 0) {
        return resolveWorkspaceId(undefined, undefined, config)
    }
    const wsHit = readFirstScopeProp(containers, WORKSPACE_SCOPE_KEYS)
    const rawWs =
        wsHit !== undefined && typeof wsHit.value === 'string'
            ? normalizeRepoOrWorkspaceRaw(wsHit.value, wsHit.key, config)
            : undefined
    if (rawWs === '*') {
        return '*'
    }
    const projHit = readFirstScopeProp(containers, PROJECT_SCOPE_KEYS)
    const projProp = projHit?.value
    const numProj =
        typeof projProp === 'number' && Number.isInteger(projProp)
            ? projProp
            : typeof projProp === 'string' && /^\d+$/.test(projProp.trim())
              ? Number.parseInt(projProp.trim(), 10)
              : undefined
    if ((rawWs === undefined || rawWs === '') && numProj === undefined) {
        const pathHit = readFirstScopeProp(containers, [
            'source_dir',
            'sourceDir',
            'output_dir',
            'outputDir',
        ])
        if (pathHit !== undefined && typeof pathHit.value === 'string' && pathHit.value.trim() !== '') {
            const pathCtx = resolveWorkspaceFromFilePath(pathHit.value.trim(), config)
            if (pathCtx !== undefined && pathCtx.workspaceId !== '') {
                return pathCtx.workspaceId
            }
        }
    }
    try {
        return resolveWorkspaceId(rawWs !== '' ? rawWs : undefined, numProj, config)
    } catch {
        return rawWs !== undefined && rawWs !== '' ? rawWs : undefined
    }
}

function collectExtraTargetWorkspaces(
    params: unknown,
    primaryWs: string | undefined,
    config: ToolContext['config']
): string[] {
    if (!isPlainRecord(params)) return []
    const extras: string[] = []
    const seen = new Set<string>(primaryWs !== undefined ? [primaryWs.toLowerCase()] : [])
    const addCandidate = (ws: string | undefined): void => {
        if (ws === undefined || ws === '') return
        const lower = ws.toLowerCase()
        if (!seen.has(lower)) {
            seen.add(lower)
            extras.push(ws)
        }
    }
    for (const container of collectScopeContainers(params)) {
        const destRaw = container['target_workspace_id'] ?? container['targetWorkspaceId']
        if (typeof destRaw === 'string' && destRaw.trim() !== '') {
            addCandidate(destRaw.trim())
        }
    }
    for (const listKey of ['updates', 'entries'] as const) {
        const list = params[listKey]
        if (!Array.isArray(list)) continue
        for (const item of list) {
            if (!isPlainRecord(item)) continue
            addCandidate(extractTargetWorkspaceId(item, config))
            const itemDest = item['target_workspace_id'] ?? item['targetWorkspaceId']
            if (typeof itemDest === 'string' && itemDest.trim() !== '') {
                addCandidate(itemDest.trim())
            }
        }
    }
    return extras
}

/**
 * Resolves the identity of the user calling the tool.
 * When OAuth authenticated, resolves strictly from claims (never falling back to TEAM_AUTHOR).
 */
export function getCallerIdentity(): string {
    return resolveAuthenticatedAuthor()
}

/**
 * Checks whether the resolved team author holds an active 'admin' role when Team RBAC is enabled.
 */
export function isCallerTeamAdmin(
    teamDb: ToolContext['teamDb'],
    author: string,
    config: ToolContext['config'],
    workspaceId?: string
): boolean {
    if (!teamDb || typeof teamDb.isTeamRbacActive !== 'function' || !teamDb.isTeamRbacActive()) {
        return false
    }
    const defaultRole = config?.teamDefaultRole ?? 'denied'
    const targetWs = resolveTargetWorkspace(workspaceId, config)
    return resolveScopedTeamRole(teamDb, author, defaultRole, targetWs) === 'admin'
}

/**
 * Silent Team RBAC read check for mixed personal+team search tools and hints.
 * Returns true when Team DB is absent/inactive or caller has >= 'viewer' role.
 */
export function canReadTeamEntriesRbac(
    teamDb: ToolContext['teamDb'],
    config: ToolContext['config'],
    workspaceId?: string
): boolean {
    if (!teamDb || typeof teamDb.isTeamRbacActive !== 'function' || !teamDb.isTeamRbacActive()) {
        return true
    }
    const caller = resolveAuthenticatedAuthor()
    const targetWs = resolveTargetWorkspace(workspaceId, config)
    const role = resolveScopedTeamRole(teamDb, caller, config?.teamDefaultRole ?? 'denied', targetWs)
    return role !== null
}

/**
 * Enforces role-based access control for team tools.
 *
 * @throws {AuthorizationError} if the user does not have the required role or is denied.
 */
export function enforceTeamRbac(
    context: ToolContext,
    author: string,
    requiredRole: TeamRole = 'viewer',
    workspaceId?: string
): void {
    const { teamDb, config } = context
    if (!teamDb) return // Let the original handler return TEAM_DB_ERROR_RESPONSE

    // If RBAC table is empty (or adapter mock omits isTeamRbacActive), default to legacy full access
    if (typeof teamDb.isTeamRbacActive !== 'function' || !teamDb.isTeamRbacActive()) {
        return
    }

    const defaultRole = config?.teamDefaultRole ?? 'denied'
    const targetWs = resolveTargetWorkspace(workspaceId, config)
    const role = resolveScopedTeamRole(teamDb, author, defaultRole, targetWs)

    if (role === null) {
        throw new AuthorizationError(`Access denied: author '${author}' is not registered and default role is 'denied'`)
    }

    if (requiredRole === 'admin' && role !== 'admin') {
        throw new AuthorizationError(`Access denied: required 'admin' role, but author '${author}' has '${role}'`)
    }

    if (requiredRole === 'member' && role === 'viewer') {
        throw new AuthorizationError(`Access denied: required 'member' role, but author '${author}' has 'viewer'`)
    }
}

/**
 * Enforces ownership rules for mutating entries.
 * Admins can modify any entry, but members can only modify their own.
 *
 * @throws {AuthorizationError} if a non-admin tries to modify someone else's entry.
 */
export function enforceOwnership(
    author: string,
    resourceAuthor: string,
    role: TeamRole | null,
    teamDb?: ToolContext['teamDb'],
    workspaceId?: string,
    rbacActive = false
): void {
    if (rbacActive && (role === null || role === 'viewer')) {
        throw new AuthorizationError(
            `Access denied: role '${role ?? 'denied'}' cannot modify team entries.`
        )
    }
    if (role === 'admin') return // Admins can bypass ownership checks
    const effectiveCaller = canonicalizeTeamAuthor(teamDb, author, workspaceId)
    const effectiveOwner = canonicalizeTeamAuthor(teamDb, resourceAuthor, workspaceId)
    if (effectiveCaller.toLowerCase() !== effectiveOwner.toLowerCase()) {
        throw new AuthorizationError(`Access denied: cannot modify resource owned by '${resourceAuthor}'. Only the original author or an admin can modify this entry.`)
    }
}

/**
 * Ownership check that also covers entries with no recorded author.
 * When team RBAC is active, an entry without an author can only be modified by a team admin.
 */
export function enforceEntryOwnership(
    currentUser: string,
    entryAuthor: string | null | undefined,
    role: TeamRole | null,
    teamDb?: ToolContext['teamDb'],
    workspaceId?: string,
    rbacActive = false
): void {
    if (entryAuthor === null || entryAuthor === undefined || entryAuthor.trim() === '') {
        if (role === 'admin' || (!rbacActive && role === null)) return
        throw new AuthorizationError(
            'Access denied: this entry has no recorded author. Only a team admin can modify it.'
        )
    }
    enforceOwnership(currentUser, entryAuthor, role, teamDb, workspaceId, rbacActive)
}

/**
 * Wraps tool handlers to enforce Team RBAC automatically.
 * Automatically infers 'viewer' for read-only tools, and uses defaultRequiredRole for others.
 * Tools explicitly requiring admin scope will demand 'admin'.
 */
export function wrapWithRbac(context: ToolContext, tools: ToolDefinition[], defaultRequiredRole: TeamRole = 'member'): ToolDefinition[] {
    return tools.map(tool => {
        const originalHandler = tool.handler
        
        let requiredRole: TeamRole = defaultRequiredRole
        if (tool.capabilities?.requiresAdminScope) {
            requiredRole = 'admin'
        } else if (tool.annotations.readOnlyHint) {
            requiredRole = 'viewer'
        }

        tool.handler = async (params: unknown) => {
            try {
                // Determine caller identity
                const author = getCallerIdentity()
                const isGlobal = GLOBAL_TEAM_TOOLS.has(tool.name)
                const targetWs = isGlobal ? '*' : extractTargetWorkspaceId(params, context.config)

                // Enforce role requirement
                enforceTeamRbac(context, author, requiredRole, targetWs)
                if (!isGlobal) {
                    for (const extraWs of collectExtraTargetWorkspaces(
                        params,
                        targetWs,
                        context.config
                    )) {
                        enforceTeamRbac(context, author, requiredRole, extraWs)
                    }
                }

                // Execute original handler
                const result = await originalHandler(params)
                return result
            } catch (err) {
                return formatHandlerError(err)
            }
        }
        return tool
    })
}

