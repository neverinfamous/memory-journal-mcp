/**
 * Team Admin Batch Tools - 3 tools
 *
 * Tools: team_batch_create_entries, team_batch_update_entries, team_batch_delete_entries
 */

import type { ToolDefinition, ToolContext, RelationshipType } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import { getAuthContext } from '../../../../auth/auth-context.js'
import { resolveWorkspaceId } from '../../../../utils/workspace-resolver.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, batchFetchAuthors, triggerTeamNotifications } from '../helpers.js'
import { enforceOwnership } from '../rbac.js'
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
import { createBatchProgressReporter, sendProgress } from '../../../../utils/progress-utils.js'
import { autoIndexEntry } from '../../../../utils/vector-index-helpers.js'

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
                    
                    // Validate all entries first
                    for (const e of input.entries) {
                        const projectNumber = e.project_number ?? input.project_number
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
                    }

                    const inputs = input.entries.map((e) => {
                        const projectNumber = e.project_number ?? input.project_number
                        if (projectNumber === undefined || projectNumber === null) {
                            throw new Error('projectNumber is required')
                        }
                        return {
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
                            workspaceId: resolveWorkspaceId(e.workspace_id ?? input.workspace_id, e.project_number ?? input.project_number, context.config),
                        }
                    })

                    const { created: results, errors } = teamDb.createEntries(inputs)

                    for (let i = 0; i < results.length; i++) {
                        const createdEntry = results[i]
                        const sourceEntry = input.entries[i]
                        if (createdEntry && sourceEntry?.relationships && sourceEntry.relationships.length > 0) {
                            for (const rel of sourceEntry.relationships) {
                                try {
                                    const canonicalRelType: RelationshipType =
                                        rel.relationType === 'resolves'
                                            ? 'resolved'
                                            : rel.relationType === 'relates_to'
                                              ? 'references'
                                              : rel.relationType === 'depends_on'
                                                ? 'blocked_by'
                                                : rel.relationType
                                    teamDb.linkEntries(createdEntry.id, rel.targetId, canonicalRelType)
                                } catch {
                                    // Ignore link failures if target doesn't exist
                                }
                            }
                        }
                    }

                    const entries = results.map((r, i) => {
                        const author = inputs[i]?.author
                        return { ...r, author }
                    })

                    await sendProgress(context.progress, 1, 2, `Created ${String(entries.length)} team entries...`)

                    const indexStatuses: string[] = []
                    const indexErrors: Error[] = []
                    if (input.auto_index && context.teamVectorManager) {
                        const reporter = createBatchProgressReporter(context.progress, entries.length, 10)
                        for (let i = 0; i < entries.length; i++) {
                            const entry = entries[i]
                            if (entry) {
                                try {
                                    const status = await autoIndexEntry(context.teamVectorManager, teamDb, entry.id)
                                    if (status) indexStatuses.push(status)
                                } catch (err) {
                                    indexErrors.push(new Error(`Team entry ${entry.id} vector indexing failed: ${err instanceof Error ? err.message : String(err)}`))
                                }
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(entries.length)}...`)
                        }
                    } else {
                        await sendProgress(context.progress, 2, 2, 'Team batch create complete')
                    }

                    const allErrors = [
                        ...errors.map(e => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Team batch create partially failed: ${allErrors.length} operations failed`);
                    }

                    triggerTeamNotifications(context)

                    return { success: true, count: entries.length, entries, indexStatuses }
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
                    
                    // Verify ownership and project boundary safety
                    const updates = []
                    const notFound: number[] = []
                    const updateIds = input.updates.map((u) => u.entry_id)
                    const preFetchedAuthors =
                        typeof teamDb.getAuthorsForEntries === 'function'
                            ? batchFetchAuthors(teamDb, updateIds)
                            : null
                    
                    for (const u of input.updates) {
                        const existing = teamDb.getEntryById(u.entry_id, resolveWorkspaceId(u.workspace_id ?? input.workspace_id, u.project_number ?? input.project_number, context.config))
                        
                        const projectNumber = u.project_number ?? input.project_number ?? existing?.projectNumber
                        if (projectNumber === undefined || projectNumber === null) {
                            return {
                                success: false,
                                error: `Missing project_number for team entry ${String(u.entry_id)}. You MUST provide a valid project_number or configure DEFAULT_PROJECT_NUMBER on the server.`,
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                                recoverable: true,
                            }
                        }
                        if (existing) {
                            const author = preFetchedAuthors
                                ? (preFetchedAuthors.get(u.entry_id) ?? null)
                                : fetchAuthor(teamDb, u.entry_id)
                            if (author && !codemodeBypass) {
                                try {
                                    enforceOwnership(currentUser, author, callerRole)
                                } catch {
                                    return {
                                        success: false,
                                        error: `Permission Denied: Only the original author ("${author}") or a team admin can modify team entry ${String(u.entry_id)}.`,
                                        code: 'PERMISSION_DENIED',
                                        category: 'auth',
                                        suggestion: 'You can only update entries that you authored.',
                                        recoverable: false,
                                    }
                                }
                            }
                        } else {
                            notFound.push(u.entry_id)
                            continue
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
                            sessionId: u.session_id ?? undefined,
                            workspaceId: resolveWorkspaceId(u.workspace_id ?? input.workspace_id, u.project_number ?? input.project_number, context.config),
                        })
                    }

                    const { updated, notFound: updateNotFound, errors } = teamDb.updateEntries(updates)
                    
                    const entries = updated.map((r) => ({
                        ...r,
                        author: preFetchedAuthors
                            ? (preFetchedAuthors.get(r.id) ?? null)
                            : fetchAuthor(teamDb, r.id),
                    }))

                    await sendProgress(context.progress, 1, 2, `Updated ${String(entries.length)} team entries...`)

                    const indexStatuses: string[] = []
                    const indexErrors: Error[] = []
                    if (input.auto_index && context.teamVectorManager) {
                        const reporter = createBatchProgressReporter(context.progress, entries.length, 10)
                        for (let i = 0; i < entries.length; i++) {
                            const entry = entries[i]
                            if (entry) {
                                const originalUpdate = input.updates.find(u => u.entry_id === entry.id)
                                if (originalUpdate?.content) {
                                    try {
                                        const status = await autoIndexEntry(context.teamVectorManager, teamDb, entry.id)
                                        if (status) indexStatuses.push(status)
                                    } catch (err) {
                                        indexErrors.push(new Error(`Team entry ${entry.id} vector indexing failed: ${err instanceof Error ? err.message : String(err)}`))
                                    }
                                }
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(entries.length)}...`)
                        }
                    } else {
                        await sendProgress(context.progress, 2, 2, 'Team batch update complete')
                    }

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
                    
                    const projectNumber = input.project_number
                    if (projectNumber === undefined || projectNumber === null) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }

                    // Filter ids to those that match the project number and check permissions
                    const validIds: number[] = []
                    const notFound: number[] = []
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    const callerRole =
                        teamDb.isTeamRbacActive?.()
                            ? teamDb.resolveTeamRole(currentUser, context.config?.teamDefaultRole ?? 'denied')
                            : null

                    if (input.permanent && !codemodeBypass && callerRole !== null && callerRole !== 'admin') {
                        return {
                            success: false,
                            error: `Permission Denied: Permanent deletion of team entries requires the 'admin' role (caller "${currentUser}" has role "${callerRole}").`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'Omit permanent: true to soft-delete your entries, or ask a team admin to permanently delete them.',
                            recoverable: false,
                        }
                    }
                    
                    const existingMap =
                        typeof teamDb.getEntriesByIds === 'function'
                            ? teamDb.getEntriesByIds(input.entry_ids)
                            : null
                    const authorMap =
                        typeof teamDb.getAuthorsForEntries === 'function'
                            ? batchFetchAuthors(teamDb, input.entry_ids)
                            : null

                    for (const id of input.entry_ids) {
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
                                    success: false,
                                    error: `Permission Denied: Only the original author ("${author}") or a team admin can delete team entry ${String(id)}.`,
                                    code: 'PERMISSION_DENIED',
                                    category: 'auth',
                                    suggestion: 'You can only delete entries that you authored.',
                                    recoverable: false,
                                }
                            }
                        }
                        validIds.push(id)
                    }

                    const { deleted, notFound: deleteNotFound, errors } = teamDb.deleteEntries(validIds, input.permanent, wsId)
                    
                    await sendProgress(context.progress, 1, 2, `Deleted ${String(deleted.length)} team entries...`)

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

                    // Merge notFound arrays
                    const finalNotFound = [...notFound, ...deleteNotFound]

                    if (errors.length > 0 || finalNotFound.length > 0) {
                        const mcpErrors = [
                            ...finalNotFound.map(id => new Error(`Team entry ${id} not found`)),
                            ...errors.map(e => new Error(`Team entry ${e.id} failed to delete: ${e.error.message}`))
                        ];
                        throw new AggregateError(mcpErrors, `Team batch delete partially failed: ${mcpErrors.length} operations failed`);
                    }

                    triggerTeamNotifications(context)

                    return { success: true, count: deleted.length, deleted, notFound: finalNotFound, permanent: input.permanent }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
