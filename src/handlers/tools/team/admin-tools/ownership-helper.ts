/**
 * Pure leaf helper for single-entry team ownership checks.
 * [INTENT] Decouples CLI `entry update --team` and CRUD ownership checks from
 * `team/helpers.ts` / `team/schemas/*` so dynamic imports do not pull 109 KB schema chunks.
 */

import type { ToolContext } from '../../../../types/index.js'
import { AuthorizationError } from '../../../../types/errors.js'
import { resolveAuthenticatedAuthor, sanitizeAuthor } from '../../../../utils/security-utils.js'
import { enforceEntryOwnership, resolveScopedTeamRole } from '../rbac.js'

export type TeamDbInstance = NonNullable<ToolContext['teamDb']>

function fetchSingleTeamAuthor(teamDb: TeamDbInstance, entryId: number): string | null {
    const rawMap = teamDb.getAuthorsForEntries([entryId])
    const author = rawMap.get(entryId) ?? null
    return author !== null ? sanitizeAuthor(author) : null
}

function formatOwnershipDeniedResponse(
    err: unknown,
    author: string | null,
    action: string,
    targetLabel: string,
    suggestionVerb: string
): Record<string, unknown> {
    return {
        success: false,
        error:
            err instanceof Error
                ? err.message
                : `Permission Denied: Only the original author ("${author ?? 'none recorded'}") or a team admin can ${action} ${targetLabel}.`,
        code: 'PERMISSION_DENIED',
        category: 'auth',
        suggestion: `You can only ${suggestionVerb} entries that you authored.`,
        recoverable: false,
    }
}

/**
 * Enforce single-entry team ownership and return the fetched author alongside any PERMISSION_DENIED response.
 */
export function checkSingleTeamOwnershipWithAuthor(
    teamDb: TeamDbInstance,
    context: ToolContext,
    entryId: number,
    action: 'modify' | 'delete' | 'restore',
    workspaceId?: string
): { denied: Record<string, unknown> | null; author: string | null } {
    const author = fetchSingleTeamAuthor(teamDb, entryId)
    const currentUser = resolveAuthenticatedAuthor()
    const rbacActive = teamDb.isTeamRbacActive?.() ?? false
    const defaultRole = context.config?.teamDefaultRole ?? 'denied'
    const callerRole = rbacActive
        ? resolveScopedTeamRole(teamDb, currentUser, defaultRole, workspaceId)
        : null
    try {
        enforceEntryOwnership(currentUser, author, callerRole, teamDb, workspaceId, rbacActive)
        return { denied: null, author }
    } catch (err) {
        if (!(err instanceof AuthorizationError)) throw err
        const actionVerb = action === 'modify' ? 'update' : action
        return {
            denied: formatOwnershipDeniedResponse(
                err,
                author,
                action,
                'this team entry',
                actionVerb
            ),
            author,
        }
    }
}

/**
 * Enforce single-entry team ownership. Returns a PERMISSION_DENIED response or null when allowed.
 */
export function checkSingleTeamOwnership(
    teamDb: TeamDbInstance,
    context: ToolContext,
    entryId: number,
    action: 'modify' | 'delete' | 'restore',
    workspaceId?: string
): Record<string, unknown> | null {
    return checkSingleTeamOwnershipWithAuthor(teamDb, context, entryId, action, workspaceId).denied
}
