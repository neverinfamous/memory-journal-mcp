/**
 * Relationship tool input/output schemas (link_entries, visualize_relationships).
 */

import { z } from 'zod'
import { RelationshipOutputSchema, relaxedNumber, StrictProjectNumberSchema } from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const LinkEntriesSchema = z.object({
    from_entry_id: z.number(),
    to_entry_id: z.number(),
    relationship_type: z
        .enum([
            'evolves_from',
            'references',
            'implements',
            'clarifies',
            'response_to',
            'blocked_by',
            'resolved',
            'caused',
        ])
        .optional()
        .default('references'),
    description: z.string().optional(),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
})

export const LinkEntriesSchemaMcp = z
    .object({
        from_entry_id: relaxedNumber().optional().describe('ID of the source entry. Anti-Hallucination Hint: use from_entry_id, not sourceId'),
        to_entry_id: relaxedNumber().optional().describe('ID of the target entry. Anti-Hallucination Hint: use to_entry_id, not targetId'),
        from: relaxedNumber().optional(),
        to: relaxedNumber().optional(),
        from_id: relaxedNumber().optional(),
        to_id: relaxedNumber().optional(),
        source_id: relaxedNumber().optional(),
        target_id: relaxedNumber().optional(),
        project_number: relaxedNumber().optional(),
        workspace_id: z.string().optional(),
        relationship_type: z.string().optional(),
        type: z.string().optional(),
        rel: z.string().optional(),
        description: z.string().optional(),
        message: z.string().optional(),
        text: z.string().optional(),
    })
    .transform((data) => {
        const rawRel = data.type ?? data.rel ?? data.relationship_type ?? 'references'
        const normalizedRel =
            rawRel === 'resolves'
                ? 'resolved'
                : rawRel === 'relates_to'
                  ? 'references'
                  : rawRel === 'depends_on'
                    ? 'blocked_by'
                    : rawRel
        return {
            from_entry_id: data.from_entry_id ?? data.from_id ?? data.from ?? data.source_id,
            to_entry_id: data.to_entry_id ?? data.to_id ?? data.to ?? data.target_id,
            relationship_type: normalizedRel,
            description: data.description ?? data.message ?? data.text,
            project_number: data.project_number,
            workspace_id: data.workspace_id,
        }
    })

export const VisualizeInputSchema = z.object({
    entry_id: z
        .number()
        .optional()
        .describe('Specific entry ID to visualize (shows connected entries)'),
    tags: z.array(z.string()).optional().describe('Filter entries by tags'),
    relationship_type: z
        .enum([
            'evolves_from',
            'references',
            'implements',
            'clarifies',
            'response_to',
            'blocked_by',
            'resolved',
            'caused',
        ])
        .optional()
        .describe('Filter to show only this relationship type'),
    depth: z.number().min(1).max(3).optional().default(2).describe('Relationship traversal depth'),
    limit: z.number().max(500).optional().default(20).describe('Maximum entries to include'),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
export const VisualizeInputSchemaMcp = z.object({
    entry_id: relaxedNumber()
        .optional()
        .describe('Specific entry ID to visualize (shows connected entries)'),
    id: relaxedNumber().optional(),
    tags: z.array(z.string()).optional().describe('Filter entries by tags'),
    q: z.string().optional(),
    text: z.string().optional(),
    message: z.string().optional(),
    description: z.string().optional(),
    relationship_type: z
        .string()
        .optional()
        .describe('Filter to show only this relationship type (e.g., blocked_by, implements)'),
    type: z.string().optional(),
    rel: z.string().optional(),
    mode: z.string().optional(),
    depth: relaxedNumber().optional().default(2).describe('Relationship traversal depth'),
    path: relaxedNumber().optional(),
    limit: relaxedNumber()
        .optional()
        .default(20)
        .describe(
            'Maximum entries to include (1-500, default: 20). Anti-Hallucination Hint: Values > 500 will be auto-clamped to 500.'
        ),
    keep: relaxedNumber().optional(),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional(),
}).transform(data => {
    // Collect all string queries into an array of tags
    let extractedTags = data.tags;
    if (!extractedTags) {
        const queryVal = data.q ?? data.text ?? data.message ?? data.description;
        if (queryVal) extractedTags = [queryVal];
    }
    const rawLimit = data.keep ?? data.limit
    const numLimit = rawLimit !== undefined ? Number(rawLimit) : undefined
    const clampedLimit = numLimit !== undefined && !Number.isNaN(numLimit) ? Math.min(Math.max(1, numLimit), 500) : 20
    return {
        ...data,
        entry_id: data.entry_id ?? data.id,
        relationship_type: data.type ?? data.rel ?? data.mode ?? data.relationship_type,
        depth: data.path ?? data.depth,
        limit: clampedLimit,
        tags: extractedTags,
    };
})

// ============================================================================
// Output Schemas
// ============================================================================

export const LinkEntriesOutputSchema = z
    .object({
        success: z.boolean().optional(),
        relationship: RelationshipOutputSchema.optional(),
        duplicate: z.boolean().optional().describe('True if relationship already existed'),
        message: z.string().optional().describe('Additional context about the operation'),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const VisualizationNodeSchema = z.object({
    id: z.union([z.number(), z.string()]),
    label: z.string(),
    group: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})

const VisualizationEdgeSchema = z.object({
    from: z.union([z.number(), z.string()]),
    to: z.union([z.number(), z.string()]),
    type: z.string(),
    label: z.string().optional(),
})

export const VisualizationOutputSchema = z
    .object({
        entry_count: z.number().optional(),
        relationship_count: z.number().optional(),
        root_entry: z.number().nullable().optional(),
        depth: z.number().optional(),
        mermaid: z.string().nullable().optional(),
        message: z.string().optional(),
        nodes: z.array(VisualizationNodeSchema).optional(),
        edges: z.array(VisualizationEdgeSchema).optional(),
        legend: z
            .object({
                blue: z.string(),
                orange: z.string(),
                arrows: z.record(z.string(), z.string()),
            })
            .optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
