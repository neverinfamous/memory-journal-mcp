import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RebuildVectorIndexOutputSchema,
    AddToVectorIndexOutputSchema,
} from './schemas.js'
import { relaxedNumber } from '../schemas.js'

export function getVectorTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, progress } = context;
    return [
        {
            name: 'rebuild_vector_index',
            title: 'Rebuild Vector Index',
            description: 'Rebuild the semantic search vector index from all existing entries',
            group: 'admin',
            inputSchema: z.object({}).strict(),
            outputSchema: RebuildVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return {
                            success: false,
                            entriesIndexed: 0,
                            error: 'Vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
                        }
                    }
                    const { indexed, failed, firstError, partial, errors } =
                        await vectorManager.rebuildIndex(db, progress)
                    
                    if (errors.length > 0) {
                        const mcpErrors = errors.map(e => new Error(`Entry ${e.entryId} failed: ${e.error.message}`));
                        throw new AggregateError(mcpErrors, `Vector index rebuild partially failed: ${failed} entries failed to index.`);
                    }

                    const success = indexed > 0 || failed === 0
                    return {
                        success,
                        partial,
                        entriesIndexed: indexed,
                        ...(failed > 0 ? { failedEntries: failed } : {}),
                        ...(!success
                            ? { error: firstError ?? 'All entries failed to generate embeddings' }
                            : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'add_to_vector_index',
            title: 'Add Entry to Vector Index',
            description: 'Add a specific entry to the semantic search vector index',
            group: 'admin',
            inputSchema: z.object({ entry_id: relaxedNumber().optional() }),
            outputSchema: AddToVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { entry_id } = z.object({ entry_id: z.number() }).parse(params)
                    if (!vectorManager) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: 'Vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
                        }
                    }
                    const entry = db.getEntryById(entry_id)
                    if (!entry) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and try again',
                            recoverable: true,
                        }
                    }
                    const result = await vectorManager.addEntry(entry_id, entry.content)
                    return {
                        success: result.success,
                        entryId: entry_id,
                        ...(result.success
                            ? {}
                            : { error: result.error ?? 'Failed to generate or store embedding' }),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
