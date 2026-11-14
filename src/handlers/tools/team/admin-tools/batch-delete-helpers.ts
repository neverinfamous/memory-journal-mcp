/**
 * Team Admin Batch Helpers
 *
 * Validation, ownership filtering, and vector cleanup used by team_batch_update_entries
 * and team_batch_delete_entries.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../../types/index.js'
import type { TeamRole } from '../../../../database/core/interfaces.js'
import { fetchAuthor, batchFetchAuthors, resolveTeamProjectNumber } from '../helpers.js'
import { enforceEntryOwnership } from '../rbac.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import type { TeamBatchUpdateEntriesSchema } from '../schemas.js'
import { createBatchProgressReporter, sendProgress } from '../../../../utils/progress-utils.js'
import { logger } from '../../../../utils/logger.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'

export type TeamDbInstance = NonNullable<ToolContext['teamDb']>
type TeamBatchUpdateInput = z.infer<typeof TeamBatchUpdateEntriesSchema>['updates'][number]

function buildSingleTeamUpdateItem(
    u: TeamBatchUpdateInput,
    projectNumber: number,
    explicitWs: string | undefined,
    existingWorkspaceId: string | undefined,
    context: ToolContext
): Parameters<TeamDbInstance['updateEntries']>[0][number] {
    return {
        id: u.entry_id,
        content: u.content,
        entryType: u.entry_type,
        tags: u.tags,
        significanceType: u.significance_type,
        projectNumber,
        projectOwner: u.project_owner,
        issueNumber: u.issue_number,
        issueUrl: u.issue_url,
        prNumber: u.pr_number,
        prUrl: u.pr_url,
        prStatus: u.pr_status,
        workflowRunId: u.workflow_run_id,
        workflowName: u.workflow_name,
        workflowStatus: u.workflow_status,
        isArchived: u.is_archived,
        expectedVersion: u.expected_version,
        autoContext: u.auto_context,
        impactScore: u.impact_score,
        trustScore: u.trust_score,
        validationStatus: u.validation_status,
        sessionId: u.session_id,
        workspaceId: resolveWriteWorkspaceId(
            explicitWs === undefined || explicitWs === '*' ? existingWorkspaceId : explicitWs,
            projectNumber,
            context.config
        ),
    }
}

export function buildValidatedTeamBatchUpdates(
    teamDb: TeamDbInstance,
    rawUpdates: TeamBatchUpdateInput[],
    rootWorkspaceId: string | undefined,
    rootProjectNumber: number | undefined,
    context: ToolContext,
    currentUser: string,
    callerRole: TeamRole | null,
    codemodeBypass: boolean,
    preFetchedAuthors: Map<number, string | null> | null
):
    | { errorResponse: Record<string, unknown> }
    | { updates: Parameters<TeamDbInstance['updateEntries']>[0]; notFound: number[] } {
    const updates: Parameters<TeamDbInstance['updateEntries']>[0] = []
    const notFound: number[] = []

    for (const u of rawUpdates) {
        const explicitWs = u.workspace_id ?? rootWorkspaceId
        const explicitPn = u.project_number ?? rootProjectNumber
        // [INVARIANT] Never infer an existing entry's workspace from content/tags; explicit 'default' is preserved.
        let wsId =
            explicitWs === '*'
                ? '*'
                : resolveWriteWorkspaceId(explicitWs, explicitPn, context.config)
        const existing = teamDb.getEntryById(u.entry_id, wsId)
        if (existing?.workspaceId !== undefined && wsId === '*') {
            wsId = existing.workspaceId
        }
        if (
            existing !== null &&
            existing !== undefined &&
            explicitPn !== undefined &&
            existing.projectNumber !== explicitPn
        ) {
            notFound.push(u.entry_id)
            continue
        }
        const projectNumber = resolveTeamProjectNumber(
            context,
            wsId,
            u.project_number ?? rootProjectNumber ?? existing?.projectNumber,
            explicitWs
        )
        if (projectNumber === undefined || projectNumber === null) {
            return {
                errorResponse: {
                    success: false,
                    error: `Missing project_number for team entry ${String(u.entry_id)}. You MUST provide a valid project_number or configure DEFAULT_PROJECT_NUMBER on the server.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                    recoverable: true,
                },
            }
        }
        if (!existing) {
            notFound.push(u.entry_id)
            continue
        }
        const author = preFetchedAuthors
            ? (preFetchedAuthors.get(u.entry_id) ?? null)
            : fetchAuthor(teamDb, u.entry_id)
        if (!codemodeBypass) {
            try {
                enforceEntryOwnership(currentUser, author, callerRole)
            } catch {
                return {
                    errorResponse: {
                        success: false,
                        error: `Permission Denied: Only the original author ("${author ?? 'none recorded'}") or a team admin can modify team entry ${String(u.entry_id)}.`,
                        code: 'PERMISSION_DENIED',
                        category: 'auth',
                        suggestion: 'You can only update entries that you authored.',
                        recoverable: false,
                    },
                }
            }
        }

        updates.push(buildSingleTeamUpdateItem(u, projectNumber, explicitWs, existing.workspaceId, context))
    }

    return { updates, notFound }
}

/**
 * Enforce single-entry team ownership. Returns a PERMISSION_DENIED response or null when allowed.
 */
export function checkSingleTeamOwnership(
    teamDb: TeamDbInstance,
    context: ToolContext,
    entryId: number,
    action: 'modify' | 'delete'
): Record<string, unknown> | null {
    if (context.config?.codemodeInternalFullAccess === true) return null
    const author = fetchAuthor(teamDb, entryId)
    const currentUser = resolveAuthenticatedAuthor()
    const callerRole =
        teamDb.isTeamRbacActive()
            ? teamDb.resolveTeamRole(currentUser, context.config?.teamDefaultRole ?? 'denied')
            : null
    try {
        enforceEntryOwnership(currentUser, author, callerRole)
        return null
    } catch {
        return {
            success: false,
            error: `Permission Denied: Only the original author ("${author ?? 'none recorded'}") or a team admin can ${action} this team entry.`,
            code: 'PERMISSION_DENIED',
            category: 'auth',
            suggestion: `You can only ${action === 'modify' ? 'update' : 'delete'} entries that you authored.`,
            recoverable: false,
        }
    }
}

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
    const { entryIds, wsId, projectNumber, currentUser, callerRole, codemodeBypass, permanent } = opts
    const validIds: number[] = []
    const notFound: number[] = []

    const existingMap =
        !permanent && typeof teamDb.getEntriesByIds === 'function'
            ? teamDb.getEntriesByIds(entryIds, wsId)
            : null
    const authorMap =
        typeof teamDb.getAuthorsForEntries === 'function'
            ? batchFetchAuthors(teamDb, entryIds)
            : null

    for (const id of entryIds) {
        const rawExisting = existingMap
            ? existingMap.get(id) ?? null
            : permanent
              ? teamDb.getEntryByIdIncludeDeleted(id, wsId)
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
        if (!codemodeBypass) {
            try {
                enforceEntryOwnership(currentUser, author, callerRole)
            } catch {
                return {
                    errorResponse: {
                        success: false,
                        error: `Permission Denied: Only the original author ("${author ?? 'none recorded'}") or a team admin can delete team entry ${String(id)}.`,
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
            if (id !== undefined) {
                try {
                    teamDb.deleteVector(id)
                } catch (vecErr) {
                    logger.warning('Team batch delete vector cleanup failed', {
                        entryId: id,
                        error: vecErr instanceof Error ? vecErr.message : String(vecErr),
                    })
                }
            }
            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
        }
    } else {
        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
    }
}
