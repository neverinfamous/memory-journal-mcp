/**
 * Team Admin Create Author Helper
 *
 * Pure OAuth/RBAC author resolution shared by team create handlers and CLI entry creation
 * without pulling GitHub/hydration dependencies into the CLI fast-path bundle.
 */

import type { ToolHandlerConfig } from '../../../../types/index.js'
import { getAuthContext } from '../../../../auth/auth-context.js'
import {
    resolveAuthor,
    resolveAuthenticatedAuthor,
    sanitizeAuthor,
} from '../../../../utils/security-utils.js'
import { canonicalizeTeamAuthor, getCallerIdentity, resolveScopedTeamRole } from '../rbac.js'
import type { TeamDbInstance } from './batch-delete-helpers.js'

function sanitizeAuthorClaim(raw: string): string {
    return sanitizeAuthor(raw).trim()
}

function unknownIdentityError(): Record<string, unknown> {
    return {
        success: false,
        error: 'Identity cannot be resolved securely. In non-OAuth environments, you must set the TEAM_AUTHOR environment variable to claim an identity.',
        code: 'PERMISSION_DENIED',
        category: 'auth',
        suggestion: 'Set the TEAM_AUTHOR environment variable or enable OAuth.',
        recoverable: false,
    }
}

function resolveBaseCreateAuthor(
    sanitized: string | undefined
): { baseAuthor: string } | { errorResponse: Record<string, unknown> } {
    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const authId = resolveAuthenticatedAuthor()
        if (authId === 'unknown') {
            return { errorResponse: unknownIdentityError() }
        }
        if (sanitized !== undefined && sanitized !== authId) {
            return {
                errorResponse: {
                    success: false,
                    error: `Author mismatch: supplied author "${sanitized}" does not match authenticated principal "${authId}". Omit the author field to use your identity automatically.`,
                    code: 'PERMISSION_DENIED',
                    category: 'auth',
                    suggestion: 'Omit the author field to use your authenticated identity automatically.',
                    recoverable: false,
                },
            }
        }
        return { baseAuthor: authId }
    }
    const resolvedAuthor = sanitized ?? resolveAuthor()
    if (resolvedAuthor === 'unknown') {
        return { errorResponse: unknownIdentityError() }
    }
    return { baseAuthor: resolvedAuthor }
}

function authorizeRbacCreateAuthor(
    teamDb: TeamDbInstance,
    config: ToolHandlerConfig | undefined,
    sanitized: string | undefined,
    baseAuthor: string,
    workspaceId: string | undefined
): { author: string } | { errorResponse: Record<string, unknown> } {
    const callerIdentity = getCallerIdentity()
    const callerRole = resolveScopedTeamRole(
        teamDb,
        callerIdentity,
        config?.teamDefaultRole ?? 'denied',
        workspaceId
    )
    if (callerRole === null || callerRole === 'viewer') {
        return {
            errorResponse: {
                success: false,
                error: `Permission Denied: caller "${callerIdentity}" (role "${callerRole ?? 'denied'}") cannot create team entries in workspace "${workspaceId ?? 'default'}".`,
                code: 'PERMISSION_DENIED',
                category: 'auth',
                suggestion: 'Request member or admin access for this workspace.',
                recoverable: false,
            },
        }
    }
    const canonicalCaller = canonicalizeTeamAuthor(teamDb, callerIdentity, workspaceId)
    if (
        sanitized !== undefined &&
        sanitized !== callerIdentity &&
        sanitized !== canonicalCaller &&
        callerRole !== 'admin'
    ) {
        return {
            errorResponse: {
                success: false,
                error: `Author mismatch: caller "${callerIdentity}" (role "${callerRole}") cannot author team entries as "${sanitized}".`,
                code: 'PERMISSION_DENIED',
                category: 'auth',
                suggestion: 'Omit the author field or authenticate as a team admin.',
                recoverable: false,
            },
        }
    }
    return { author: canonicalizeTeamAuthor(teamDb, baseAuthor, workspaceId) }
}

/**
 * Resolve and authorize the author claim for team entry creation.
 * Enforces OAuth identity binding and non-OAuth RBAC non-admin impersonation checks (H8).
 */
export function resolveTeamCreateAuthor(
    inputAuthor: string | undefined,
    teamDb: TeamDbInstance,
    config: ToolHandlerConfig | undefined,
    workspaceId?: string
): { author: string } | { errorResponse: Record<string, unknown> } {
    const sanitized = inputAuthor !== undefined ? sanitizeAuthorClaim(inputAuthor) : undefined
    if (sanitized !== undefined && (sanitized === '' || sanitized.toLowerCase() === 'unknown')) {
        return {
            errorResponse: {
                success: false,
                error: 'Invalid author: author cannot be empty or "unknown". Omit author to use your resolved identity.',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Provide a non-empty author name or omit the author field.',
                recoverable: true,
            },
        }
    }

    const baseRes = resolveBaseCreateAuthor(sanitized)
    if ('errorResponse' in baseRes) return baseRes

    const teamRbacActive =
        typeof teamDb.isTeamRbacActive === 'function' && teamDb.isTeamRbacActive()
    if (teamRbacActive) {
        return authorizeRbacCreateAuthor(
            teamDb,
            config,
            sanitized,
            baseRes.baseAuthor,
            workspaceId
        )
    }

    return { author: baseRes.baseAuthor }
}
