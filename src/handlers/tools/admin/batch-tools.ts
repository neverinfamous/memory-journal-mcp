import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../batch-indexing.js'
import { createBatchProgressReporter, sendProgress } from '../../../utils/progress-utils.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { prepareBatchCreateInputs, shareBatchEntriesWithTeam } from './batch-create-helpers.js'
import {
    findWildcardProjectMismatches,
    safeDeleteVectors,
    vectorWarningField,
} from './batch-vector-helpers.js'
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
            description: 'Create multiple journal entries at once. Max 50 per batch. Use this for imports or bulk creation. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. Extract this by querying memory://agent-id. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use relationships (or related_to) to anchor entries to previous context.',
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


                    const prepared = await prepareBatchCreateInputs(
                        input.entries,
                        input.project_number,
                        context
                    )
                    const { created: results, errors } = db.createEntries(prepared.map((p) => p.input))

                    const failedIndexes = new Set(errors.map((e) => e.index))
                    const createdIndexes = input.entries
                        .map((_, i) => i)
                        .filter((i) => !failedIndexes.has(i))
                    const relationshipWarnings: string[] = []
                    relationshipWarnings.push(
                        ...shareBatchEntriesWithTeam(context, prepared, createdIndexes).warnings
                    )
                    for (let i = 0; i < results.length; i++) {
                        const createdEntry = results[i]
                        // [INVARIANT] H8: results are compacted (failed items omitted), so map back
                        // through createdIndexes to the originating input/prepared index.
                        const sourceIndex = createdIndexes[i]
                        if (createdEntry && sourceIndex !== undefined) {
                            relationshipWarnings.push(
                                ...linkRequestedRelationships(
                                    db,
                                    createdEntry.id,
                                    input.entries[sourceIndex]?.relationships,
                                    prepared[sourceIndex]?.input.workspaceId
                                )
                            )
                        }
                    }
                    
                    await sendProgress(progress, 1, 2, `Created ${String(results.length)} entries...`)

                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress,
                        vectorManager,
                        db,
                        autoIndex: input.auto_index,
                        entryIds: results.map((r) => r.id),
                        errorPrefix: 'Entry',
                        doneMessage: 'Batch create complete',
                        workspaceByEntryId: collectIndexWorkspaces(results),
                    })

                    const allErrors = [
                        ...errors.map(e => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
                        ...indexErrors
                    ]

                    if (allErrors.length > 0) {
                        throw new AggregateError(allErrors, `Batch create partially failed: ${allErrors.length} operations failed`);
                    }

                    return {
                        success: true,
                        count: results.length,
                        entries: results,
                        indexStatuses,
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
                    }
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
                    const wildcardMismatches = findWildcardProjectMismatches(
                        db,
                        input.updates,
                        input.workspace_id,
                        input.project_number
                    )
                    if (wildcardMismatches.length > 0) {
                        return {
                            success: false,
                            error: `Batch update aborted because entries were not found in the requested project: ${wildcardMismatches.join(', ')}. No rows were updated.`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                            suggestion: 'Verify the entry identifiers and project number',
                            count: 0,
                            notFound: wildcardMismatches,
                        }
                    }
                    await sendProgress(progress, 0, 2, 'Updating entries...')
                    const updates = input.updates.map((u) => {
                        const explicitWs = u.workspace_id || input.workspace_id
                        const explicitPn = u.project_number ?? input.project_number
                        const resolvedUpdate = resolveProjectContext(
                            {
                                ...(explicitWs !== undefined && explicitWs !== '*'
                                    ? { workspace_id: explicitWs }
                                    : {}),
                                ...(explicitPn !== undefined ? { project_number: explicitPn } : {}),
                                ...(u.content !== undefined ? { content: u.content } : {}),
                                ...(u.tags !== undefined ? { tags: u.tags } : {}),
                            },
                            context.config
                        )
                        let resolvedWs =
                            explicitWs === '*'
                                ? '*'
                                : resolvedUpdate.workspaceId
                        if (
                            explicitWs === undefined &&
                            explicitPn === undefined
                        ) {
                            const existingByPk = db.getEntryById(u.entry_id, '*')
                            if (existingByPk?.workspaceId !== undefined) {
                                resolvedWs = existingByPk.workspaceId
                            }
                        }
                        return {
                            id: u.entry_id,
                            content: u.content,
                            entryType: u.entry_type,
                            isPersonal: u.is_personal,
                            tags: u.tags,
                            significanceType: u.significance_type,
                            projectNumber:
                                u.project_number === undefined && input.project_number === undefined
                                    ? undefined
                                    : resolvedUpdate.projectNumber,
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
                            targetWorkspaceId:
                                u.target_workspace_id === undefined
                                    ? undefined
                                    : resolveWriteWorkspaceId(u.target_workspace_id, undefined, context.config),
                            sessionId: u.session_id,
                            workspaceId: resolvedWs,
                        }
                    })

                    const { updated, notFound, errors } = db.updateEntries(updates)

                    await sendProgress(progress, 1, 2, `Updated ${String(updated.length)} entries...`)

                    // Re-index only if content was part of the update
                    const contentUpdatedIds = new Set(
                        input.updates.filter((u) => u.content).map((u) => u.entry_id)
                    )
                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress,
                        vectorManager,
                        db,
                        autoIndex: input.auto_index,
                        entryIds: updated.map((r) => r.id),
                        errorPrefix: 'Entry',
                        doneMessage: 'Batch update complete',
                        shouldIndex: (id) => contentUpdatedIds.has(id),
                        workspaceByEntryId: collectIndexWorkspaces(updated),
                    })

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
                    if (
                        input.workspace_id === undefined &&
                        input.project_number === undefined
                    ) {
                        const missing: number[] = []
                        const groups = new Map<string, number[]>()
                        for (const id of input.entry_ids) {
                            const existing = db.getEntryByIdIncludeDeleted(id, '*')
                            if (existing === null || existing === undefined) {
                                missing.push(id)
                                continue
                            }
                            const entryWorkspace = existing.workspaceId
                            if (entryWorkspace === undefined || entryWorkspace.length === 0) {
                                missing.push(id)
                                continue
                            }
                            const bucket = groups.get(entryWorkspace)
                            if (bucket === undefined) {
                                groups.set(entryWorkspace, [id])
                            } else {
                                bucket.push(id)
                            }
                        }
                        if (missing.length > 0) {
                            return {
                                success: false,
                                error: `Batch delete aborted because entries were not found: ${missing.join(', ')}. No rows were deleted.`,
                                code: 'RESOURCE_NOT_FOUND',
                                category: 'resource',
                                recoverable: false,
                                suggestion: 'Verify the entry identifiers and try again',
                                count: 0,
                                deleted: [],
                                notFound: missing,
                                permanent: input.permanent,
                            }
                        }

                        await sendProgress(progress, 0, 2, 'Deleting entries...')
                        const deleted: number[] = []
                        const notFound: number[] = []
                        const errors: { id: number; error: Error }[] = []
                        const vectorWarnings: string[] = []
                        for (const [groupWorkspace, ids] of groups) {
                            let groupResult: {
                                deleted: number[]
                                notFound: number[]
                                errors: { id: number; error: Error }[]
                            }
                            try {
                                groupResult = db.deleteEntries(ids, input.permanent, groupWorkspace)
                            } catch (err) {
                                const message = err instanceof Error ? err.message : String(err)
                                return {
                                    success: false,
                                    error: `Batch delete stopped after a committed delete: ${message}`,
                                    code: 'INTERNAL_ERROR',
                                    category: 'internal',
                                    recoverable: false,
                                    count: deleted.length,
                                    deleted,
                                    notFound,
                                    permanent: input.permanent,
                                }
                            }
                            deleted.push(...groupResult.deleted)
                            notFound.push(...groupResult.notFound)
                            errors.push(...groupResult.errors)
                            if (vectorManager) {
                                vectorWarnings.push(...safeDeleteVectors(db, groupResult.deleted))
                            }
                        }

                        await sendProgress(progress, 2, 2, 'Batch delete complete')

                        if (errors.length > 0 || notFound.length > 0) {
                            return {
                                success: false,
                                error: `Batch delete partially failed: ${String(notFound.length + errors.length)} failed`,
                                code: 'AGGREGATE_ERROR',
                                category: 'internal',
                                recoverable: false,
                                count: deleted.length,
                                deleted,
                                notFound,
                                permanent: input.permanent,
                                aggregated_errors: [
                                    ...notFound.map((id) => ({ message: `Entry ${String(id)} not found` })),
                                    ...errors.map((entry) => ({
                                        message: `Entry ${String(entry.id)} failed to delete: ${entry.error.message}`,
                                    })),
                                ],
                            }
                        }

                        return {
                            success: true,
                            count: deleted.length,
                            deleted,
                            notFound,
                            permanent: input.permanent,
                            ...vectorWarningField(vectorWarnings),
                        }
                    }

                    const wsId =
                        input.workspace_id === '*'
                            ? '*'
                            : resolveWriteWorkspaceId(
                                  input.workspace_id,
                                  input.project_number,
                                  context.config
                              )
                    const missingBeforeDelete: number[] = []
                    for (const id of input.entry_ids) {
                        const existing = db.getEntryByIdIncludeDeleted(id, wsId)
                        if (
                            existing === null ||
                            existing === undefined ||
                            (input.project_number !== undefined &&
                                existing.projectNumber !== input.project_number)
                        ) {
                            missingBeforeDelete.push(id)
                        }
                    }
                    if (missingBeforeDelete.length > 0) {
                        return {
                            success: false,
                            error: `Batch delete aborted because entries were not found: ${missingBeforeDelete.join(', ')}. No rows were deleted.`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: false,
                            suggestion: 'Verify the entry identifiers and try again',
                            count: 0,
                            deleted: [],
                            notFound: missingBeforeDelete,
                            permanent: input.permanent,
                        }
                    }
                    await sendProgress(progress, 0, 2, 'Deleting entries...')
                    const { deleted, notFound, errors } = db.deleteEntries(input.entry_ids, input.permanent, wsId)
                    
                    await sendProgress(progress, 1, 2, `Deleted ${String(deleted.length)} entries...`)
                    
                    const vectorWarnings: string[] = []
                    if (vectorManager) {
                        const reporter = createBatchProgressReporter(progress, deleted.length, 10)
                        for (let i = 0; i < deleted.length; i++) {
                            const id = deleted[i]
                            if (id !== undefined) vectorWarnings.push(...safeDeleteVectors(db, [id]))
                            await reporter(i + 1, `Updating index ${String(i + 1)}/${String(deleted.length)}...`)
                        }
                    } else {
                        await sendProgress(progress, 2, 2, 'Batch delete complete')
                    }

                    if (errors.length > 0 || notFound.length > 0) {
                        return {
                            success: false,
                            error: `Batch delete partially failed: ${String(notFound.length + errors.length)} failed`,
                            code: 'AGGREGATE_ERROR',
                            category: 'internal',
                            recoverable: false,
                            count: deleted.length,
                            deleted,
                            notFound,
                            permanent: input.permanent,
                            aggregated_errors: [
                                ...notFound.map((id) => ({ message: `Entry ${String(id)} not found` })),
                                ...errors.map((entry) => ({
                                    message: `Entry ${String(entry.id)} failed to delete: ${entry.error.message}`,
                                })),
                            ],
                        }
                    }

                    return {
                        success: true,
                        count: deleted.length,
                        deleted,
                        notFound,
                        permanent: input.permanent,
                        ...vectorWarningField(vectorWarnings),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
