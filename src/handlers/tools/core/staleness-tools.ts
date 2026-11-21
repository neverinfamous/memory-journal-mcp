import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { MAX_QUERY_LIMIT, relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { coerceAnchorStatusAlias } from '../schemas/hallucination-healer-fields.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'

export { prefetchBatchCommitFiles, resolveEntryAnchors } from './entry-anchors.js'

function preprocessMarkAnchorsStale(val: unknown): unknown {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
    const obj = { ...(val as Record<string, unknown>) }
    if (obj['updates'] === undefined && Array.isArray(obj['anchors'])) {
        obj['updates'] = obj['anchors']
        delete obj['anchors']
    }
    if (Array.isArray(obj['updates'])) {
        obj['updates'] = obj['updates'].map((rawItem: unknown) => {
            if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
                return rawItem
            }
            const item = { ...(rawItem as Record<string, unknown>) }
            // [INVARIANT] M2: only anchor-ID aliases map to entry_anchors.id. entry_id/entryId are
            // journal entry IDs and are left unmapped so the schema rejects them (missing `id`).
            const rawId = item['id'] ?? item['anchor_id'] ?? item['anchorId']
            if (rawId !== undefined) {
                if (typeof rawId === 'string') {
                    const trimmedId = rawId.trim()
                    if (/^[1-9]\d*$/.test(trimmedId)) {
                        const parsed = Number(trimmedId)
                        if (Number.isSafeInteger(parsed) && String(parsed) === trimmedId) {
                            item['id'] = parsed
                        }
                    }
                } else if (typeof rawId === 'number' && !Number.isNaN(rawId)) {
                    item['id'] = rawId
                }
            }
            delete item['anchor_id']
            delete item['anchorId']
            const mappedStatus = coerceAnchorStatusAlias(item['status'])
            if (mappedStatus !== undefined) {
                item['status'] = mappedStatus
            }
            return item
        })
    }
    return obj
}

export const MarkAnchorsStaleSchema = z.preprocess(
    preprocessMarkAnchorsStale,
    z
        .object({
            updates: z
                .array(
                    z.object({
                        id: z.number(),
                        status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable']),
                    })
                )
                .min(1)
                .max(MAX_QUERY_LIMIT),
            workspace_id: z.string().max(255).optional(),
            project_number: StrictProjectNumberSchema.optional(),
        })
        .strict()
)

export const MarkAnchorsStaleSchemaMcp = z.preprocess(
    preprocessMarkAnchorsStale,
    z.object({
        updates: z
            .array(
                z.object({
                    id: relaxedNumber(),
                    status: z.string(),
                })
            )
            .optional(),
        workspace_id: z.string().optional(),
        project_number: relaxedNumber().optional(),
    })
)

const MarkAnchorsStaleOutputSchema = z
    .object({
        success: z.boolean().optional(),
        updated_count: z.number().optional(),
        not_found_ids: z.array(z.number()).optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export function getStalenessTools(context: ToolContext): ToolDefinition[] {
    const { db } = context

    return [
        {
            name: 'mark_anchors_stale',
            title: 'Mark Anchors Stale',
            description:
                'Update the status of multiple anchors (e.g. to stale or invalidated) based on validation rules or git history checks.',
            group: 'core',
            inputSchema: MarkAnchorsStaleSchemaMcp,
            outputSchema: MarkAnchorsStaleOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = MarkAnchorsStaleSchema.parse(params)
                    const wsId = resolveWriteWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )
                    const scopedProject = alignedProjectFilter(
                        wsId,
                        input.project_number,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )

                    let updatedCount = 0
                    const missingIds: number[] = []
                    db.executeInTransaction(() => {
                        for (const update of input.updates) {
                            if (db.updateAnchorStatus(update.id, update.status, wsId, scopedProject)) {
                                updatedCount++
                            } else {
                                missingIds.push(update.id)
                            }
                        }
                    })

                    if (updatedCount === 0) {
                        return {
                            success: false,
                            error: 'No anchors were updated',
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            recoverable: true,
                            updated_count: 0,
                            ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                        }
                    }
                    return {
                        success: true,
                        updated_count: updatedCount,
                        ...(missingIds.length > 0 ? { not_found_ids: missingIds } : {}),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        }
    ]
}
