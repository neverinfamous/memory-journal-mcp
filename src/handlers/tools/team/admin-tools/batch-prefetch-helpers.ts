/**
 * Team Admin Batch Prefetch & Memoization Helpers
 *
 * Shared prefetching and per-workspace RBAC / author resolution caches used by
 * `team_batch_create_entries` and `team_batch_update_entries` / `team_batch_delete_entries`.
 */

import type { JournalEntry, ToolContext } from '../../../../types/index.js'
import type { TeamRole } from '../../../../database/core/interfaces.js'
import { resolveScopedTeamRole } from '../rbac.js'
import type { TeamDbInstance } from './batch-delete-helpers.js'

/** Prefetch entries in one batched query when the adapter supports it, otherwise return null for mocks. */
export function prefetchTeamEntriesMap(
    teamDb: TeamDbInstance,
    ids: readonly number[],
    wsId: string,
    includeDeleted = false
): Map<number, JournalEntry> | null {
    if (ids.length === 0) return new Map<number, JournalEntry>()
    if (includeDeleted && typeof teamDb.getEntriesByIdsIncludeDeleted === 'function') {
        return teamDb.getEntriesByIdsIncludeDeleted([...ids], wsId)
    }
    if (!includeDeleted && typeof teamDb.getEntriesByIds === 'function') {
        return teamDb.getEntriesByIds([...ids], wsId)
    }
    return null
}

/** Enforce concrete workspace isolation against a row prefetched under wildcard scope (`'*'`). */
export function validateTeamEntryWorkspaceScope(
    rawExisting: JournalEntry | null | undefined,
    wsId: string
): JournalEntry | null {
    if (rawExisting === null || rawExisting === undefined) return null
    return wsId === '*' || rawExisting.workspaceId === undefined || rawExisting.workspaceId === wsId
        ? rawExisting
        : null
}

/** Memoize per-workspace RBAC role lookups within a single batch operation. */
export function createScopedTeamRoleLookup(
    teamDb: TeamDbInstance,
    currentUser: string,
    defaultRole: 'admin' | 'member' | 'viewer' | 'denied',
    rbacActive: boolean
): (workspaceId: string | undefined) => TeamRole | null {
    const cache = new Map<string, TeamRole | null>()
    return (workspaceId: string | undefined): TeamRole | null => {
        if (!rbacActive) return null
        const key = workspaceId ?? '__default__'
        if (cache.has(key)) return cache.get(key) ?? null
        const role = resolveScopedTeamRole(teamDb, currentUser, defaultRole, workspaceId)
        cache.set(key, role)
        return role
    }
}

/** Build a standardized `PERMISSION_DENIED` payload for team ownership checks. */
export function buildTeamPermissionDeniedError(
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

/** Execute `fn` inside a team database transaction when the adapter supports it. */
export function runTeamBatchTx<T>(teamDb: Pick<TeamDbInstance, 'executeInTransaction'> | ToolContext['teamDb'], fn: () => T): T {
    if (teamDb !== undefined && typeof teamDb.executeInTransaction === 'function') {
        return teamDb.executeInTransaction(fn)
    }
    return fn()
}
