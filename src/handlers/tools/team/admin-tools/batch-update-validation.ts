/**
 * Team Batch Update Validation Helpers
 *
 * Extracted from `batch-delete-helpers.ts` (Appendix A & B) to keep file
 * and function line counts within project modularization budgets.
 */

import type { z } from 'zod'
import type { JournalEntry, ToolContext } from '../../../../types/index.js'
import { AuthorizationError, ValidationError } from '../../../../types/errors.js'
import type { TeamRole } from '../../../../database/core/interfaces.js'
import { fetchAuthor } from '../helpers.js'
import {
    canRealignOrphanedRegisteredProject,
    resolveTeamMutationProjectNumber,
} from './team-pk-scope-helpers.js'
import { enforceEntryOwnership } from '../rbac.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import {
    hasNonProjectTeamUpdateFields,
    type TeamBatchUpdateEntriesSchema,
} from '../schemas.js'
import {
    buildTeamPermissionDeniedError,
    createScopedTeamRoleLookup,
    prefetchTeamEntriesMap,
    validateTeamEntryWorkspaceScope,
} from './batch-prefetch-helpers.js'
import { missingProjectNumberResponse, type TeamDbInstance } from './batch-delete-helpers.js'

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

interface BatchUpdateSharedCtx {
    teamDb: TeamDbInstance
    rootWorkspaceId: string | undefined
    rootProjectNumber: number | undefined
    context: ToolContext
    currentUser: string
    preFetchedAuthors: Map<number, string | null> | null
    prefetchedEntries: Map<number, JournalEntry> | null
    resolveRole: (workspaceId: string | undefined) => TeamRole | null
    rbacActive: boolean
}

function isBatchUpdateProjectMismatched(
    context: ToolContext,
    wsId: string,
    targetPn: number | undefined,
    existing: JournalEntry | null | undefined
): boolean {
    if (!existing || targetPn === undefined) return false
    if (existing.projectNumber === null || existing.projectNumber === undefined) return false
    return (
        existing.projectNumber !== targetPn &&
        !canRealignOrphanedRegisteredProject(context, wsId, targetPn, existing)
    )
}

function validateSingleTeamBatchUpdate(
    u: TeamBatchUpdateInput,
    shared: BatchUpdateSharedCtx
):
    | { status: 'ok'; item: Parameters<TeamDbInstance['updateEntries']>[0][number] }
    | { status: 'not_found'; entryId: number }
    | { status: 'error'; errorResponse: Record<string, unknown> } {
    const { teamDb, rootWorkspaceId, rootProjectNumber, context, currentUser, preFetchedAuthors, prefetchedEntries, resolveRole, rbacActive } = shared
    const explicitWs = u.workspace_id ?? rootWorkspaceId
    const explicitPn = u.project_number ?? rootProjectNumber
    // [INVARIANT] Never infer an existing entry's workspace from content/tags; explicit 'default' is preserved and '*' rejected.
    const wsId = resolveWriteWorkspaceId(explicitWs, explicitPn, context.config)
    const rawExisting =
        prefetchedEntries !== null
            ? (prefetchedEntries.get(u.entry_id) ?? null)
            : teamDb.getEntryById(u.entry_id, wsId)
    const existing =
        prefetchedEntries !== null ? validateTeamEntryWorkspaceScope(rawExisting, wsId) : rawExisting
    if (isBatchUpdateProjectMismatched(context, wsId, explicitPn, existing)) {
        return { status: 'not_found', entryId: u.entry_id }
    }
    const projectNumber = resolveTeamMutationProjectNumber(context, wsId, explicitPn, explicitWs, existing?.projectNumber)
    if (projectNumber === undefined || projectNumber === null) {
        return {
            status: 'error',
            errorResponse: missingProjectNumberResponse(
                `Missing project_number for team entry ${String(u.entry_id)}. You MUST provide a valid project_number or configure DEFAULT_PROJECT_NUMBER on the server.`
            ),
        }
    }
    if (!existing || isBatchUpdateProjectMismatched(context, wsId, projectNumber, existing)) {
        return { status: 'not_found', entryId: u.entry_id }
    }
    if (!hasNonProjectTeamUpdateFields(u) && existing.projectNumber === projectNumber) {
        throw new ValidationError(
            'At least one updatable field must be specified in team_update_entry (empty metadata-only updates are rejected).'
        )
    }

    const effectiveWs = existing.workspaceId ?? wsId
    const author = preFetchedAuthors ? (preFetchedAuthors.get(u.entry_id) ?? null) : fetchAuthor(teamDb, u.entry_id)
    try {
        enforceEntryOwnership(currentUser, author, resolveRole(effectiveWs), teamDb, effectiveWs, rbacActive)
    } catch (err) {
        if (!(err instanceof AuthorizationError)) throw err
        return {
            status: 'error',
            errorResponse: buildTeamPermissionDeniedError(err, author, 'modify', `team entry ${String(u.entry_id)}`, 'update'),
        }
    }
    return {
        status: 'ok',
        item: buildSingleTeamUpdateItem(u, projectNumber, explicitWs, existing.workspaceId, context),
    }
}

export function buildValidatedTeamBatchUpdates(
    teamDb: TeamDbInstance,
    rawUpdates: TeamBatchUpdateInput[],
    rootWorkspaceId: string | undefined,
    rootProjectNumber: number | undefined,
    context: ToolContext,
    currentUser: string,
    preFetchedAuthors: Map<number, string | null> | null
):
    | { errorResponse: Record<string, unknown> }
    | { updates: Parameters<TeamDbInstance['updateEntries']>[0]; notFound: number[] } {
    const updates: Parameters<TeamDbInstance['updateEntries']>[0] = []
    const notFound: number[] = []
    if (rootWorkspaceId !== undefined) {
        resolveWriteWorkspaceId(rootWorkspaceId, rootProjectNumber, context.config)
    }
    const rbacActive = typeof teamDb.isTeamRbacActive === 'function' && teamDb.isTeamRbacActive()
    const defaultRole = context.config?.teamDefaultRole ?? 'denied'
    const shared: BatchUpdateSharedCtx = {
        teamDb,
        rootWorkspaceId,
        rootProjectNumber,
        context,
        currentUser,
        preFetchedAuthors,
        prefetchedEntries: prefetchTeamEntriesMap(
            teamDb,
            rawUpdates.map((u) => u.entry_id),
            '*'
        ),
        resolveRole: createScopedTeamRoleLookup(teamDb, currentUser, defaultRole, rbacActive),
        rbacActive,
    }

    for (const u of rawUpdates) {
        const res = validateSingleTeamBatchUpdate(u, shared)
        if (res.status === 'error') return { errorResponse: res.errorResponse }
        if (res.status === 'not_found') {
            notFound.push(res.entryId)
            continue
        }
        updates.push(res.item)
    }

    return { updates, notFound }
}
