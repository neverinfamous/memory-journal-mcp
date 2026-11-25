/**
 * Team Admin Batch Helpers
 *
 * Validation, ownership filtering, and vector cleanup used by team_batch_update_entries
 * and team_batch_delete_entries.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../../types/index.js'
import { AuthorizationError } from '../../../../types/errors.js'
import { enforceAccessBoundary } from '../../../../auth/validation.js'
import type { TeamRole } from '../../../../database/core/interfaces.js'
import { fetchAuthor, batchFetchAuthors, resolveTeamProjectNumber, triggerTeamNotifications } from '../helpers.js'
import { enforceEntryOwnership, resolveScopedTeamRole } from '../rbac.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import type { TeamBatchDeleteEntriesSchema } from '../schemas.js'
import { createBatchProgressReporter, sendProgress } from '../../../../utils/progress-utils.js'
import { logger } from '../../../../utils/logger.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import {
    buildTeamPermissionDeniedError,
    createScopedAuthorCanonicalizer,
} from './batch-prefetch-helpers.js'

export type TeamDbInstance = NonNullable<ToolContext['teamDb']>
export { buildValidatedTeamBatchUpdates } from './batch-update-validation.js'
export {
    checkSingleTeamOwnership,
    checkSingleTeamOwnershipWithAuthor,
} from './ownership-helper.js'

export function missingProjectNumberResponse(
    error = 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.'
): Record<string, unknown> {
    return {
        success: false,
        error,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
        recoverable: true,
    }
}

export function permanentDeleteDeniedResponse(
    currentUser: string,
    callerRole: string | null
): Record<string, unknown> {
    return {
        success: false,
        error: `Permission Denied: Permanent deletion of team entries requires the 'admin' role (caller "${currentUser}" has role "${callerRole ?? 'denied'}").`,
        code: 'PERMISSION_DENIED',
        category: 'auth',
        suggestion: 'Omit permanent: true to soft-delete your entries, or ask a team admin to permanently delete them.',
        recoverable: false,
    }
}

export interface DeletableIdsOptions {
    entryIds: number[]
    wsId: string
    projectNumber: number
    currentUser: string
    callerRole: TeamRole | null
    permanent?: boolean
}

/**
 * Filters ids to those matching the project number/workspace and verifies ownership.
 * Returns an error response on the first permission failure.
 */
export function filterDeletableIds(
    teamDb: TeamDbInstance,
    opts: DeletableIdsOptions
): { validIds: number[]; notFound: number[] } | { errorResponse: Record<string, unknown> } {
    const { entryIds, wsId, projectNumber, currentUser, callerRole, permanent } = opts
    const validIds: number[] = []
    const notFound: number[] = []
    const rbacActive = teamDb.isTeamRbacActive?.() ?? false

    const existingMap =
        permanent && typeof teamDb.getEntriesByIdsIncludeDeleted === 'function'
            ? teamDb.getEntriesByIdsIncludeDeleted(entryIds, wsId)
            : !permanent && typeof teamDb.getEntriesByIds === 'function'
              ? teamDb.getEntriesByIds(entryIds, wsId)
              : null
    const authorMap =
        typeof teamDb.getAuthorsForEntries === 'function'
            ? batchFetchAuthors(teamDb, entryIds)
            : null
    const canonicalizeAuthor =
        callerRole === 'admin'
            ? undefined
            : createScopedAuthorCanonicalizer(teamDb, [
                  { author: currentUser, workspaceId: wsId },
                  ...(authorMap !== null
                      ? Array.from(authorMap.values(), (author) => ({ author, workspaceId: wsId }))
                      : []),
              ])

    for (const id of entryIds) {
        const rawExisting = existingMap
            ? existingMap.get(id) ?? null
            : permanent
              ? teamDb.getEntryByIdIncludeDeleted(id, wsId)
              : teamDb.getEntryById(id, wsId)
        const existing =
            rawExisting &&
            (wsId === '*' || rawExisting.workspaceId === undefined || rawExisting.workspaceId === wsId)
                ? rawExisting
                : null
        if (existing?.projectNumber !== projectNumber) {
            notFound.push(id)
            continue
        }

        const author = authorMap ? (authorMap.get(id) ?? null) : fetchAuthor(teamDb, id)
        try {
            enforceEntryOwnership(
                currentUser,
                author,
                callerRole,
                teamDb,
                wsId,
                rbacActive,
                canonicalizeAuthor
            )
        } catch (err) {
            if (!(err instanceof AuthorizationError)) throw err
            return {
                errorResponse: buildTeamPermissionDeniedError(err, author, 'delete', `team entry ${String(id)}`, 'delete'),
            }
        }
        validIds.push(id)
    }

    return { validIds, notFound }
}

export async function cleanupDeletedVectors(
    context: ToolContext,
    teamDb: TeamDbInstance,
    deleted: number[]
): Promise<string[]> {
    const warnings: string[] = []
    if (deleted.length === 0) {
        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
        return warnings
    }
    if (typeof context.teamVectorManager?.markRemoved === 'function') {
        context.teamVectorManager.markRemoved(deleted)
    }
    if (typeof teamDb.deleteVectors === 'function') {
        try {
            teamDb.deleteVectors(deleted)
        } catch (vecErr) {
            const msg = vecErr instanceof Error ? vecErr.message : String(vecErr)
            logger.warning('Team batch delete vector cleanup failed', { count: deleted.length, error: msg })
            warnings.push(`Vector cleanup failed for team entries (${deleted.join(', ')}): ${msg}`)
        }
        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
        return warnings
    }
    const reporter = context.teamVectorManager
        ? createBatchProgressReporter(context.progress, deleted.length, 10)
        : undefined
    await deleted.reduce<Promise<void>>(async (chain, id, i) => {
        await chain
        try {
            teamDb.deleteVector(id)
        } catch (vecErr) {
            const msg = vecErr instanceof Error ? vecErr.message : String(vecErr)
            logger.warning('Team batch delete vector cleanup failed', { entryId: id, error: msg })
            warnings.push(`Vector cleanup failed for team entry ${String(id)}: ${msg}`)
        }
        if (reporter !== undefined) {
            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
        }
    }, Promise.resolve())
    if (reporter === undefined) {
        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
    }
    return warnings
}

type TeamBatchDeleteInput = z.infer<typeof TeamBatchDeleteEntriesSchema>

function authorizeTeamBatchDelete(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchDeleteInput,
    currentUser: string
):
    | { wsId: string; projectNumber: number; callerRole: TeamRole | null }
    | { errorResponse: Record<string, unknown> } {
    let wsId = resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
    const projectNumber = resolveTeamProjectNumber(context, wsId, input.project_number, input.workspace_id)
    if (projectNumber === undefined || projectNumber === null) {
        return { errorResponse: missingProjectNumberResponse() }
    }
    wsId = resolveWriteWorkspaceId(input.workspace_id ?? wsId, projectNumber, context.config)

    const rbacActive = teamDb.isTeamRbacActive?.() ?? false
    const defaultRole = context.config?.teamDefaultRole ?? 'denied'
    const callerRole = rbacActive ? resolveScopedTeamRole(teamDb, currentUser, defaultRole, wsId) : null

    if (input.permanent && rbacActive && callerRole !== 'admin') {
        return { errorResponse: permanentDeleteDeniedResponse(currentUser, callerRole) }
    }
    if (input.permanent) {
        enforceAccessBoundary(
            'team_batch_delete_entries',
            'tool',
            { requiresAdminScope: true },
            context.config?.runtime?.auditLogger
        )
    }
    return { wsId, projectNumber, callerRole }
}

/** Validate ownership/scope and execute `team_batch_delete_entries` with shallow control flow. */
export async function executeTeamBatchDelete(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchDeleteInput
): Promise<Record<string, unknown>> {
    await sendProgress(context.progress, 0, 2, 'Deleting team entries...')
    const currentUser = resolveAuthenticatedAuthor()
    const authScope = authorizeTeamBatchDelete(context, teamDb, input, currentUser)
    if ('errorResponse' in authScope) return authScope.errorResponse
    const { wsId, projectNumber, callerRole } = authScope

    const filtered = filterDeletableIds(teamDb, {
        entryIds: input.entry_ids,
        wsId,
        projectNumber,
        currentUser,
        callerRole,
        ...(input.permanent !== undefined ? { permanent: input.permanent } : {}),
    })
    if ('errorResponse' in filtered) return filtered.errorResponse

    const { deleted, notFound: deleteNotFound, errors, warning: deleteWarning } = teamDb.deleteEntries(
        filtered.validIds,
        input.permanent,
        wsId
    )
    await sendProgress(context.progress, 1, 2, `Deleted ${String(deleted.length)} team entries...`)
    if (deleted.length > 0 && typeof context.teamVectorManager?.markRemoved === 'function') {
        context.teamVectorManager.markRemoved(deleted)
    }
    const vectorWarnings =
        typeof teamDb.deleteVectors === 'function'
            ? (await sendProgress(context.progress, 2, 2, 'Team batch delete complete'),
              deleteWarning !== undefined ? [deleteWarning] : [])
            : await cleanupDeletedVectors(context, teamDb, deleted)

    if (deleted.length > 0) {
        triggerTeamNotifications(context)
    }

    const finalNotFound = [...filtered.notFound, ...deleteNotFound]
    if (errors.length > 0 || finalNotFound.length > 0) {
        const mcpErrors = [
            ...finalNotFound.map((id) => new Error(`Team entry ${String(id)} not found`)),
            ...errors.map((e) => new Error(`Team entry ${String(e.id)} failed to delete: ${e.error.message}`)),
        ]
        throw new AggregateError(
            mcpErrors,
            `Team batch delete partially failed: ${String(deleted.length)} deleted (ids: ${deleted.join(', ')}), ${String(mcpErrors.length)} operations failed`
        )
    }

    return {
        success: true,
        count: deleted.length,
        deleted,
        notFound: finalNotFound,
        permanent: input.permanent,
        ...(vectorWarnings.length > 0 ? { warning: vectorWarnings.join('; ') } : {}),
    }
}
