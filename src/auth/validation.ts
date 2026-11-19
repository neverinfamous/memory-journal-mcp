import { getAuthContext } from './auth-context.js'
import { hasScope, SCOPES } from './scopes.js'
import { canonicalizeMemoryResourceUri, getRequiredScope } from './scope-map.js'
import { getToolGroup } from '../filtering/tool-filter.js'
import { PermissionError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import type { AuditLogger } from '../audit/index.js'
import type { AuditCategory } from '../audit/types.js'
import { resolveAuthor } from '../utils/security-utils.js'

interface AccessCapabilities {
    requiresTeamScope?: boolean
    requiresAdminScope?: boolean
    requiresAuditScope?: boolean
}

export function getGrantedAuthScopes(
    auth: ReturnType<typeof getAuthContext>
): string[] {
    if (!auth?.authenticated) return []
    if (Array.isArray(auth.claims?.scopes)) return auth.claims.scopes
    if (Array.isArray(auth.scopes)) return auth.scopes
    return []
}

function isTeamResourceUri(normalizedTarget: string): boolean {
    return (
        normalizedTarget === 'memory://team' ||
        normalizedTarget.startsWith('memory://team/') ||
        normalizedTarget.startsWith('memory://team?') ||
        normalizedTarget === 'memory://insights/team-collaboration' ||
        normalizedTarget.startsWith('memory://insights/team-collaboration/') ||
        normalizedTarget.startsWith('memory://insights/team-collaboration?')
    )
}

function isTeamToolOrPromptName(targetName: string): boolean {
    return (
        getToolGroup(targetName) === 'team' ||
        targetName === 'cross_team_search' ||
        targetName.startsWith('team_') ||
        targetName.startsWith('team-') ||
        targetName.endsWith('-team-entry') ||
        targetName.endsWith('_team_entry') ||
        targetName === 'mj_team_session_summary'
    )
}

function isAuditResourceUri(normalizedTarget: string): boolean {
    return (
        normalizedTarget === 'memory://audit' ||
        normalizedTarget.startsWith('memory://audit/') ||
        normalizedTarget.startsWith('memory://audit?') ||
        normalizedTarget === 'memory://metrics/users' ||
        normalizedTarget.startsWith('memory://metrics/users/') ||
        normalizedTarget.startsWith('memory://metrics/users?')
    )
}

function classifyAccessTarget(
    targetName: string,
    targetType: 'resource' | 'tool' | 'prompt',
    capabilities?: AccessCapabilities
): { isTeam: boolean; isAudit: boolean; isAdmin: boolean } {
    const normalizedTarget =
        targetType === 'resource' ? canonicalizeMemoryResourceUri(targetName) : targetName.trim()
    const isTeam =
        capabilities?.requiresTeamScope ??
        (targetType === 'resource'
            ? isTeamResourceUri(normalizedTarget)
            : isTeamToolOrPromptName(normalizedTarget))
    const isAudit =
        capabilities?.requiresAuditScope ??
        (targetType === 'resource' ? isAuditResourceUri(normalizedTarget) : false)
    const isAdmin = capabilities?.requiresAdminScope ?? false
    return { isTeam, isAudit, isAdmin }
}

function assertTeamAccessBoundary(
    targetName: string,
    targetType: 'resource' | 'tool' | 'prompt',
    auth: ReturnType<typeof getAuthContext>,
    auditLogger?: AuditLogger | null
): void {
    const author = resolveAuthor()
    const hasAuthClaim = auth?.authenticated === true && auth?.claims !== undefined
    if (author !== 'unknown' || hasAuthClaim) return

    const grantedScopes = getGrantedAuthScopes(auth)
    logger.warning(`Access to team ${targetType} denied: unauthenticated`, {
        module: 'AUTH',
        operation: 'fail-closed',
        entityId: targetName,
    })
    auditLogger?.logDenial(targetName, 'Unauthenticated team access', {
        user: auth?.claims?.sub ?? null,
        scopes: grantedScopes,
        category: 'team',
        scope: SCOPES.TEAM,
    })
    throw new PermissionError(
        `Access to team ${targetType} '${targetName}' denied: missing TEAM_AUTHOR or active OAuth session.`
    )
}

function resolveTargetRequiredScope(
    targetName: string,
    targetType: 'resource' | 'tool' | 'prompt',
    classification: { isTeam: boolean; isAudit: boolean; isAdmin: boolean },
    capabilities?: AccessCapabilities
): string {
    if (targetType === 'tool') {
        if (capabilities?.requiresAdminScope === true) return SCOPES.ADMIN
        if (capabilities?.requiresTeamScope === true) return SCOPES.TEAM
        if (capabilities?.requiresAuditScope === true) return SCOPES.AUDIT
        return getRequiredScope(targetName)
    }
    if (classification.isAdmin) return SCOPES.ADMIN
    if (classification.isAudit) return SCOPES.AUDIT
    if (classification.isTeam) return SCOPES.TEAM
    return SCOPES.READ
}

function scopeToDenialCategory(requiredScope: string): AuditCategory {
    if (requiredScope === SCOPES.TEAM) return 'team'
    if (requiredScope === SCOPES.AUDIT) return 'audit'
    if (requiredScope === SCOPES.WRITE) return 'write'
    if (requiredScope === SCOPES.ADMIN || requiredScope === SCOPES.FULL) return 'admin'
    return 'read'
}

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
    capabilities?: AccessCapabilities,
    auditLogger?: AuditLogger | null
): void {
    const auth = getAuthContext()
    const classification = classifyAccessTarget(targetName, targetType, capabilities)

    // Strict fail-closed boundary for team domains
    if (classification.isTeam) {
        assertTeamAccessBoundary(targetName, targetType, auth, auditLogger)
    }

    if (!auth) return

    const requiredScope = resolveTargetRequiredScope(
        targetName,
        targetType,
        classification,
        capabilities
    )
    const grantedScopes = getGrantedAuthScopes(auth)
    if (hasScope(grantedScopes, requiredScope)) return

    logger.warning(`Insufficient scope for ${targetType}: ${targetName}`, {
        module: 'AUTH',
        operation: 'scope-check',
        entityId: targetName,
    })

    if (auditLogger) {
        // [INTENT] Denial category mirrors the scope that was required (M6).
        auditLogger.logDenial(targetName, 'Insufficient scope', {
            ...(auth.claims?.sub !== undefined ? { user: auth.claims.sub } : {}),
            scopes: grantedScopes,
            category: scopeToDenialCategory(requiredScope),
            scope: requiredScope,
        })
    }
    throw new PermissionError(
        `🛠️ AUTONOMOUS HEALING: Access to ${targetType} '${targetName}' denied: insufficient scope. You are attempting to use a tool that requires higher privileges (e.g. GitHub or Admin scope). Please use an alternative tool, run it natively via terminal if it's a CLI command, or ask the user to provide the necessary authorization.`
    )
}
