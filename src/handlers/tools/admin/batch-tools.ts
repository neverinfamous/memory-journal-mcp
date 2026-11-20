import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../batch-indexing.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { assertCanonicalFallbackToolAllowed } from '../team/helpers.js'
import { prepareBatchCreateInputs, shareBatchEntriesWithTeam } from './batch-create-helpers.js'
import { executeBatchUpdateEntries } from './batch-update-helpers.js'
import { executeBatchDeleteEntries } from './batch-vector-helpers.js'
import {
    BatchCreateEntriesSchema,
    BatchCreateEntriesSchemaMcp,
    BatchCreateEntriesOutputSchema,
    BatchUpdateEntriesSchemaMcp,
    BatchUpdateEntriesOutputSchema,
    BatchDeleteEntriesSchema,
    BatchDeleteEntriesSchemaMcp,
    BatchDeleteEntriesOutputSchema,
} from './schemas.js'

async function linkBatchEntries(
    context: ToolContext,
    input: ReturnType<typeof BatchCreateEntriesSchema.parse>,
    prepared: Awaited<ReturnType<typeof prepareBatchCreateInputs>>,
    results: ReturnType<ToolContext['db']['createEntries']>['created'],
    createdIndexes: number[]
): Promise<string[]> {
    const { db } = context
    // [INVARIANT] M2: map prepared index -> created personal ID so team mirrors carry origin_personal_id.
    const personalIdsByIndex = new Map<number, number>()
    results.forEach((created, i) => {
        const sourceIndex = createdIndexes[i]
        if (sourceIndex !== undefined) personalIdsByIndex.set(sourceIndex, created.id)
    })
    const relationshipWarnings = [
        ...(await shareBatchEntriesWithTeam(context, prepared, createdIndexes, personalIdsByIndex))
            .warnings,
    ]
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
                    prepared[sourceIndex]?.input.workspaceId,
                    prepared[sourceIndex]?.input.projectNumber
                )
            )
        }
    }
    return relationshipWarnings
}

async function executeBatchCreateEntries(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown>> {
    const { db, vectorManager, progress } = context
    const input = BatchCreateEntriesSchema.parse(params)
    if (
        input.entries.some(
            (e) =>
                (e.relationships !== undefined && e.relationships.length > 0) ||
                e.auto_link === true
        )
    ) {
        assertCanonicalFallbackToolAllowed('link_entries', 'relationships', context, false)
    }
    await sendProgress(progress, 0, 2, 'Creating entries...')

    const prepared = await prepareBatchCreateInputs(
        input.entries,
        input.project_number,
        context,
        input.workspace_id
    )
    const { created: results, errors } = db.createEntries(prepared.map((p) => p.input))

    const failedIndexes = new Set(errors.map((e) => e.index))
    const createdIndexes = input.entries.map((_, i) => i).filter((i) => !failedIndexes.has(i))
    const relationshipWarnings = await linkBatchEntries(
        context,
        input,
        prepared,
        results,
        createdIndexes
    )

    await sendProgress(progress, 1, 2, `Created ${String(results.length)} entries...`)

    const { indexStatuses, indexErrors } = await indexBatchEntries({
        progress,
        vectorManager,
        db,
        autoIndex: input.auto_index,
        entryIds: results.map((r) => r.id),
        entries: results,
        errorPrefix: 'Entry',
        doneMessage: 'Batch create complete',
        workspaceByEntryId: collectIndexWorkspaces(results),
    })

    const allErrors = [
        ...errors.map((e) => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
        ...indexErrors,
    ]
    if (allErrors.length > 0) {
        throw new AggregateError(
            allErrors,
            `Batch create partially failed: ${allErrors.length} operations failed`
        )
    }

    const failedVectorCount = indexStatuses.filter((s) => s === 'failed').length
    const topWarnings = [
        ...(failedVectorCount > 0
            ? [`Vector indexing failed for ${String(failedVectorCount)} entry(ies).`]
            : []),
        ...relationshipWarnings,
    ]
    return {
        success: true,
        count: results.length,
        entries: results,
        indexStatuses,
        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
        ...(topWarnings.length > 0 ? { warning: topWarnings.join('; ') } : {}),
    }
}

export function getBatchTools(context: ToolContext): ToolDefinition[] {
    return [

        {
            name: 'batch_create_entries',
            title: 'Batch Create Entries',
            description: 'Create multiple journal entries at once. Max 50 per batch. Use this for imports or bulk creation. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. Extract this by querying memory://agent-context/<repo>. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use relationships (or related_to) to anchor entries to previous context.',
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
                    return await executeBatchCreateEntries(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'batch_update_entries',
            title: 'Batch Update Entries',
            description: 'Update multiple existing journal entries in a single transaction. Max 50 per batch. REQUIRED: You MUST include project_number. Extract this by querying memory://agent-context/<repo>.',
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
                    return await executeBatchUpdateEntries(params, context)
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
