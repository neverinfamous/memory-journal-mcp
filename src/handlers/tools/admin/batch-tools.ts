import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../batch-indexing.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { canonicalTargetWorkspace } from './core-tools.js'
import { prepareBatchCreateInputs, shareBatchEntriesWithTeam } from './batch-create-helpers.js'
import {
    executeBatchDeleteEntries,
    findWildcardProjectMismatches,
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
                        context,
                        input.workspace_id
                    )
                    const { created: results, errors } = db.createEntries(prepared.map((p) => p.input))

                    const failedIndexes = new Set(errors.map((e) => e.index))
                    const createdIndexes = input.entries
                        .map((_, i) => i)
                        .filter((i) => !failedIndexes.has(i))
                    const relationshipWarnings: string[] = []
                    relationshipWarnings.push(
                        ...(await shareBatchEntriesWithTeam(context, prepared, createdIndexes)).warnings
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

                    const failedVectorCount = indexStatuses.filter((s) => s === 'failed').length
                    return {
                        success: true,
                        count: results.length,
                        entries: results,
                        indexStatuses,
                        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
                        ...(failedVectorCount > 0
                            ? { warning: `Vector indexing failed for ${String(failedVectorCount)} entry(ies).` }
                            : {}),
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
                        input.project_number,
                        context.config
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
                        const explicitWs = u.workspace_id ?? input.workspace_id
                        const explicitPn = u.project_number ?? input.project_number
                        const targetWorkspaceId = canonicalTargetWorkspace(
                            u.target_workspace_id,
                            context.config
                        )
                        let resolvedWs: string
                        let projectNumberForUpdate: number | null | undefined
                        if (targetWorkspaceId !== undefined) {
                            const targetResolved = resolveProjectContext(
                                {
                                    workspace_id: targetWorkspaceId,
                                    ...(u.project_number !== undefined
                                        ? { project_number: u.project_number }
                                        : {}),
                                },
                                context.config
                            )
                            projectNumberForUpdate = targetResolved.projectNumber ?? null
                            if (explicitWs === '*') {
                                resolvedWs = '*'
                            } else if (explicitWs !== undefined) {
                                resolvedWs = resolveWriteWorkspaceId(explicitWs, undefined, context.config)
                            } else {
                                resolvedWs = db.getEntryById(u.entry_id, '*')?.workspaceId ?? targetWorkspaceId
                            }
                        } else {
                            const resolvedUpdate = resolveProjectContext(
                                {
                                    ...(explicitWs !== undefined && explicitWs !== '*'
                                        ? { workspace_id: explicitWs }
                                        : {}),
                                    ...(explicitPn !== undefined ? { project_number: explicitPn } : {}),
                                },
                                context.config
                            )
                            projectNumberForUpdate =
                                explicitPn === undefined ? undefined : resolvedUpdate.projectNumber
                            resolvedWs =
                                explicitWs === '*' ? '*' : resolvedUpdate.workspaceId
                            if (explicitWs === undefined) {
                                const existingByPk =
                                    typeof db.getEntryById === 'function'
                                        ? db.getEntryById(u.entry_id, '*')
                                        : undefined
                                if (existingByPk?.workspaceId !== undefined) {
                                    resolvedWs = existingByPk.workspaceId
                                }
                                if (explicitPn !== undefined) {
                                    projectNumberForUpdate ??= explicitPn
                                }
                            }
                        }
                        return {
                            id: u.entry_id,
                            content: u.content,
                            entryType: u.entry_type,
                            isPersonal: u.is_personal,
                            tags: u.tags,
                            significanceType: u.significance_type,
                            projectNumber: projectNumberForUpdate,
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
                            targetWorkspaceId,
                            sessionId: u.session_id,
                            workspaceId: resolvedWs,
                        }
                    })

                    const { updated, notFound, errors } = db.updateEntries(updates)

                    await sendProgress(progress, 1, 2, `Updated ${String(updated.length)} entries...`)

                    // Re-index if content changed or workspace moved so vector search reflects new metadata
                    const reindexIds = new Set(
                        input.updates
                            .filter(
                                (u) => u.content !== undefined || u.target_workspace_id !== undefined
                            )
                            .map((u) => u.entry_id)
                    )
                    const { indexStatuses, indexErrors } = await indexBatchEntries({
                        progress,
                        vectorManager,
                        db,
                        autoIndex: input.auto_index,
                        entryIds: updated.map((r) => r.id),
                        errorPrefix: 'Entry',
                        doneMessage: 'Batch update complete',
                        shouldIndex: (id) => reindexIds.has(id),
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

                    const failedUpdateVectors = indexStatuses.filter((s) => s === 'failed').length
                    return {
                        success: true,
                        count: updated.length,
                        updated,
                        notFound,
                        indexStatuses,
                        ...(failedUpdateVectors > 0
                            ? { warning: `Vector indexing failed for ${String(failedUpdateVectors)} entry(ies).` }
                            : {}),
                    }
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
                    return await executeBatchDeleteEntries(context, input)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
