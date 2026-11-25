import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { coerceIntString, MAX_QUERY_LIMIT, relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { coerceAnchorStatusAlias } from '../schemas/hallucination-healer-fields.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import { isRecord } from '../../../utils/type-guards.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'

export { prefetchBatchCommitFiles, resolveEntryAnchors } from './entry-anchors.js'

function parsePositiveAnchorId(rawVal: unknown): number | undefined {
    if (typeof rawVal === 'number') {
        return Number.isSafeInteger(rawVal) && rawVal > 0 ? rawVal : undefined
    }
    if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : undefined
        }
    }
    return undefined
}

function normalizeAnchorUpdateItem(rawItem: unknown): unknown {
    if (!isRecord(rawItem)) {
        return rawItem
    }
    const item: Record<string, unknown> = { ...rawItem }
    // [INVARIANT] M2: only anchor-ID aliases map to entry_anchors.id. entry_id/entryId are
    // journal entry IDs and are left unmapped so the schema rejects them (missing `id`).
    const idKeys = ['id', 'anchor_id', 'anchorId'] as const
    const definedKeys = idKeys.filter((k) => item[k] !== undefined)
    const parsedNums = definedKeys.map((k) => ({ k, num: parsePositiveAnchorId(item[k]) }))
    const allValid = parsedNums.length > 0 && parsedNums.every((p) => p.num !== undefined)
    const noConflict =
        allValid && parsedNums.every((p) => p.num === parsedNums[0]?.num)
    if (noConflict && parsedNums[0]?.num !== undefined) {
        item['id'] = parsedNums[0].num
        delete item['anchor_id']
        delete item['anchorId']
    } else if (item['id'] === undefined && definedKeys.length === 1 && definedKeys[0] !== 'id') {
        const onlyKey = definedKeys[0]
        if (onlyKey !== undefined) {
            item['id'] = item[onlyKey]
            delete item['anchor_id']
            delete item['anchorId']
        }
    }
    const mappedStatus = coerceAnchorStatusAlias(item['status'])
    if (mappedStatus !== undefined) {
        item['status'] = mappedStatus
    }
    return item
}

function preprocessMarkAnchorsStale(val: unknown): unknown {
    if (!isRecord(val)) return val
    const obj: Record<string, unknown> = { ...val }
    if (obj['updates'] === undefined && Array.isArray(obj['anchors'])) {
        obj['updates'] = obj['anchors']
        delete obj['anchors']
    }
    if (Array.isArray(obj['updates'])) {
        obj['updates'] = obj['updates'].map(normalizeAnchorUpdateItem)
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
                        id: z.preprocess(coerceIntString, z.number().int().positive()),
                        status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable']),
                    }).strict()
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
