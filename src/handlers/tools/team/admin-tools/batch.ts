/**
 * Team Admin Batch Tools - 3 tools
 *
 * Tools: team_batch_create_entries, team_batch_update_entries, team_batch_delete_entries
 */

import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { linkRequestedRelationships } from '../../relationship-linking.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveAuthor, resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import { getAuthContext } from '../../../../auth/auth-context.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../../utils/write-scope.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, batchFetchAuthors, triggerTeamNotifications } from '../helpers.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import {
    buildValidatedTeamBatchUpdates,
    executeTeamBatchDelete,
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
import { collectIndexWorkspaces, indexBatchEntries } from '../../batch-indexing.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminBatchTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_batch_create_entries',
            title: 'Team Batch Create Entries',
            description: 'Create multiple team journal entries at once. Max 50 per batch. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use relationships (or related_to) to anchor entries to previous context.',
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
                        if (e.workspace_id === '*' || input.workspace_id === '*') {
                            return {
                                success: false,
                                error: "workspace_id '*' is a read-only wildcard and cannot be used to create team entries.",
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Pass a concrete workspace_id or a project_number.',
                                recoverable: true,
                            }
                        }
                        const namedWorkspace = e.workspace_id ?? input.workspace_id
                        const itemNamesOtherWorkspace =
                            e.workspace_id !== undefined &&
                            input.workspace_id !== undefined &&
                            e.workspace_id.trim().toLowerCase() !==
                                input.workspace_id.trim().toLowerCase()
                        const effectiveProject =
                            e.project_number ??
                            (!itemNamesOtherWorkspace ? input.project_number : undefined)
                        const resolved = resolveProjectContext(
                            {
                                workspace_id: namedWorkspace,
                                project_number: effectiveProject,
                                content: e.content,
                                tags: e.tags,
                            },
                            context.config
                        )
                        const requestedProject = effectiveProject
                        const callerWorkspace =
                            namedWorkspace !== undefined && namedWorkspace !== '*'
                                ? namedWorkspace
                                : undefined
                        // [INVARIANT] A configured defaultProjectNumber does not satisfy team batch create.
                        // Only an explicit number, or the registry project of a named workspace, does.
                        const callerRegistry = activeProjectRegistry(context.config?.projectRegistry)
                        const canonicalCaller =
                            callerWorkspace !== undefined
                                ? (findCanonicalRegistryKey(callerWorkspace, callerRegistry) ??
                                  callerWorkspace)
                                : undefined
                        const projectNumber =
                            requestedProject ??
                            (canonicalCaller !== undefined
                                ? callerRegistry?.[canonicalCaller]?.project_number
                                : undefined)
                        if (projectNumber === undefined || projectNumber === null) {
                            return {
                                success: false,
                                error: 'Missing project_number. Each entry in the batch MUST provide a valid project_number or name a registered workspace.',
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Specify the project_number for every entry, or name a registered workspace whose project is already known.',
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
                        const resolvedAuthor = authCtx?.authenticated
                            ? currentUser
                            : (e.author ?? resolveAuthor())
                        if (resolvedAuthor === 'unknown') {
                            return {
                                success: false,
                                error: 'Identity cannot be resolved securely. In non-OAuth environments, you must set the TEAM_AUTHOR environment variable to claim an identity.',
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'Set the TEAM_AUTHOR environment variable or enable OAuth.',
                                recoverable: false,
                            }
                        }
                        const workspaceId = resolveWriteWorkspaceId(
                            resolved.workspaceId !== 'default'
                                ? resolved.workspaceId
                                : (e.workspace_id ?? input.workspace_id),
                            projectNumber,
                            context.config
                        )
                        const paired = pairStoredScope(
                            workspaceId,
                            projectNumber,
                            activeProjectRegistry(context.config?.projectRegistry)
                        )
                        resolvedEntries.push({
                            e,
                            author: resolvedAuthor,
                            projectNumber: paired.projectNumber ?? projectNumber,
                            workspaceId: paired.workspaceId ?? workspaceId,
                        })
                    }

                    const inputs = resolvedEntries.map(({ e, author, projectNumber, workspaceId }) => ({
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
                        author,
                        impactScore: e.impact_score,
                        trustScore: e.trust_score,
                        validationStatus: e.validation_status,
                        sessionId: e.session_id,
                        workspaceId,
                        ...(e.anchors !== undefined
                            ? {
                                  anchors: e.anchors.map((a) => ({
                                      anchorPath: a.anchor_path,
                                      anchorType: a.anchor_type,
                                      ...(a.status !== undefined ? { status: a.status } : {}),
                                  })),
                              }
                            : {}),
                    }))

                    const { created: results, errors } = teamDb.createEntries(inputs)
                    const failedIndices = new Set(errors.map((err) => err.index))
                    const createdSourceIndices: number[] = []
                    for (let idx = 0; idx < inputs.length; idx++) {
                        if (!failedIndices.has(idx)) {
                            createdSourceIndices.push(idx)
                        }
                    }

                    const relationshipWarnings: string[] = []
                    for (let i = 0; i < results.length; i++) {
                        const createdEntry = results[i]
                        const sourceIdx = createdSourceIndices[i] ?? i
                        const sourceEntry = input.entries[sourceIdx]
                        if (createdEntry) {
                            relationshipWarnings.push(
                                ...linkRequestedRelationships(
                                    teamDb,
                                    createdEntry.id,
                                    sourceEntry?.relationships,
                                    inputs[sourceIdx]?.workspaceId
                                )
                            )
                        }
                    }

                    const entries = results.map((r, i) => {
                        const sourceIdx = createdSourceIndices[i] ?? i
                        const author = inputs[sourceIdx]?.author
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
                        workspaceByEntryId: collectIndexWorkspaces(entries),
                    })

                    const allErrors = [
                        ...errors.map(e => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Team batch create partially failed: ${allErrors.length} operations failed`);
                    }

                    triggerTeamNotifications(context)

                    const failedVectorCount = indexStatuses.filter((s) => s === 'failed').length
                    return {
                        success: true,
                        count: entries.length,
                        entries,
                        indexStatuses,
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
                        ...(failedVectorCount > 0
                            ? { warning: `Vector indexing failed for ${String(failedVectorCount)} team entry(ies).` }
                            : {}),
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
                        input.updates.filter((u) => u.content !== undefined).map((u) => u.entry_id)
                    )
                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress: context.progress,
                        vectorManager: context.teamVectorManager,
                        db: teamDb,
                        // [INVARIANT] Content edits always resync existing team vectors, matching team_update_entry.
                        autoIndex: input.auto_index || contentUpdatedIds.size > 0,
                        entryIds: entries.map((e) => e.id),
                        errorPrefix: 'Team entry',
                        doneMessage: 'Team batch update complete',
                        shouldIndex: (id) => contentUpdatedIds.has(id),
                        workspaceByEntryId: collectIndexWorkspaces(entries),
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

                    const failedUpdateVectors = indexStatuses.filter((s) => s === 'failed').length
                    return {
                        success: true,
                        count: entries.length,
                        updated: entries,
                        notFound: finalNotFound,
                        indexStatuses,
                        ...(failedUpdateVectors > 0
                            ? { warning: `Vector indexing failed for ${String(failedUpdateVectors)} team entry(ies).` }
                            : {}),
                    }
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
                    return await executeTeamBatchDelete(context, teamDb, input)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
