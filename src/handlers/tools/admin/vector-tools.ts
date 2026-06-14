import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RebuildVectorIndexOutputSchema,
    AddToVectorIndexOutputSchema,
} from './schemas.js'
import { relaxedNumber } from '../schemas.js'
import { logger } from '../../../utils/logger.js'

export function getVectorTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, progress } = context;
    return [
        {
            name: 'rebuild_vector_index',
            title: 'Rebuild Vector Index',
            description: 'Rebuild the semantic search vector index from all existing entries',
            group: 'admin',
            inputSchema: z.object({project_number: z.number().int().optional()}).strict(),
            outputSchema: RebuildVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    z.object({project_number: z.number().int().optional()}).strict().parse(params)
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
                    const { success, indexed, failed, firstError } =
                        await vectorManager.rebuildIndex(progress)
                    
                    if (!success && firstError) {
                        logger.warning(`Vector index rebuild had errors: ${firstError}`)
                    }

                    return {
                        success,
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
            inputSchema: z.preprocess(
                (val: unknown) => {
                    if (typeof val === 'object' && val !== null) {
                        const obj = val as Record<string, unknown>;
                        if ('id' in obj && !('entry_id' in obj)) {
                            return { ...obj, entry_id: obj['id'] };
                        }
                    }
                    return val;
                },
                z.object({ entry_id: relaxedNumber().optional() }).strict()
            ),
            outputSchema: AddToVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { entry_id } = z.preprocess(
                        (val: unknown) => {
                            if (typeof val === 'object' && val !== null) {
                                const obj = val as Record<string, unknown>;
                                if ('id' in obj && !('entry_id' in obj)) {
                                    return { ...obj, entry_id: obj['id'] };
                                }
                            }
                            return val;
                        },
                        z.object({ entry_id: z.number() }).strict()
                    ).parse(params)
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
                    try {
                        await vectorManager.addEntry(entry)
                        return {
                            success: true,
                            entryId: entry_id,
                        }
                    } catch (err) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: err instanceof Error ? err.message : 'Failed to generate or store embedding'
                        }
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
