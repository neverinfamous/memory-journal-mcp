/**
 * Team Admin Batch Tools - 3 tools
 *
 * Tools: team_batch_create_entries, team_batch_update_entries, team_batch_delete_entries
 */

import type { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { linkRequestedRelationships } from '../../relationship-linking.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import { getAuthContext } from '../../../../auth/auth-context.js'
import { resolveWorkspaceId, resolveProjectContext } from '../../../../utils/workspace-resolver.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, batchFetchAuthors, triggerTeamNotifications, resolveTeamProjectNumber } from '../helpers.js'
import { enforceEntryOwnership } from '../rbac.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import {
    missingProjectNumberResponse,
    permanentDeleteDeniedResponse,
    filterDeletableIds,
    cleanupDeletedVectors,
} from './batch-delete-helpers.js'
import {
    TeamBatchCreateEntriesSchema,
    TeamBatchCreateEntriesSchemaMcp,
    TeamBatchCreateEntriesOutputSchema,
    TeamBatchUpdateEntriesSchema,
    TeamBatchUpdateEntriesSchemaMcp,
    TeamBatchUpdateEntriesOutputSchema,
    TeamBatchDeleteEntriesSchema,
    TeamBatchDeleteEntriesSchemaMcp,
    TeamBatchDeleteEntriesOutputSchema,
} from '../schemas.js'
import { sendProgress } from '../../../../utils/progress-utils.js'
import { indexBatchEntries } from '../../batch-indexing.js'

type TeamBatchUpdateInput = z.infer<typeof TeamBatchUpdateEntriesSchema>['updates'][number]

function buildValidatedTeamBatchUpdates(
    teamDb: NonNullable<ToolContext['teamDb']>,
    rawUpdates: TeamBatchUpdateInput[],
    rootWorkspaceId: string | undefined,
    rootProjectNumber: number | undefined,
    context: ToolContext,
    currentUser: string,
    callerRole: ReturnType<NonNullable<ToolContext['teamDb']>['resolveTeamRole']> | null,
    codemodeBypass: boolean,
    preFetchedAuthors: Map<number, string | null> | null
):
    | { errorResponse: Record<string, unknown> }
    | { updates: Parameters<NonNullable<ToolContext['teamDb']>['updateEntries']>[0]; notFound: number[] } {
    const updates: Parameters<NonNullable<ToolContext['teamDb']>['updateEntries']>[0] = []
    const notFound: number[] = []

    for (const u of rawUpdates) {
        const wsId = resolveWorkspaceId(
            u.workspace_id ?? rootWorkspaceId,
            u.project_number ?? rootProjectNumber,
            context.config
        )
        const existing = teamDb.getEntryById(u.entry_id, wsId)
        const projectNumber = u.project_number ?? rootProjectNumber ?? existing?.projectNumber
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

        updates.push({
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
                u.workspace_id ?? rootWorkspaceId,
                projectNumber,
                context.config
            ),
        })
    }

    return { updates, notFound }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminBatchTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_batch_create_entries',
            title: 'Team Batch Create Entries',
            description: 'Create multiple team journal entries at once. Max 50 per batch. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use related_to to anchor entries to previous context.',
            group: 'team',
            inputSchema: TeamBatchCreateEntriesSchemaMcp,
            outputSchema: TeamBatchCreateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

                    const input = TeamBatchCreateEntriesSchema.parse(params)
                    await sendProgress(context.progress, 0, 2, 'Creating team entries...')
                    const currentUser = resolveAuthenticatedAuthor()
                    const authCtx = getAuthContext()
                    
                    // Validate all entries and resolve project context first
                    const resolvedEntries = []
                    for (const e of input.entries) {
                        const resolved = resolveProjectContext(
                            {
                                workspace_id: e.workspace_id ?? input.workspace_id,
                                project_number: e.project_number ?? input.project_number,
                                content: e.content,
                                tags: e.tags,
                            },
                            context.config !== undefined
                                ? { ...context.config, defaultProjectNumber: undefined }
                                : undefined
                        )
                        const projectNumber = resolved.projectNumber
                        if (projectNumber === undefined || projectNumber === null) {
                            return {
                                success: false,
                                error: 'Missing project_number. Each entry in the batch MUST provide a valid project_number or configure DEFAULT_PROJECT_NUMBER on the server.',
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Specify the project_number for all entries in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                                recoverable: true,
                            }
                        }
                        if (authCtx?.authenticated && e.author !== undefined && e.author !== currentUser) {
                            return {
                                success: false,
                                error: `Author mismatch: supplied author "${e.author}" does not match authenticated principal "${currentUser}". Omit the author field to use your identity automatically.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Omit the author field to use your authenticated identity automatically.',
                                recoverable: false,
                            }
                        }
                        resolvedEntries.push({
                            e,
                            projectNumber,
                            workspaceId: resolveWriteWorkspaceId(
                                resolved.workspaceId !== 'default'
                                    ? resolved.workspaceId
                                    : (e.workspace_id ?? input.workspace_id),
                                projectNumber,
                                context.config
                            ),
                        })
                    }

                    const inputs = resolvedEntries.map(({ e, projectNumber, workspaceId }) => ({
                        content: e.content,
                        entryType: e.entry_type,
                        tags: e.tags,
                        significanceType: e.significance_type,
                        autoContext: e.auto_context,
                        projectNumber,
                        projectOwner: e.project_owner,
                        issueNumber: e.issue_number,
                        issueUrl: e.issue_url,
                        prNumber: e.pr_number,
                        prUrl: e.pr_url,
                        prStatus: e.pr_status,
                        workflowRunId: e.workflow_run_id,
                        workflowName: e.workflow_name,
                        workflowStatus: e.workflow_status,
                        isPersonal: false,
                        author: e.author ?? currentUser,
                        impactScore: e.impact_score,
                        trustScore: e.trust_score,
                        validationStatus: e.validation_status,
                        sessionId: e.session_id,
                        workspaceId,
                    }))

                    const { created: results, errors } = teamDb.createEntries(inputs)

                    const relationshipWarnings: string[] = []
                    for (let i = 0; i < results.length; i++) {
                        const createdEntry = results[i]
                        const sourceEntry = input.entries[i]
                        if (createdEntry) {
                            relationshipWarnings.push(
                                ...linkRequestedRelationships(
                                    teamDb,
                                    createdEntry.id,
                                    sourceEntry?.relationships,
                                    inputs[i]?.workspaceId
                                )
                            )
                        }
                    }

                    const entries = results.map((r, i) => {
                        const author = inputs[i]?.author
                        return { ...r, author }
                    })

                    await sendProgress(context.progress, 1, 2, `Created ${String(entries.length)} team entries...`)

                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress: context.progress,
                        vectorManager: context.teamVectorManager,
                        db: teamDb,
                        autoIndex: input.auto_index,
                        entryIds: entries.map((e) => e.id),
                        errorPrefix: 'Team entry',
                        doneMessage: 'Team batch create complete',
                    })

                    const allErrors = [
                        ...errors.map(e => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Team batch create partially failed: ${allErrors.length} operations failed`);
                    }

                    triggerTeamNotifications(context)

                    return {
                        success: true,
                        count: entries.length,
                        entries,
                        indexStatuses,
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_update_entries',
            title: 'Team Batch Update Entries',
            description: 'Update multiple existing team journal entries in a single transaction. Max 50 per batch. Can only update entries you authored. Pass expected_version for optimistic locking.',
            group: 'team',
            inputSchema: TeamBatchUpdateEntriesSchemaMcp,
            outputSchema: TeamBatchUpdateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

                    const input = TeamBatchUpdateEntriesSchema.parse(params)
                    await sendProgress(context.progress, 0, 2, 'Updating team entries...')
                    const currentUser = resolveAuthenticatedAuthor()
                    const codemodeBypass = context.config?.codemodeInternalFullAccess === true
                    const callerRole =
                        teamDb.isTeamRbacActive?.()
                            ? teamDb.resolveTeamRole(currentUser, context.config?.teamDefaultRole ?? 'denied')
                            : null
                    const updateIds = input.updates.map((u) => u.entry_id)
                    const preFetchedAuthors =
                        typeof teamDb.getAuthorsForEntries === 'function'
                            ? batchFetchAuthors(teamDb, updateIds)
                            : null

                    const validated = buildValidatedTeamBatchUpdates(
                        teamDb,
                        input.updates,
                        input.workspace_id,
                        input.project_number,
                        context,
                        currentUser,
                        callerRole,
                        codemodeBypass,
                        preFetchedAuthors
                    )
                    if ('errorResponse' in validated) return validated.errorResponse
                    const { updates, notFound } = validated

                    const { updated, notFound: updateNotFound, errors } = teamDb.updateEntries(updates)
                    
                    const entries = updated.map((r) => ({
                        ...r,
                        author: preFetchedAuthors
                            ? (preFetchedAuthors.get(r.id) ?? null)
                            : fetchAuthor(teamDb, r.id),
                    }))

                    await sendProgress(context.progress, 1, 2, `Updated ${String(entries.length)} team entries...`)

                    const contentUpdatedIds = new Set(
                        input.updates.filter((u) => u.content).map((u) => u.entry_id)
                    )
                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress: context.progress,
                        vectorManager: context.teamVectorManager,
                        db: teamDb,
                        autoIndex: input.auto_index,
                        entryIds: entries.map((e) => e.id),
                        errorPrefix: 'Team entry',
                        doneMessage: 'Team batch update complete',
                        shouldIndex: (id) => contentUpdatedIds.has(id),
                    })

                    const finalNotFound = [...notFound, ...updateNotFound]

                    const allErrors = [
                        ...finalNotFound.map(id => new Error(`Team entry ${id} not found`)),
                        ...errors.map(e => new Error(`Team entry ${e.id} failed to update: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Team batch update partially failed: ${allErrors.length} operations failed`);
                    }

                    triggerTeamNotifications(context)

                    return { success: true, count: entries.length, updated: entries, notFound: [...notFound, ...updateNotFound], indexStatuses }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_delete_entries',
            title: 'Team Batch Delete Entries',
            description: 'Delete multiple existing team journal entries in a single transaction. Max 50 per batch. Can only delete entries you authored.',
            group: 'team',
            inputSchema: TeamBatchDeleteEntriesSchemaMcp,
            outputSchema: TeamBatchDeleteEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

                    const input = TeamBatchDeleteEntriesSchema.parse(params)
                    await sendProgress(context.progress, 0, 2, 'Deleting team entries...')
                    const currentUser = resolveAuthenticatedAuthor()
                    const codemodeBypass = context.config?.codemodeInternalFullAccess === true
                    
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const projectNumber = resolveTeamProjectNumber(context, wsId, input.project_number)
                    if (projectNumber === undefined || projectNumber === null) {
                        return missingProjectNumberResponse()
                    }

                    // Filter ids to those that match the project number and check permissions
                    const callerRole =
                        teamDb.isTeamRbacActive?.()
                            ? teamDb.resolveTeamRole(currentUser, context.config?.teamDefaultRole ?? 'denied')
                            : null

                    if (input.permanent && !codemodeBypass && callerRole !== null && callerRole !== 'admin') {
                        return permanentDeleteDeniedResponse(currentUser, callerRole)
                    }

                    const filtered = filterDeletableIds(teamDb, {
                        entryIds: input.entry_ids,
                        wsId,
                        projectNumber,
                        currentUser,
                        callerRole,
                        codemodeBypass,
                    })
                    if ('errorResponse' in filtered) return filtered.errorResponse
                    const { validIds, notFound } = filtered

                    const { deleted, notFound: deleteNotFound, errors } = teamDb.deleteEntries(validIds, input.permanent, wsId)
                    
                    await sendProgress(context.progress, 1, 2, `Deleted ${String(deleted.length)} team entries...`)

                    await cleanupDeletedVectors(context, teamDb, deleted)

                    // Merge notFound arrays
                    const finalNotFound = [...notFound, ...deleteNotFound]

                    // Deletions are already committed, so notify subscribers even when some ids failed
                    if (deleted.length > 0) {
                        triggerTeamNotifications(context)
                    }

                    if (errors.length > 0 || finalNotFound.length > 0) {
                        const mcpErrors = [
                            ...finalNotFound.map(id => new Error(`Team entry ${id} not found`)),
                            ...errors.map(e => new Error(`Team entry ${e.id} failed to delete: ${e.error.message}`))
                        ];
                        throw new AggregateError(
                            mcpErrors,
                            `Team batch delete partially failed: ${deleted.length} deleted (ids: ${deleted.join(', ')}), ${mcpErrors.length} operations failed`
                        );
                    }

                    return { success: true, count: deleted.length, deleted, notFound: finalNotFound, permanent: input.permanent }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
