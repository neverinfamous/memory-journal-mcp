import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { AuthorizationError } from '../../../types/errors.js'
import type { TeamRole } from '../../../database/core/interfaces.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { collectAllTargetWorkspaces } from './rbac-scope-target.js'

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
    if (typeof teamDb.getTeamMember === 'function') {
        if (typeof teamDb.isTeamRbacActive === 'function' && !teamDb.isTeamRbacActive()) {
            return 'admin'
        }
        const directMember = teamDb.getTeamMember(author)
        if (directMember !== null && directMember !== undefined) {
            return normalizeResolvedRole(directMember.role)
        }
        const canonical = canonicalizeTeamAuthor(teamDb, author, workspaceId)
        if (canonical !== author) {
            const canonicalRole = normalizeResolvedRole(teamDb.resolveTeamRole(canonical, 'denied'))
            if (canonicalRole !== null) {
                return canonicalRole
            }
        }
        return defaultRole === 'denied' ? null : defaultRole
    }
    const directRole = normalizeResolvedRole(teamDb.resolveTeamRole(author, defaultRole))
    if (directRole === 'admin') {
        return 'admin'
    }
    const canonical = canonicalizeTeamAuthor(teamDb, author, workspaceId)
    if (canonical !== author) {
        const canonicalRole = normalizeResolvedRole(teamDb.resolveTeamRole(canonical, 'denied'))
        if (canonicalRole !== null) {
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
    rbacActive = false,
    canonicalizeFn?: (name: string, ws?: string) => string
): void {
    if (rbacActive && (role === null || role === 'viewer')) {
        throw new AuthorizationError(
            `Access denied: role '${role ?? 'denied'}' cannot modify team entries.`
        )
    }
    if (role === 'admin') return // Admins can bypass ownership checks
    const canonicalize = canonicalizeFn ?? ((name: string, ws?: string) => canonicalizeTeamAuthor(teamDb, name, ws))
    const effectiveCaller = canonicalize(author, workspaceId)
    const effectiveOwner = canonicalize(resourceAuthor, workspaceId)
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
    rbacActive = false,
    canonicalizeFn?: (name: string, ws?: string) => string
): void {
    if (entryAuthor === null || entryAuthor === undefined || entryAuthor.trim() === '') {
        if (role === 'admin' || (!rbacActive && role === null)) return
        throw new AuthorizationError(
            'Access denied: this entry has no recorded author. Only a team admin can modify it.'
        )
    }
    enforceOwnership(currentUser, entryAuthor, role, teamDb, workspaceId, rbacActive, canonicalizeFn)
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
                if (isGlobal) {
                    enforceTeamRbac(context, author, requiredRole, '*')
                } else {
                    for (const ws of collectAllTargetWorkspaces(params, context.config)) {
                        enforceTeamRbac(context, author, requiredRole, ws)
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

