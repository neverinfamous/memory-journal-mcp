import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveProjectContext, resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { createBatchProgressReporter, sendProgress } from '../../../utils/progress-utils.js'
import {
    BatchCreateEntriesSchema,
    BatchCreateEntriesSchemaMcp,
    BatchCreateEntriesOutputSchema,
    BatchUpdateEntriesSchema,
    BatchUpdateEntriesSchemaMcp,
    BatchUpdateEntriesOutputSchema,
    BatchDeleteEntriesSchema,
    BatchDeleteEntriesSchemaMcp,
    BatchDeleteEntriesOutputSchema,
} from './schemas.js'

export function getBatchTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, progress } = context;
    return [

        {
            name: 'batch_create_entries',
            title: 'Batch Create Entries',
            description: 'Create multiple journal entries at once. Max 50 per batch. Use this for imports or bulk creation. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. Extract this by querying memory://agent-id. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use related_to to anchor entries to previous context.',
            group: 'admin',
            inputSchema: BatchCreateEntriesSchemaMcp,
            outputSchema: BatchCreateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = BatchCreateEntriesSchema.parse(params)
                    await sendProgress(progress, 0, 2, 'Creating entries...')


                    const { created: results, errors } = db.createEntries(input.entries.map((e) => {
                        const wsId = e.workspace_id
                        let pNumber = e.project_number ?? input.project_number
                        if (pNumber === undefined || pNumber === null || pNumber <= 0) {
                            const resolved = resolveProjectContext(
                                {
                                    workspace_id: wsId,
                                    project_number: pNumber,
                                    content: e.content,
                                    tags: e.tags
                                },
                                context.config
                            )
                            pNumber = resolved.projectNumber
                        }

                        if (pNumber === undefined || pNumber === null || pNumber <= 0) {
                            throw new Error(
                                `project_number is required. Batch entry must be assigned to a valid project (failed to resolve project_number for workspace '${wsId}'). To find your project_number, read memory://agent-id via read_resource, call mj.core.listProjects(), or check memory://briefing/<project-name>.`
                            )
                        }
                        
                        return {
                            content: e.content,
                            entryType: e.entry_type,
                            tags: e.tags,
                            isPersonal: e.is_personal,
                            significanceType: e.significance_type,
                            autoContext: undefined, // Ignore deprecated auto_context
                            projectNumber: pNumber,
                            projectOwner: e.project_owner,
                            issueNumber: e.issue_number,
                            issueUrl: e.issue_url,
                            prNumber: e.pr_number,
                            prUrl: e.pr_url,
                            prStatus: e.pr_status,
                            workflowRunId: e.workflow_run_id,
                            workflowName: e.workflow_name,
                            workflowStatus: e.workflow_status as 'queued' | 'in_progress' | 'completed' | undefined,
                            sessionId: e.session_id,
                            workspaceId: wsId,
                        }
                    }))
                    
                    await sendProgress(progress, 1, 2, `Created ${String(results.length)} entries...`)

                    const indexStatuses: string[] = []
                    const indexErrors: Error[] = []
                    if (input.auto_index && vectorManager) {
                        const reporter = createBatchProgressReporter(progress, results.length, 10)
                        for (let i = 0; i < results.length; i++) {
                            const entry = results[i]
                            if (entry) {
                                try {
                                    const status = await autoIndexEntry(vectorManager, db, entry.id)
                                    if (status) indexStatuses.push(status)
                                } catch (err) {
                                    indexErrors.push(new Error(`Entry ${entry.id} vector indexing failed: ${err instanceof Error ? err.message : String(err)}`))
                                }
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(results.length)}...`)
                        }
                    } else {
                        await sendProgress(progress, 2, 2, 'Batch create complete')
                    }

                    const allErrors = [
                        ...errors.map(e => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Batch create partially failed: ${allErrors.length} operations failed`);
                    }

                    return { success: true, count: results.length, entries: results, indexStatuses }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'batch_update_entries',
            title: 'Batch Update Entries',
            description: 'Update multiple existing journal entries in a single transaction. Max 50 per batch. REQUIRED: You MUST include project_number. Extract this by querying memory://agent-id.',
            group: 'admin',
            inputSchema: BatchUpdateEntriesSchemaMcp,
            outputSchema: BatchUpdateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = BatchUpdateEntriesSchema.parse(params)
                    await sendProgress(progress, 0, 2, 'Updating entries...')
                    const updates = input.updates.map((u) => ({
                        id: u.entry_id,
                        content: u.content,
                        entryType: u.entry_type,
                        isPersonal: u.is_personal,
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
                        isArchived: u.is_archived,
                        expectedVersion: u.expected_version,
                        sessionId: u.session_id ?? undefined,
                        workspaceId: resolveWorkspaceId(u.workspace_id || input.workspace_id, u.project_number ?? input.project_number, context.config),
                    }))

                    const { updated, notFound, errors } = db.updateEntries(updates)

                    await sendProgress(progress, 1, 2, `Updated ${String(updated.length)} entries...`)

                    const indexStatuses: string[] = []
                    const indexErrors: Error[] = []
                    if (input.auto_index && vectorManager) {
                        const reporter = createBatchProgressReporter(progress, updated.length, 10)
                        for (let i = 0; i < updated.length; i++) {
                            const entry = updated[i]
                            if (entry) {
                                // Re-index only if content was part of the update
                                const originalUpdate = input.updates.find(u => u.entry_id === entry.id)
                                if (originalUpdate?.content) {
                                    try {
                                        const status = await autoIndexEntry(vectorManager, db, entry.id)
                                        if (status) indexStatuses.push(status)
                                    } catch (err) {
                                        indexErrors.push(new Error(`Entry ${entry.id} vector indexing failed: ${err instanceof Error ? err.message : String(err)}`))
                                    }
                                }
                            }
                            await reporter(i + 1, `Indexing ${String(i + 1)}/${String(updated.length)}...`)
                        }
                    } else {
                        await sendProgress(progress, 2, 2, 'Batch update complete')
                    }

                    const allErrors = [
                        ...notFound.map(id => new Error(`Entry ${id} not found`)),
                        ...errors.map(e => new Error(`Entry ${e.id} failed to update: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Batch update partially failed: ${allErrors.length} operations failed`);
                    }

                    return { success: true, count: updated.length, updated, notFound, indexStatuses }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'batch_delete_entries',
            title: 'Batch Delete Entries',
            description: 'Delete multiple existing journal entries in a single transaction. Max 50 per batch.',
            group: 'admin',
            inputSchema: BatchDeleteEntriesSchemaMcp,
            outputSchema: BatchDeleteEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = BatchDeleteEntriesSchema.parse(params)
                    await sendProgress(progress, 0, 2, 'Deleting entries...')
                    const { deleted, notFound, errors } = db.deleteEntries(input.entry_ids, input.permanent)
                    
                    await sendProgress(progress, 1, 2, `Deleted ${String(deleted.length)} entries...`)
                    
                    if (vectorManager) {
                        const reporter = createBatchProgressReporter(progress, deleted.length, 10)
                        for (let i = 0; i < deleted.length; i++) {
                            const id = deleted[i]
                            if (id !== undefined) db.deleteVector(id)
                            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
                        }
                    } else {
                        await sendProgress(progress, 2, 2, 'Batch delete complete')
                    }

                    if (errors.length > 0 || notFound.length > 0) {
                        const mcpErrors = [
                            ...notFound.map(id => new Error(`Entry ${id} not found`)),
                            ...errors.map(e => new Error(`Entry ${e.id} failed to delete: ${e.error.message}`))
                        ];
                        throw new AggregateError(mcpErrors, `Batch delete partially failed: ${mcpErrors.length} failed`);
                    }

                    return { success: true, count: deleted.length, deleted, notFound, permanent: input.permanent }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
