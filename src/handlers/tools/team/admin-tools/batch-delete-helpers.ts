/**
 * Team Admin Batch Delete Helpers
 *
 * Validation, ownership filtering, and vector cleanup used by team_batch_delete_entries.
 */

import type { ToolContext } from '../../../../types/index.js'
import type { TeamRole } from '../../../../database/core/interfaces.js'
import { fetchAuthor, batchFetchAuthors } from '../helpers.js'
import { enforceOwnership } from '../rbac.js'
import { createBatchProgressReporter, sendProgress } from '../../../../utils/progress-utils.js'

export type TeamDbInstance = NonNullable<ToolContext['teamDb']>

export function missingProjectNumberResponse(): Record<string, unknown> {
    return {
        success: false,
        error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
        recoverable: true,
    }
}

export function permanentDeleteDeniedResponse(currentUser: string, callerRole: string): Record<string, unknown> {
    return {
        success: false,
        error: `Permission Denied: Permanent deletion of team entries requires the 'admin' role (caller "${currentUser}" has role "${callerRole}").`,
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
    codemodeBypass: boolean
}

/**
 * Filters ids to those matching the project number/workspace and verifies ownership.
 * Returns an error response on the first permission failure.
 */
export function filterDeletableIds(
    teamDb: TeamDbInstance,
    opts: DeletableIdsOptions
): { validIds: number[]; notFound: number[] } | { errorResponse: Record<string, unknown> } {
    const { entryIds, wsId, projectNumber, currentUser, callerRole, codemodeBypass } = opts
    const validIds: number[] = []
    const notFound: number[] = []

    const existingMap =
        typeof teamDb.getEntriesByIds === 'function'
            ? teamDb.getEntriesByIds(entryIds, wsId)
            : null
    const authorMap =
        typeof teamDb.getAuthorsForEntries === 'function'
            ? batchFetchAuthors(teamDb, entryIds)
            : null

    for (const id of entryIds) {
        const rawExisting = existingMap
            ? existingMap.get(id) ?? null
            : teamDb.getEntryById(id, wsId)
        const existing =
            rawExisting &&
            (wsId === '*' ||
                rawExisting.workspaceId === undefined ||
                rawExisting.workspaceId === wsId)
                ? rawExisting
                : null
        if (existing?.projectNumber !== projectNumber) {
            notFound.push(id)
            continue
        }

        const author = authorMap
            ? (authorMap.get(id) ?? null)
            : fetchAuthor(teamDb, id)
        if (author && !codemodeBypass) {
            try {
                enforceOwnership(currentUser, author, callerRole)
            } catch {
                return {
                    errorResponse: {
                        success: false,
                        error: `Permission Denied: Only the original author ("${author}") or a team admin can delete team entry ${String(id)}.`,
                        code: 'PERMISSION_DENIED',
                        category: 'auth',
                        suggestion: 'You can only delete entries that you authored.',
                        recoverable: false,
                    },
                }
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
): Promise<void> {
    if (context.teamVectorManager) {
        const reporter = createBatchProgressReporter(context.progress, deleted.length, 10)
        for (let i = 0; i < deleted.length; i++) {
            const id = deleted[i]
            if (id !== undefined) teamDb.deleteVector(id)
            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
        }
    } else {
        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
    }
}
