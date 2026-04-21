import { getAuthContext } from './auth-context.js'
import { hasScope, SCOPES } from './scopes.js'
import { getRequiredScope } from './scope-map.js'
import { PermissionError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import type { AuditLogger } from '../audit/index.js'

/**
 * Enforces unified access boundaries for tools and resources.
 *
 * 1. Team Boundary Check (Fail-closed):
 *    Requires either a TEAM_AUTHOR environment variable or an active, valid OAuth session.
 * 2. Scope Validation:
 *    Ensures the active session possesses the required scope for the target operation.
 */
export function enforceAccessBoundary(
    targetName: string,
    targetType: 'resource' | 'tool' | 'prompt',
    capabilities?: { requiresTeamScope?: boolean; requiresAdminScope?: boolean },
    auditLogger?: AuditLogger | null
): void {
    const auth = getAuthContext()

    const isTeam =
        capabilities?.requiresTeamScope ??
        (targetType === 'resource'
            ? targetName.startsWith('memory://team/') || targetName.startsWith('memory://flags')
            : targetName.startsWith('team_'))

    const isAdmin =
        capabilities?.requiresAdminScope ??
        (targetType === 'resource' ? targetName === 'memory://audit' : false)

    // Strict fail-closed boundary for team domains
    if (isTeam) {
        const envAuthor = process.env['TEAM_AUTHOR']?.trim()
        const hasAuthClaim = auth?.authenticated === true && auth?.claims !== undefined
        const bypassCodeMode = process.env['CODEMODE_INTERNAL_FULL_ACCESS'] === 'true'
        if (!envAuthor && !hasAuthClaim && !bypassCodeMode) {
            logger.warning(`Access to team ${targetType} denied: unauthenticated`, {
                module: 'AUTH',
                operation: 'fail-closed',
                entityId: targetName,
            })
            throw new PermissionError(
                `Access to team ${targetType} '${targetName}' denied: missing TEAM_AUTHOR or active OAuth session.`
            )
        }
    }

    if (auth) {
        let requiredScope: string
        if (targetType === 'tool') {
            requiredScope = getRequiredScope(targetName)
        } else {
            requiredScope = SCOPES.READ
            if (isTeam) {
                requiredScope = SCOPES.TEAM
            } else if (isAdmin) {
                requiredScope = SCOPES.ADMIN
            }
        }

        if (!hasScope(auth.claims?.scopes ?? [], requiredScope)) {
            logger.warning(`Insufficient scope for ${targetType}: ${targetName}`, {
                module: 'AUTH',
                operation: 'scope-check',
                entityId: targetName,
            })

            if (auditLogger) {
                const category =
                    requiredScope === SCOPES.TEAM
                        ? 'team'
                        : requiredScope === SCOPES.ADMIN || requiredScope === SCOPES.FULL
                          ? 'admin'
                          : 'read'
                auditLogger.logDenial(targetName, 'Insufficient scope', {
                    user: auth.claims?.sub,
                    scopes: auth.claims?.scopes ?? [],
                    category,
                    scope: requiredScope,
                })
            }
            throw new PermissionError(
                `Access to ${targetType} '${targetName}' denied: insufficient scope.`
            )
        }
    }
}
