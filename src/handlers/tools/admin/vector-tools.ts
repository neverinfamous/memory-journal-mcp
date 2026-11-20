import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RebuildVectorIndexOutputSchema,
    AddToVectorIndexOutputSchema,
} from './schemas.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { logger } from '../../../utils/logger.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    alignedProjectFilter,
} from '../../../utils/write-scope.js'

const preprocessVectorEntryId = (val: unknown): unknown => {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) }
        if ('id' in obj && !('entry_id' in obj)) {
            obj['entry_id'] = obj['id']
            delete obj['id']
            return obj
        }
    }
    return val
}

export const AddToVectorIndexSchemaMcp = z.preprocess(
    preprocessVectorEntryId,
    z
        .object({
            entry_id: relaxedNumber().optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
)

export const AddToVectorIndexSchema = z.preprocess(
    preprocessVectorEntryId,
    z
        .object({
            entry_id: z.number().int().positive(),
            project_number: z.number().int().positive().optional(),
            workspace_id: z.string().max(255).optional(),
        })
        .strict()
)

export function getVectorTools(context: ToolContext): ToolDefinition[] {
    const { db, vectorManager } = context;
    return [
        {
            name: 'rebuild_vector_index',
            title: 'Rebuild Vector Index',
            description: '[REQUIRES ADMIN SCOPE] Rebuild the semantic search vector index from all existing entries',
            group: 'admin',
            inputSchema: z
                .object({
                    project_number: relaxedNumber().optional(),
                    workspace_id: z.string().optional(),
                    session_id: z.string().optional(),
                })
                .strict(),
            outputSchema: RebuildVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const parsed = z
                        .object({
                            project_number: StrictProjectNumberSchema.optional(),
                            workspace_id: z.string().max(255).optional(),
                            session_id: z.string().optional(),
                        })
                        .strict()
                        .parse(params)
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
                    const isWildcard = parsed.workspace_id?.trim() === '*'
                    const registry = activeProjectRegistry(context.config?.projectRegistry)
                    const wsId = isWildcard
                        ? '*'
                        : resolveWorkspaceId(parsed.workspace_id, parsed.project_number, context.config)
                    const projectNumber = alignedProjectFilter(wsId, parsed.project_number, registry)
                    const rebuildOpts: { projectNumber?: number; workspaceId?: string } = {
                        workspaceId: wsId,
                        ...(projectNumber !== undefined ? { projectNumber } : {}),
                    }
                    const { success, indexed, failed, firstError } =
                        await vectorManager.rebuildIndex(context.progress, rebuildOpts)

                    if (!success && firstError) {
                        logger.warning(`Vector index rebuild had errors: ${firstError}`)
                    }

                    const isPartial = failed > 0 && indexed > 0
                    const warningMsg = isPartial
                        ? (firstError ?? `${String(failed)} entries failed to generate embeddings`)
                        : undefined

                    return {
                        success,
                        entriesIndexed: indexed,
                        ...(isPartial ? { partial: true, warning: warningMsg } : {}),
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
            inputSchema: AddToVectorIndexSchemaMcp,
            outputSchema: AddToVectorIndexOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const { entry_id, project_number, workspace_id } =
                        AddToVectorIndexSchema.parse(params)
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
                    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    let entry = db.getEntryById(entry_id, wsId)
                    if (
                        !entry &&
                        workspace_id === undefined &&
                        project_number === undefined
                    ) {
                        entry = db.getEntryById(entry_id, '*')
                    }
                    if (!entry || (project_number !== undefined && entry.projectNumber !== project_number)) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Entry ${String(entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and project number, then try again',
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
