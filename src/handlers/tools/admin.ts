/**
 * Admin Tool Group - 5 tools
 *
 * Tools: update_entry, delete_entry, merge_tags, rebuild_vector_index, add_to_vector_index
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { ENTRY_TYPES, EntryOutputSchema } from './schemas.js'

// ============================================================================
// Input Schemas
// ============================================================================

const UpdateEntrySchema = z.object({
    entry_id: z.number(),
    content: z.string().optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    is_personal: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
})

const DeleteEntrySchema = z.object({
    entry_id: z.number(),
    permanent: z.boolean().optional().default(false),
})

// ============================================================================
// Output Schemas
// ============================================================================

const UpdateEntryOutputSchema = z.object({
    success: z.boolean().optional(),
    entry: EntryOutputSchema.optional(),
    error: z.string().optional(),
})

const DeleteEntryOutputSchema = z.object({
    success: z.boolean(),
    entryId: z.number(),
    permanent: z.boolean(),
    error: z.string().optional(),
})

const MergeTagsOutputSchema = z.object({
    success: z.boolean(),
    sourceTag: z.string(),
    targetTag: z.string(),
    entriesUpdated: z.number(),
    sourceDeleted: z.boolean(),
    message: z.string(),
    error: z.string().optional(),
})

const RebuildVectorIndexOutputSchema = z.object({
    success: z.boolean(),
    entriesIndexed: z.number(),
    error: z.string().optional(),
})

const AddToVectorIndexOutputSchema = z.object({
    success: z.boolean(),
    entryId: z.number(),
    error: z.string().optional(),
})

// ============================================================================
// Tool Definitions
// ============================================================================

export function getAdminTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager, progress } = context
    return [
        {
            name: 'update_entry',
            title: 'Update Entry',
            description: 'Update an existing journal entry',
            group: 'admin',
            inputSchema: UpdateEntrySchema,
            outputSchema: UpdateEntryOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const input = UpdateEntrySchema.parse(params)
                    const entry = db.updateEntry(input.entry_id, {
                        content: input.content,
                        entryType: input.entry_type,
                        isPersonal: input.is_personal,
                        tags: input.tags,
                    })
                    if (!entry) {
                        return {
                            success: false,
                            error: `Entry ${String(input.entry_id)} not found`,
                        }
                    }

                    // Re-index if content changed
                    if (input.content && vectorManager) {
                        vectorManager.addEntry(entry.id, entry.content).catch(() => {
                            // Non-critical failure, entry already updated in DB
                        })
                    }

                    return { success: true, entry }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'delete_entry',
            title: 'Delete Entry',
            description: 'Delete a journal entry (soft delete with timestamp)',
            group: 'admin',
            inputSchema: DeleteEntrySchema,
            outputSchema: DeleteEntryOutputSchema,
            annotations: { readOnlyHint: false, destructiveHint: true },
            handler: (params: unknown) => {
                try {
                    const { entry_id, permanent } = DeleteEntrySchema.parse(params)
                    const success = db.deleteEntry(entry_id, permanent)

                    if (!success) {
                        return {
                            success: false,
                            entryId: entry_id,
                            permanent,
                            error: `Entry ${String(entry_id)} not found`,
                        }
                    }

                    // Remove from vector index (non-critical if fails)
                    if (vectorManager) {
                        vectorManager.removeEntry(entry_id).catch(() => {
                            // Non-critical failure, entry already deleted from DB
                        })
                    }

                    return { success, entryId: entry_id, permanent }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'merge_tags',
            title: 'Merge Tags',
            description:
                'Merge one tag into another to consolidate similar tags (e.g., merge "phase-2" into "phase2"). The source tag is deleted after merge.',
            group: 'admin',
            inputSchema: z.object({
                source_tag: z.string().min(1).describe('Tag to merge from (will be deleted)'),
                target_tag: z
                    .string()
                    .min(1)
                    .describe('Tag to merge into (will be created if not exists)'),
            }),
            outputSchema: MergeTagsOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const { source_tag, target_tag } = z
                        .object({
                            source_tag: z.string().min(1),
                            target_tag: z.string().min(1),
                        })
                        .parse(params)

                    if (source_tag === target_tag) {
                        return {
                            success: false,
                            sourceTag: source_tag,
                            targetTag: target_tag,
                            entriesUpdated: 0,
                            sourceDeleted: false,
                            message: 'Source and target tags cannot be the same',
                            error: 'Source and target tags must be different',
                        }
                    }

                    const result = db.mergeTags(source_tag, target_tag)
                    return {
                        success: true,
                        sourceTag: source_tag,
                        targetTag: target_tag,
                        entriesUpdated: result.entriesUpdated,
                        sourceDeleted: result.sourceDeleted,
                        message: `Merged "${source_tag}" into "${target_tag}". Updated ${String(result.entriesUpdated)} entries.`,
                    }
                } catch (error) {
                    // Zod or domain error
                    if (error instanceof z.ZodError) {
                        return formatHandlerError(error)
                    }
                    // Domain error from db.mergeTags — try to preserve schema shape
                    try {
                        const parsed = z
                            .object({ source_tag: z.string(), target_tag: z.string() })
                            .parse(params)
                        return {
                            success: false,
                            sourceTag: parsed.source_tag,
                            targetTag: parsed.target_tag,
                            entriesUpdated: 0,
                            sourceDeleted: false,
                            message: 'Tag merge failed',
                            error: error instanceof Error ? error.message : 'Unknown error',
                        }
                    } catch {
                        return formatHandlerError(error)
                    }
                }
            },
        },
        {
            name: 'rebuild_vector_index',
            title: 'Rebuild Vector Index',
            description: 'Rebuild the semantic search vector index from all existing entries',
            group: 'admin',
            inputSchema: z.object({}),
            outputSchema: RebuildVectorIndexOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: async (_params: unknown) => {
                try {
                    if (!vectorManager) {
                        return {
                            success: false,
                            entriesIndexed: 0,
                            error: 'Vector search not available',
                        }
                    }
                    const indexed = await vectorManager.rebuildIndex(db, progress)
                    return { success: true, entriesIndexed: indexed }
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
            inputSchema: z.object({ entry_id: z.number() }),
            outputSchema: AddToVectorIndexOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true },
            handler: async (params: unknown) => {
                try {
                    const { entry_id } = z.object({ entry_id: z.number() }).parse(params)
                    if (!vectorManager) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: 'Vector search not available',
                        }
                    }
                    const entry = db.getEntryById(entry_id)
                    if (!entry) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Entry ${String(entry_id)} not found`,
                        }
                    }
                    const success = await vectorManager.addEntry(entry_id, entry.content)
                    return { success, entryId: entry_id }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
