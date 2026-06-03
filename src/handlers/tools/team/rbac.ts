import type { ToolContext, ToolDefinition } from '../../../types/index.js'
import { AuthorizationError } from '../../../types/errors.js'
import type { TeamRole } from '../../../database/core/interfaces.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveAuthor } from '../../../utils/security-utils.js'

import { formatHandlerError } from '../../../utils/error-helpers.js'

/**
 * Resolves the identity of the user calling the tool.
 * Prefers OAuth claims, falls back to an explicit 'author' parameter, 
 * and ultimately to the TEAM_AUTHOR environment variable.
 */
export function getCallerIdentity(params?: Record<string, unknown>): string {
    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const claims = authCtx.claims
        const email = typeof claims?.['email'] === 'string' ? claims['email'] : undefined
        const prefName = typeof claims?.['preferred_username'] === 'string' ? claims['preferred_username'] : undefined
        const subject = typeof claims?.['subject'] === 'string' ? claims['subject'] : undefined
        return claims?.sub ?? email ?? prefName ?? subject ?? resolveAuthor()
    }
    // For non-OAuth environments, fallback to explicit author param or environment variable
    if (params !== undefined && typeof params['author'] === 'string') {
        return params['author']
    }
    return resolveAuthor()
}

/**
 * Enforces role-based access control for team tools.
 * 
 * @throws {AuthorizationError} if the user does not have the required role or is denied.
 */
export function enforceTeamRbac(context: ToolContext, author: string, requiredRole: TeamRole = 'viewer'): void {
    const { teamDb, config } = context
    if (!teamDb) return // Let the original handler return TEAM_DB_ERROR_RESPONSE

    // If RBAC table is empty, default to legacy full access
    if (teamDb.isTeamRbacActive !== undefined && !teamDb.isTeamRbacActive()) {
        return
    }

    const defaultRole = config?.teamDefaultRole ?? 'denied'
    const role = teamDb.resolveTeamRole !== undefined ? teamDb.resolveTeamRole(author, defaultRole) : defaultRole

    if (role === 'denied' || !role) {
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
export function enforceOwnership(author: string, resourceAuthor: string, role: TeamRole | null): void {
    if (role === 'admin') return // Admins can bypass ownership checks
    if (author.toLowerCase() !== resourceAuthor.toLowerCase()) {
        throw new AuthorizationError(`Access denied: cannot modify resource owned by '${resourceAuthor}'. Only the original author or an admin can modify this entry.`)
    }
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
                const author = getCallerIdentity(params as Record<string, unknown> | undefined)
                
                // Enforce role requirement
                enforceTeamRbac(context, author, requiredRole)
                
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
