import { getAuthContext } from './auth-context.js'
import { hasScope, SCOPES } from './scopes.js'
import { getRequiredScope } from './scope-map.js'
import { getToolGroup } from '../filtering/tool-filter.js'
import { PermissionError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import type { AuditLogger } from '../audit/index.js'
import { resolveAuthor } from '../utils/security-utils.js'

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
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
        requiresAuditScope?: boolean
    },
    auditLogger?: AuditLogger | null
): void {
    const auth = getAuthContext()

    const normalizedTarget = targetType === 'resource' ? targetName.replace(/#.*$/, '') : targetName

    const isTeam =
        capabilities?.requiresTeamScope ??
        (targetType === 'resource'
            ? normalizedTarget === 'memory://team' ||
              normalizedTarget.startsWith('memory://team/') ||
              normalizedTarget.startsWith('memory://team?') ||
              normalizedTarget === 'memory://insights/team-collaboration' ||
              normalizedTarget.startsWith('memory://insights/team-collaboration?')
            : getToolGroup(targetName) === 'team' ||
              targetName === 'cross_team_search' ||
              targetName.startsWith('team_') ||
              targetName.startsWith('team-') ||
              targetName.endsWith('-team-entry') ||
              targetName.endsWith('_team_entry') ||
              targetName === 'mj_team_session_summary')

    const isAudit =
        capabilities?.requiresAuditScope ??
        (targetType === 'resource'
            ? normalizedTarget === 'memory://audit' ||
              normalizedTarget.startsWith('memory://audit/') ||
              normalizedTarget.startsWith('memory://audit?')
            : false)

    const isAdmin = capabilities?.requiresAdminScope ?? false

    // Strict fail-closed boundary for team domains
    if (isTeam) {
        const author = resolveAuthor()
        const hasAuthClaim = auth?.authenticated === true && auth?.claims !== undefined
        if (author === 'unknown' && !hasAuthClaim) {
            logger.warning(`Access to team ${targetType} denied: unauthenticated`, {
                module: 'AUTH',
                operation: 'fail-closed',
                entityId: targetName,
            })
            auditLogger?.logDenial(targetName, 'Unauthenticated team access', {
                user: auth?.claims?.sub ?? null,
                scopes: auth?.claims?.scopes ?? [],
                category: 'team',
                scope: SCOPES.TEAM,
            })
            throw new PermissionError(
                `Access to team ${targetType} '${targetName}' denied: missing TEAM_AUTHOR or active OAuth session.`
            )
        }
    }

    if (auth) {
        let requiredScope: string
        if (targetType === 'tool') {
            if (capabilities?.requiresAdminScope === true) {
                requiredScope = SCOPES.ADMIN
            } else if (capabilities?.requiresTeamScope === true) {
                requiredScope = SCOPES.TEAM
            } else if (capabilities?.requiresAuditScope === true) {
                requiredScope = SCOPES.AUDIT
            } else {
                requiredScope = getRequiredScope(targetName)
            }
        } else {
            requiredScope = SCOPES.READ
            if (isAdmin) {
                requiredScope = SCOPES.ADMIN
            } else if (isAudit) {
                requiredScope = SCOPES.AUDIT
            } else if (isTeam) {
                requiredScope = SCOPES.TEAM
            }
        }

        if (!hasScope(auth.claims?.scopes ?? [], requiredScope)) {
            logger.warning(`Insufficient scope for ${targetType}: ${targetName}`, {
                module: 'AUTH',
                operation: 'scope-check',
                entityId: targetName,
            })

            if (auditLogger) {
                // [INTENT] Denial category mirrors the scope that was required (M6).
                const category =
                    requiredScope === SCOPES.TEAM
                        ? 'team'
                        : requiredScope === SCOPES.AUDIT
                          ? 'audit'
                          : requiredScope === SCOPES.WRITE
                            ? 'write'
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
                `🛠️ AUTONOMOUS HEALING: Access to ${targetType} '${targetName}' denied: insufficient scope. You are attempting to use a tool that requires higher privileges (e.g. GitHub or Admin scope). Please use an alternative tool, run it natively via terminal if it's a CLI command, or ask the user to provide the necessary authorization.`
            )
        }
    }
}
