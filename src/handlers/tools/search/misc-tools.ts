import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { VectorStatsOutputSchema } from './schemas.js'
import { EntriesListOutputSchema, relaxedNumber } from '../schemas.js'

export function getMiscSearchTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context;
    return [
        {
            name: 'get_vector_index_stats',
            title: 'Get Vector Index Stats',
            description: 'Get statistics about the semantic search vector index',
            group: 'search',
            inputSchema: z.object({}).strict(),
            outputSchema: VectorStatsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return {
                            success: false,
                            available: false,
                            error: 'Vector search not available',
                            code: 'CONFIGURATION_ERROR',
                            category: 'configuration',
                            suggestion:
                                'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                            recoverable: false,
                        }
                    }
                    const stats = vectorManager.getStats()
                    return { success: true, available: true, ...stats }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'list_deleted_entries',
            title: 'List Deleted Entries',
            description: 'List recently soft-deleted entries that can be restored',
            group: 'search',
            inputSchema: z.object({
                limit: relaxedNumber().optional().default(50),
                offset: relaxedNumber().optional().default(0),
            }).strict(),
            outputSchema: EntriesListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { limit, offset } = z.object({ limit: z.number().optional().default(50), offset: z.number().optional().default(0) }).strict().parse(params)
                    const result = db.getDeletedEntries({ limit, offset })
                    return {
                        success: true,
                        entries: result.entries.map((e) => ({ ...e, source: 'personal' as const })),
                        count: result.count,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ];
}
