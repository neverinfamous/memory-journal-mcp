import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { AuthorizationError } from '../../../types/errors.js'
import type { TeamRole } from '../../../database/core/interfaces.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveAuthor, sanitizeAuthor, nonEmptyAuthClaim } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'

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

function extractTargetWorkspaceId(
    params: unknown,
    config: ToolContext['config']
): string | undefined {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        const fallback = resolveWorkspaceId(undefined, undefined, config)
        return fallback !== '*' ? fallback : undefined
    }
    const wsProp: unknown = Reflect.get(params, 'workspace_id') ?? Reflect.get(params, 'workspaceId')
    const rawWs = typeof wsProp === 'string' ? wsProp : undefined
    if (rawWs?.trim() === '*') {
        return undefined
    }
    const projProp: unknown =
        Reflect.get(params, 'project_number') ?? Reflect.get(params, 'projectNumber')
    const numProj =
        typeof projProp === 'number' && Number.isInteger(projProp)
            ? projProp
            : typeof projProp === 'string' && /^\d+$/.test(projProp.trim())
              ? Number.parseInt(projProp.trim(), 10)
              : undefined
    try {
        const wsId = resolveWorkspaceId(rawWs, numProj, config)
        return wsId !== '*' ? wsId : undefined
    } catch {
        const trimmed = rawWs?.trim()
        return trimmed !== undefined && trimmed !== '' ? trimmed : undefined
    }
}

/**
 * Resolves the identity of the user calling the tool.
 * When OAuth authenticated, resolves strictly from claims (never falling back to TEAM_AUTHOR).
 */
export function getCallerIdentity(): string {
    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const claims = authCtx.claims
        const resolved =
            nonEmptyAuthClaim(claims?.['email']) ??
            nonEmptyAuthClaim(claims?.['preferred_username']) ??
            nonEmptyAuthClaim(claims?.sub) ??
            nonEmptyAuthClaim(claims?.['subject']) ??
            nonEmptyAuthClaim(claims?.client_id)
        if (resolved !== undefined) {
            const sanitized = sanitizeAuthor(resolved)
            if (sanitized.length > 0 && sanitized.toLowerCase() !== 'unknown') {
                return sanitized
            }
        }
        return 'unknown'
    }
    // For non-OAuth environments, fallback to the environment variable (TEAM_AUTHOR)
    return resolveAuthor()
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
    const fallbackWs = resolveWorkspaceId(undefined, undefined, config)
    const targetWs =
        workspaceId !== undefined && workspaceId.trim() !== ''
            ? workspaceId.trim()
            : fallbackWs !== '*'
              ? fallbackWs
              : undefined
    return resolveScopedTeamRole(teamDb, author, defaultRole, targetWs) === 'admin'
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

    // If RBAC table is empty, default to legacy full access
    if (teamDb.isTeamRbacActive !== undefined && !teamDb.isTeamRbacActive()) {
        return
    }

    const defaultRole = config?.teamDefaultRole ?? 'denied'
    const fallbackWs = resolveWorkspaceId(undefined, undefined, config)
    const targetWs =
        workspaceId !== undefined && workspaceId.trim() !== ''
            ? workspaceId.trim()
            : fallbackWs !== '*'
              ? fallbackWs
              : undefined
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
    workspaceId?: string
): void {
    if (role === 'admin') return // Admins can bypass ownership checks
    const effectiveCaller = canonicalizeTeamAuthor(teamDb, author, workspaceId)
    const effectiveOwner = canonicalizeTeamAuthor(teamDb, resourceAuthor, workspaceId)
    if (effectiveCaller.toLowerCase() !== effectiveOwner.toLowerCase()) {
        throw new AuthorizationError(`Access denied: cannot modify resource owned by '${resourceAuthor}'. Only the original author or an admin can modify this entry.`)
    }
}

/**
 * Ownership check that also covers entries with no recorded author.
 * When team RBAC is active (`role` is not null), an entry without an author can only be
 * modified by a team admin. With RBAC inactive (`role` null) the legacy full-access mode applies.
 */
export function enforceEntryOwnership(
    currentUser: string,
    entryAuthor: string | null | undefined,
    role: TeamRole | null,
    teamDb?: ToolContext['teamDb'],
    workspaceId?: string
): void {
    if (entryAuthor === null || entryAuthor === undefined || entryAuthor.trim() === '') {
        if (role === 'admin' || role === null) return
        throw new AuthorizationError(
            'Access denied: this entry has no recorded author. Only a team admin can modify it.'
        )
    }
    enforceOwnership(currentUser, entryAuthor, role, teamDb, workspaceId)
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
                const targetWs = extractTargetWorkspaceId(params, context.config)

                // Enforce role requirement
                enforceTeamRbac(context, author, requiredRole, targetWs)

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

