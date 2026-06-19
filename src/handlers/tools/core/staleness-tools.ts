import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

export const MarkAnchorsStaleSchema = z.object({
    updates: z.array(z.object({
        id: z.number(),
        status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable'])
    }))
})

export function getStalenessTools(context: ToolContext): ToolDefinition[] {
    const { db } = context

    return [
        {
            name: 'mark_anchors_stale',
            title: 'Mark Anchors Stale',
            description: 'Update the status of multiple anchors (e.g. to stale or invalidated) based on validation rules or git history checks.',
            group: 'core',
            inputSchema: MarkAnchorsStaleSchema,
            outputSchema: z.object({ success: z.boolean(), updated_count: z.number() }).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = MarkAnchorsStaleSchema.parse(params)
                    
                    db.executeInTransaction(() => {
                        for (const update of input.updates) {
                            db.updateAnchorStatus(update.id, update.status)
                        }
                    })

                    return { success: true, updated_count: input.updates.length }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        }
    ]
}
