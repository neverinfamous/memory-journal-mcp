/**
 * Team Admin Tools - 3 tools
 *
 * Tools: team_update_entry, team_delete_entry, team_merge_tags
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor } from './helpers.js'
import {
    TeamUpdateEntrySchema,
    TeamUpdateEntrySchemaMcp,
    TeamDeleteEntrySchema,
    TeamDeleteEntrySchemaMcp,
    TeamMergeTagsSchema,
    TeamMergeTagsSchemaMcp,
    TeamUpdateOutputSchema,
    TeamDeleteOutputSchema,
    TeamMergeTagsOutputSchema,
    TeamBatchCreateEntriesSchema,
    TeamBatchCreateEntriesSchemaMcp,
    TeamBatchCreateEntriesOutputSchema,
    TeamBatchUpdateEntriesSchema,
    TeamBatchUpdateEntriesSchemaMcp,
    TeamBatchUpdateEntriesOutputSchema,
    TeamBatchDeleteEntriesSchema,
    TeamBatchDeleteEntriesSchemaMcp,
    TeamBatchDeleteEntriesOutputSchema,
} from './schemas.js'
import { coerceSignificanceAlias } from '../schemas.js'
import { createBatchProgressReporter, sendProgress } from '../../../utils/progress-utils.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_update_entry',
            title: 'Update Team Entry',
            description:
                'Update a team entry (content, type, tags, and 11 metadata fields including significance, project, issue, PR, and workflow). Pass null to clear a field. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamUpdateEntrySchemaMcp,
            outputSchema: TeamUpdateOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    coerceSignificanceAlias(params)

                    const input = TeamUpdateEntrySchema.parse(params)

                    // Verify entry exists
                    const existing = teamDb.getEntryById(input.entry_id)
                    if (!existing) {
                        return {
                            success: false,
                            error: `Team entry ${String(input.entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, input.entry_id)

                    const currentUser = resolveAuthenticatedAuthor()

                    if (author && author !== currentUser) {
                        return {
                            success: false,
                            error: `Permission Denied: Only the original author ("${author}") can modify this team entry.`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'You can only update entries that you authored.',
                            recoverable: false,
                        }
                    }

                    const updated = teamDb.updateEntry(input.entry_id, {
                        content: input.content,
                        entryType: input.entry_type,
                        tags: input.tags,
                        significanceType: input.significance_type,
                        projectNumber: input.project_number,
                        projectOwner: input.project_owner,
                        issueNumber: input.issue_number,
                        issueUrl: input.issue_url,
                        prNumber: input.pr_number,
                        prUrl: input.pr_url,
                        prStatus: input.pr_status,
                        workflowRunId: input.workflow_run_id,
                        workflowName: input.workflow_name,
                        workflowStatus: input.workflow_status,
                    })

                    return {
                        success: true,
                        entry: { ...updated, author },
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_delete_entry',
            title: 'Delete Team Entry',
            description:
                'Soft-delete a team entry (marks as deleted, preservable). Calling with permanent: true on a previously soft-deleted entry works. Returns success: false for nonexistent entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamDeleteEntrySchemaMcp,
            outputSchema: TeamDeleteOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, project_number } = TeamDeleteEntrySchema.parse(params)

                    // Verify entry exists and belongs to project (if project_number is specified)
                    const existing = teamDb.getEntryById(entry_id)
                    if (
                        !existing ||
                        (project_number !== undefined && existing.projectNumber !== project_number)
                    ) {
                        return {
                            success: false,
                            error: `Team entry ${String(entry_id)} not found or lacks permission for project ${project_number}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion:
                                'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    const author = fetchAuthor(teamDb, entry_id)

                    const currentUser = resolveAuthenticatedAuthor()

                    if (author && author !== currentUser) {
                        return {
                            success: false,
                            error: `Permission Denied: Only the original author ("${author}") can delete this team entry.`,
                            code: 'PERMISSION_DENIED',
                            category: 'auth',
                            suggestion: 'You can only delete entries that you authored.',
                            recoverable: false,
                        }
                    }

                    teamDb.deleteEntry(entry_id)
                    teamDb.deleteVector(entry_id)

                    return {
                        success: true,
                        message: `Team entry ${String(entry_id)} soft-deleted`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_merge_tags',
            title: 'Merge Team Tags',
            description:
                'Merge a source tag into a target tag in the team database. All entries with the source tag will be re-tagged with the target tag. Only updates non-deleted entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamMergeTagsSchemaMcp,
            outputSchema: TeamMergeTagsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { source_tag, target_tag } = TeamMergeTagsSchema.parse(params)

                    if (source_tag === target_tag) {
                        return {
                            success: false,
                            error: 'Source and target tags must be different',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Provide two different tag names',
                            recoverable: true,
                        }
                    }

                    const result = teamDb.mergeTags(source_tag, target_tag)

                    return {
                        success: true,
                        message: `Merged tag "${source_tag}" into "${target_tag}". Updated ${String(result.entriesUpdated)} entries.`,
                        entriesUpdated: result.entriesUpdated,
                        sourceDeleted: result.sourceDeleted,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_create_entries',
            title: 'Team Batch Create Entries',
            description: 'Create multiple team journal entries at once. Max 50 per batch.',
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
                    
                    const inputs = input.entries.map((e) => ({
                        content: e.content,
                        entryType: e.entry_type,
                        tags: e.tags,
                        significanceType: e.significance_type,
                        projectNumber: e.project_number,
                        projectOwner: e.project_owner,
                        issueNumber: e.issue_number,
                        issueUrl: e.issue_url,
                        prNumber: e.pr_number,
                        prUrl: e.pr_url,
                        prStatus: e.pr_status,
                        author: e.author ?? currentUser,
                    }))

                    const results = teamDb.createEntries(inputs)

                    const entries = results.map((r, i) => {
                        const author = inputs[i]?.author
                        return { ...r, author }
                    })

                    await sendProgress(context.progress, 1, 2, `Created ${String(entries.length)} team entries...`)

                    const indexStatuses: string[] = []
                    if (input.auto_index && context.teamVectorManager) {
                        const reporter = createBatchProgressReporter(context.progress, entries.length, 10)
                        for (let i = 0; i < entries.length; i++) {
                            const entry = entries[i]
                            if (entry) {
                                const status = await autoIndexEntry(context.teamVectorManager, entry.id, entry.content)
                                if (status) indexStatuses.push(status)
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(entries.length)}...`)
                        }
                    } else {
                        await sendProgress(context.progress, 2, 2, 'Team batch create complete')
                    }

                    return { success: true, count: entries.length, entries, indexStatuses }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_update_entries',
            title: 'Team Batch Update Entries',
            description: 'Update multiple existing team journal entries in a single transaction. Max 50 per batch. Can only update entries you authored.',
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
                    
                    // Verify ownership
                    for (const u of input.updates) {
                        const existing = teamDb.getEntryById(u.entry_id)
                        if (existing) {
                            const author = fetchAuthor(teamDb, u.entry_id)
                            if (author && author !== currentUser) {
                                return {
                                    success: false,
                                    error: `Permission Denied: Only the original author ("${author}") can modify team entry ${String(u.entry_id)}.`,
                                    code: 'PERMISSION_DENIED',
                                    category: 'auth',
                                    suggestion: 'You can only update entries that you authored.',
                                    recoverable: false,
                                }
                            }
                        }
                    }

                    const updates = input.updates.map((u) => ({
                        id: u.entry_id,
                        content: u.content,
                        entryType: u.entry_type,
                        tags: u.tags,
                        significanceType: u.significance_type,
                        projectNumber: u.project_number,
                        projectOwner: u.project_owner,
                        issueNumber: u.issue_number,
                        issueUrl: u.issue_url,
                        prNumber: u.pr_number,
                        prUrl: u.pr_url,
                        prStatus: u.pr_status,
                        workflowRunId: u.workflow_run_id,
                        workflowName: u.workflow_name,
                        workflowStatus: u.workflow_status,
                    }))

                    const { updated, notFound } = teamDb.updateEntries(updates)
                    
                    const entries = updated.map(r => ({
                        ...r,
                        author: fetchAuthor(teamDb, r.id)
                    }))

                    await sendProgress(context.progress, 1, 2, `Updated ${String(entries.length)} team entries...`)

                    const indexStatuses: string[] = []
                    if (input.auto_index && context.teamVectorManager) {
                        const reporter = createBatchProgressReporter(context.progress, entries.length, 10)
                        for (let i = 0; i < entries.length; i++) {
                            const entry = entries[i]
                            if (entry) {
                                const originalUpdate = input.updates.find(u => u.entry_id === entry.id)
                                if (originalUpdate?.content) {
                                    const status = await autoIndexEntry(context.teamVectorManager, entry.id, entry.content)
                                    if (status) indexStatuses.push(status)
                                }
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(entries.length)}...`)
                        }
                    } else {
                        await sendProgress(context.progress, 2, 2, 'Team batch update complete')
                    }

                    return { success: true, count: entries.length, updated: entries, notFound, indexStatuses }
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
                    
                    // Filter ids to those that match the project number and check permissions
                    const validIds: number[] = []
                    const notFound: number[] = []
                    
                    for (const id of input.entry_ids) {
                        const existing = teamDb.getEntryById(id)
                        if (existing?.projectNumber !== input.project_number) {
                            notFound.push(id)
                            continue
                        }
                        
                            const author = fetchAuthor(teamDb, id)
                        if (author && author !== currentUser) {
                            return {
                                success: false,
                                error: `Permission Denied: Only the original author ("${author}") can delete team entry ${String(id)}.`,
                                code: 'PERMISSION_DENIED',
                                category: 'auth',
                                suggestion: 'You can only delete entries that you authored.',
                                recoverable: false,
                            }
                        }
                        validIds.push(id)
                    }

                    const result = teamDb.deleteEntries(validIds, input.permanent)
                    
                    await sendProgress(context.progress, 1, 2, `Deleted ${String(result.deleted.length)} team entries...`)

                    if (context.teamVectorManager) {
                        const reporter = createBatchProgressReporter(context.progress, result.deleted.length, 10)
                        for (let i = 0; i < result.deleted.length; i++) {
                            const id = result.deleted[i]
                            if (id !== undefined) teamDb.deleteVector(id)
                            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(result.deleted.length)}...`)
                        }
                    } else {
                        await sendProgress(context.progress, 2, 2, 'Team batch delete complete')
                    }

                    // Merge notFound arrays
                    const finalNotFound = [...notFound, ...result.notFound]

                    return { success: true, count: result.deleted.length, deleted: result.deleted, notFound: finalNotFound, permanent: input.permanent }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
