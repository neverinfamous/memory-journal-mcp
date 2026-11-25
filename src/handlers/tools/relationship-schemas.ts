/**
 * Relationship tool input/output schemas (link_entries, visualize_relationships).
 */

import { z } from 'zod'
import {
    RelationshipOutputSchema,
    relaxedNumber,
    StrictProjectNumberSchema,
    relationshipTypeEnumError,
} from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'

/** Coerce relaxedNumber string input to number; empty/whitespace-only/malformed/unsafe strings -> NaN (rejected downstream). */
function coerceRelaxed(v: number | string | undefined): number | undefined {
    if (v === undefined || typeof v === 'number') return v
    const trimmed = v.trim()
    if (trimmed === '') return Number.NaN
    if (!/^-?(?:0|[1-9]\d*)$/.test(trimmed)) return Number.NaN
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : Number.NaN
}

function coerceCanonicalId(v: number | string | undefined): number | undefined {
    if (v === undefined) return undefined
    if (typeof v === 'string' && v.trim() === '') return Number.NaN
    return parsePositiveProjectNumber(v) ?? Number.NaN
}

// ============================================================================
// Input Schemas
// ============================================================================

function normalizeLinkRelationship(raw: string): string {
    if (raw === 'resolves') return 'resolved'
    if (raw === 'relates_to') return 'references'
    if (raw === 'depends_on') return 'blocked_by'
    return raw
}

function addConflictIfDifferent(
    values: readonly unknown[],
    path: string[],
    message: string,
    ctx: z.RefinementCtx
): void {
    const defined = values.filter((v) => v !== undefined)
    if (defined.length > 1 && defined.some((v) => !Object.is(v, defined[0]))) {
        ctx.addIssue({ code: 'custom', path, message })
    }
}

/** Strict schema — used inside handler for structured Zod errors */
export const LinkEntriesSchema = z
    .object({
        from_entry_id: z.number().int().positive(),
        to_entry_id: z.number().int().positive(),
        relationship_type: z
            .enum(
                [
                    'evolves_from',
                    'references',
                    'implements',
                    'clarifies',
                    'response_to',
                    'blocked_by',
                    'resolved',
                    'caused',
                ],
                { error: relationshipTypeEnumError }
            )
            .optional()
            .default('references'),
        description: z.string().max(2000).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

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
        description: z.string().max(2000).optional(),
        message: z.string().optional(),
        text: z.string().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        addConflictIfDifferent(
            [data.from_entry_id, data.from_id, data.from, data.source_id].map(coerceCanonicalId),
            ['from_entry_id'],
            "Conflicting values provided for 'from_entry_id' and its aliases.",
            ctx
        )
        addConflictIfDifferent(
            [data.to_entry_id, data.to_id, data.to, data.target_id].map(coerceCanonicalId),
            ['to_entry_id'],
            "Conflicting values provided for 'to_entry_id' and its aliases.",
            ctx
        )
        addConflictIfDifferent(
            [data.relationship_type, data.type, data.rel].map((v) =>
                v !== undefined ? normalizeLinkRelationship(v) : undefined
            ),
            ['relationship_type'],
            "Conflicting values provided for 'relationship_type' and its aliases.",
            ctx
        )
        addConflictIfDifferent(
            [data.description, data.message, data.text],
            ['description'],
            "Conflicting values provided for 'description', 'message', or 'text'.",
            ctx
        )
    })
    .transform(({ from, to, from_id, to_id, source_id, target_id, type, rel, message, text, ...data }) => {
        const rawRel = data.relationship_type ?? type ?? rel ?? 'references'
        return {
            ...data,
            from_entry_id: coerceCanonicalId(data.from_entry_id ?? from_id ?? from ?? source_id),
            to_entry_id: coerceCanonicalId(data.to_entry_id ?? to_id ?? to ?? target_id),
            relationship_type: normalizeLinkRelationship(rawRel),
            description: data.description ?? message ?? text,
            project_number: coerceCanonicalId(data.project_number),
            workspace_id: data.workspace_id,
        }
    })

export const VisualizeInputSchema = z
    .object({
        entry_id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Specific entry ID to visualize (shows connected entries)'),
        tags: z.array(z.string().max(100)).max(100).optional().describe('Filter entries by tags'),
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
        depth: z.number().int().min(1).max(3).optional().default(2).describe('Relationship traversal depth'),
        limit: z.number().int().min(1).max(500).optional().default(20).describe('Maximum entries to include'),
        include_content: z
            .boolean()
            .optional()
            .default(false)
            .describe('Include full entry content in node metadata (default false: 120-char preview only, saves tokens)'),
        format: z
            .enum(['mermaid', 'edges', 'both'])
            .optional()
            .default('both')
            .describe("Output shape: 'mermaid' (diagram only), 'edges' (nodes + edges arrays, no diagram), or 'both' (default)"),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().max(255).optional(),
        source: z.enum(['personal', 'team']).optional(),
    })
    .strict()

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
export const VisualizeInputSchemaMcp = z
    .object({
        entry_id: relaxedNumber()
            .optional()
            .describe('Specific entry ID to visualize (shows connected entries)'),
        id: relaxedNumber().optional(),
        tags: z.array(z.string().max(100)).max(100).optional().describe('Filter entries by tags'),
        q: z.string().max(500).optional(),
        text: z.string().max(500).optional(),
        message: z.string().max(500).optional(),
        description: z.string().max(2000).optional(),
        relationship_type: z
            .string()
            .optional()
            .describe('Filter to show only this relationship type (e.g., blocked_by, implements)'),
        type: z.string().optional(),
        rel: z.string().optional(),
        depth: relaxedNumber().optional().describe('Relationship traversal depth'),
        path: relaxedNumber().optional(),
        limit: relaxedNumber()
            .optional()
            .describe(
                'Maximum entries to include (1-500, default: 20). Anti-Hallucination Hint: Values > 500 will be auto-clamped to 500.'
            ),
        keep: relaxedNumber().optional(),
        include_content: z
            .boolean()
            .optional()
            .describe('Include full entry content in node metadata (default false: 120-char preview only, saves tokens)'),
        format: z
            .string()
            .optional()
            .describe("Output shape: 'mermaid' (diagram only), 'edges' (nodes + edges arrays, no diagram), or 'both' (default)"),
        project_number: relaxedNumber().optional(),
        workspace_id: z.string().optional(),
        source: z.string().optional().describe("Store to visualize: 'personal' (default) or 'team'"),
    })
    .strict()
    .superRefine((data, ctx) => {
        addConflictIfDifferent(
            [coerceCanonicalId(data.entry_id), coerceCanonicalId(data.id)],
            ['entry_id'],
            "Conflicting values provided for 'entry_id' and 'id'.",
            ctx
        )
        addConflictIfDifferent(
            [data.relationship_type, data.type, data.rel],
            ['relationship_type'],
            "Conflicting values provided for 'relationship_type', 'type', or 'rel'.",
            ctx
        )
        addConflictIfDifferent(
            [coerceRelaxed(data.depth), coerceRelaxed(data.path)],
            ['depth'],
            "Conflicting values provided for 'depth' and 'path'.",
            ctx
        )
        addConflictIfDifferent(
            [coerceRelaxed(data.limit), coerceRelaxed(data.keep)],
            ['limit'],
            "Conflicting values provided for 'limit' and 'keep'.",
            ctx
        )
        const definedQueries = [data.q, data.text, data.message, data.description].filter(
            (v): v is string => v !== undefined
        )
        addConflictIfDifferent(definedQueries, ['tags'], 'Conflicting tag filter query aliases.', ctx)
        if (
            data.tags !== undefined &&
            definedQueries[0] !== undefined &&
            (data.tags.length !== 1 || data.tags[0] !== definedQueries[0])
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['tags'],
                message: "Conflicting values provided for 'tags' and tag query alias.",
            })
        }
    })
    .transform(({ id, q, text, message, description, type, rel, path, keep, ...data }) => {
        let extractedTags = data.tags
        if (!extractedTags) {
            const queryVal = [q, text, message, description].find(
                (v): v is string => v !== undefined && v !== ''
            )
            if (queryVal) extractedTags = [queryVal]
        }
        const rawLimit = data.limit ?? keep
        const numLimit = coerceRelaxed(rawLimit)
        const clampedLimit =
            numLimit === undefined
                ? 20
                : Number.isSafeInteger(numLimit) && numLimit >= 1
                  ? Math.min(numLimit, 500)
                  : numLimit
        return {
            ...data,
            entry_id: coerceCanonicalId(data.entry_id ?? id),
            relationship_type: data.relationship_type ?? type ?? rel,
            depth: coerceRelaxed(data.depth ?? path) ?? 2,
            project_number: coerceCanonicalId(data.project_number),
            limit: clampedLimit,
            tags: extractedTags,
            format: data.format?.trim().toLowerCase(),
            ...(data.source !== undefined ? { source: data.source.trim().toLowerCase() } : {}),
        }
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
