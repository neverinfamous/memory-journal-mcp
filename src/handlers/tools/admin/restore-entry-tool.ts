import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { autoIndexEntry } from '../../../utils/vector-index-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { coerceIntString, relaxedNumber } from '../schemas.js'

/**
 * [INVARIANT] When a caller supplies project_number, the target entry must belong to that
 * project regardless of workspace_id (H4). Missing entries are treated as mismatches.
 */
export function projectOwnershipMismatch(
    projectNumber: number | undefined,
    entryProject: number | null | undefined
): boolean {
    return projectNumber !== undefined && entryProject !== projectNumber
}

function normalizeRestoreEntryParams(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj = { ...(val as Record<string, unknown>) }
    if ('id' in obj) {
        if (!('entry_id' in obj)) {
            obj['entry_id'] = obj['id']
        }
        Reflect.deleteProperty(obj, 'id')
    }
    return obj
}

const RestoreEntryStrictSchema = z.preprocess(
    normalizeRestoreEntryParams,
    z
        .object({
            entry_id: z.preprocess(coerceIntString, z.number().int().positive()),
            project_number: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            workspace_id: z.string().max(255).optional(),
        })
        .strict()
)

/** Build the `restore_entry` admin tool (extracted from `admin/core-tools.ts`, Appendix A). */
export function createRestoreEntryTool(context: ToolContext): ToolDefinition {
    const { db, vectorManager } = context

    return {
        name: 'restore_entry',
        title: 'Restore Entry',
        description: 'Restore a soft-deleted journal entry.',
        group: 'admin',
        inputSchema: z.preprocess(
            (val: unknown) => {
                if (typeof val === 'object' && val !== null) {
                    const obj = val as Record<string, unknown>
                    if ('id' in obj && !('entry_id' in obj)) {
                        return { ...obj, entry_id: obj['id'] }
                    }
                }
                return val
            },
            z
                .object({
                    entry_id: relaxedNumber().optional(),
                    project_number: relaxedNumber().optional(),
                    workspace_id: z.string().optional(),
                })
                .loose()
        ),
        outputSchema: z
            .object({
                success: z.boolean().optional(),
                entryId: z.number().optional(),
                indexStatus: z.string().optional(),
                warning: z.string().optional(),
                error: z.string().optional(),
            })
            .extend(ErrorFieldsMixin.shape),
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
        handler: async (params: unknown) => {
            try {
                const { entry_id, project_number, workspace_id } =
                    RestoreEntryStrictSchema.parse(params)
                let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                if (workspace_id === undefined && project_number === undefined) {
                    const existingByPk = db.getEntryByIdIncludeDeleted(entry_id, '*')
                    if (existingByPk?.workspaceId !== undefined) {
                        wsId = existingByPk.workspaceId
                    }
                }
                if (project_number !== undefined) {
                    const scoped = db.getEntryByIdIncludeDeleted(entry_id, '*')
                    if (projectOwnershipMismatch(project_number, scoped?.projectNumber)) {
                        return {
                            success: false,
                            entryId: entry_id,
                            error: `Entry ${String(entry_id)} not found or not deleted`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the entry ID and project number',
                            recoverable: true,
                        }
                    }
                }
                const success = db.restoreEntry(entry_id, wsId)
                if (!success) {
                    return {
                        success: false,
                        entryId: entry_id,
                        error: `Entry ${String(entry_id)} not found or not deleted`,
                        code: 'RESOURCE_NOT_FOUND',
                        category: 'resource',
                        suggestion: 'Verify the entry ID',
                        recoverable: true,
                    }
                }
                // [SIDE-EFFECT] M4: soft-delete removed the vector; re-index on restore.
                const restored = db.getEntryById(entry_id, wsId)
                const indexStatus = await autoIndexEntry(
                    vectorManager,
                    db,
                    restored ?? entry_id,
                    restored?.workspaceId ?? wsId
                )
                return {
                    success,
                    entryId: entry_id,
                    indexStatus,
                    ...(indexStatus === 'failed'
                        ? { warning: 'Entry restored, but vector re-indexing failed.' }
                        : {}),
                }
            } catch (err) {
                return formatHandlerError(err)
            }
        },
    }
}
