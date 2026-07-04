/**
 * Relationships Tool Group - 2 tools
 *
 * Tools: link_entries, visualize_relationships
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import {
    RelationshipOutputSchema,
    relaxedNumber,
    StrictProjectNumberSchema,
} from './schemas.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const LinkEntriesSchema = z.object({
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

const LinkEntriesSchemaMcp = z
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
    .transform((data) => ({
        from_entry_id: data.from_entry_id ?? data.from_id ?? data.from ?? data.source_id,
        to_entry_id: data.to_entry_id ?? data.to_id ?? data.to ?? data.target_id,
        relationship_type: data.type ?? data.rel ?? data.relationship_type ?? 'references',
        description: data.description ?? data.message ?? data.text,
        project_number: data.project_number,
        workspace_id: data.workspace_id,
    }))

const VisualizeInputSchema = z.object({
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
const VisualizeInputSchemaMcp = z.object({
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
    limit: relaxedNumber().optional().default(20).describe('Maximum entries to include'),
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
    return {
        ...data,
        entry_id: data.entry_id ?? data.id,
        relationship_type: data.type ?? data.rel ?? data.mode ?? data.relationship_type,
        depth: data.path ?? data.depth,
        limit: data.keep ?? data.limit,
        tags: extractedTags,
    };
})

// ============================================================================
// Output Schemas
// ============================================================================

const LinkEntriesOutputSchema = z
    .object({
        success: z.boolean().optional(),
        relationship: RelationshipOutputSchema.optional(),
        duplicate: z.boolean().optional().describe('True if relationship already existed'),
        message: z.string().optional().describe('Additional context about the operation'),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const VisualizationOutputSchema = z
    .object({
        entry_count: z.number().optional(),
        relationship_count: z.number().optional(),
        root_entry: z.number().nullable().optional(),
        depth: z.number().optional(),
        mermaid: z.string().nullable().optional(),
        message: z.string().optional(),
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

// ============================================================================
// Tool Definitions
// ============================================================================

export function getRelationshipTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
    return [
        {
            name: 'link_entries',
            title: 'Link Entries',
            description: 'Create a relationship between two journal entries',
            group: 'relationships',
            inputSchema: LinkEntriesSchemaMcp,
            outputSchema: LinkEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = LinkEntriesSchema.parse(LinkEntriesSchemaMcp.parse(params))
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)

                    // Guard: self-referential links are not meaningful
                    if (input.from_entry_id === input.to_entry_id) {
                        return {
                            ...formatHandlerError(
                                new ValidationError('Cannot link an entry to itself')
                            ),
                            success: false,
                        }
                    }

                    // Guard: both entries must exist and not be soft-deleted.
                    // db.linkEntries only enforces FK against physical rows, so soft-deleted
                    // entries (deletedAt set) would pass the FK check silently.
                    const fromEntry = db.getEntryById(input.from_entry_id, wsId)
                    if (!fromEntry || fromEntry.deletedAt) {
                        return {
                            ...formatHandlerError(
                                new ResourceNotFoundError('Entry', String(input.from_entry_id))
                            ),
                            success: false,
                        }
                    }
                    const toEntry = db.getEntryById(input.to_entry_id, wsId)
                    if (!toEntry || toEntry.deletedAt) {
                        return {
                            ...formatHandlerError(
                                new ResourceNotFoundError('Entry', String(input.to_entry_id))
                            ),
                            success: false,
                        }
                    }

                    // Check for existing duplicate relationship (exact direction only).
                    // Reverse direction (B→A when A→B exists) is intentionally allowed
                    // so agents can model bidirectional relationships explicitly.
                    const existingRelationships = db.getRelationships(input.from_entry_id)
                    const existing = existingRelationships.find(
                        (r) =>
                            r.fromEntryId === input.from_entry_id &&
                            r.toEntryId === input.to_entry_id &&
                            r.relationshipType === input.relationship_type
                    )

                    if (existing) {
                        return {
                            success: true,
                            relationship: existing,
                            duplicate: true,
                            message: 'Relationship already exists',
                        }
                    }

                    // linkEntries throws for nonexistent entries
                    const relationship = db.linkEntries(
                        input.from_entry_id,
                        input.to_entry_id,
                        input.relationship_type,
                        input.description
                    )
                    return { success: true, relationship }
                } catch (error) {
                    // Domain errors from db.linkEntries (nonexistent entries)
                    const input = (() => {
                        try {
                            return LinkEntriesSchema.parse(LinkEntriesSchemaMcp.parse(params))
                        } catch {
                            // If parse itself failed, use formatHandlerError
                            return null
                        }
                    })()

                    if (input) {
                        const errMsg = error instanceof Error ? error.message : 'Unknown error'
                        const isFkError = errMsg.includes('FOREIGN KEY constraint failed')
                        if (isFkError) {
                            return {
                                ...formatHandlerError(
                                    new ResourceNotFoundError(
                                        'Entry',
                                        `from: ${String(input.from_entry_id)}, to: ${String(input.to_entry_id)}`
                                    )
                                ),
                                success: false,
                            }
                        }
                    }
                    return formatHandlerError(error)
                }
            },
        },
        {
            name: 'visualize_relationships',
            title: 'Visualize Relationships',
            description: 'Generate a Mermaid diagram visualization of entry relationships',
            group: 'relationships',
            inputSchema: VisualizeInputSchemaMcp,
            outputSchema: VisualizationOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = VisualizeInputSchema.parse(VisualizeInputSchemaMcp.parse(params))
                    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
                    if (input.entry_id !== undefined) {
                        const entry = db.getEntryById(input.entry_id, wsId)
                        if (!entry || entry.deletedAt) {
                            return {
                                ...formatHandlerError(
                                    new ResourceNotFoundError('Entry', String(input.entry_id))
                                ),
                                success: false,
                            }
                        }
                    }

                    const results = db.visualizeRelationships({
                        entryId: input.entry_id,
                        tags: input.tags,
                        relationshipType: input.relationship_type,
                        depth: input.depth,
                        limit: input.limit,
                    })

                    if (results.nodes.length === 0) {
                        return {
                            entry_count: 0,
                            relationship_count: 0,
                            root_entry: input.entry_id ?? null,
                            depth: input.depth,
                            mermaid:
                                '```mermaid\ngraph TD\n  NoData["No entries found with relationships matching your criteria"]\n```',
                            message: 'No entries found with relationships matching your criteria',
                        }
                    }

                    // Generate Mermaid diagram
                    const MERMAID_CONTENT_PREVIEW_LENGTH = 40
                    const mermaidLines: string[] = ['```mermaid', 'graph TD']

                    for (const node of results.nodes) {
                        const content = (node.metadata?.['content'] as string) || ''
                        let contentPreview = content
                            .slice(0, MERMAID_CONTENT_PREVIEW_LENGTH)
                            .replace(/\n/g, ' ')
                        if (content.length > MERMAID_CONTENT_PREVIEW_LENGTH) contentPreview += '...'
                        contentPreview = contentPreview
                            .replace(/"/g, "'")
                            .replace(/\[/g, '(')
                            .replace(/\]/g, ')')
                        const entryTypeShort = node.group.slice(0, 20)
                        mermaidLines.push(
                            `    E${node.id}["#${node.id}: ${contentPreview}<br/>${entryTypeShort}"]`
                        )
                    }

                    mermaidLines.push('')

                    const relSymbols: Record<string, string> = {
                        references: '-->',
                        implements: '==>',
                        clarifies: '-.->',
                        evolves_from: '-->',
                        response_to: '<-->',
                        blocked_by: '--x',
                        resolved: '==>',
                        caused: '-.->',
                    }

                    for (const edge of results.edges) {
                        const arrow = relSymbols[edge.type] ?? '-->'
                        mermaidLines.push(
                            `    E${String(edge.from)} ${arrow}|${edge.type}| E${String(edge.to)}`
                        )
                    }

                    mermaidLines.push('')
                    for (const node of results.nodes) {
                        const isPersonal = Boolean(node.metadata?.['is_personal'])
                        if (isPersonal) {
                            mermaidLines.push(`    style E${node.id} fill:#E3F2FD`)
                        } else {
                            mermaidLines.push(`    style E${node.id} fill:#FFF3E0`)
                        }
                    }
                    mermaidLines.push('```')
                    const mermaid = mermaidLines.join('\n')

                    return {
                        entry_count: results.nodes.length,
                        relationship_count: results.edges.length,
                        root_entry: input.entry_id ?? null,
                        depth: input.depth,
                        mermaid,
                        legend: {
                            blue: 'Personal entries',
                            orange: 'Project entries',
                            arrows: {
                                '-->': 'references / evolves_from',
                                '==>': 'implements / resolved',
                                '-.->': 'clarifies / caused',
                                '<-->': 'response_to',
                                '--x': 'blocked_by',
                            },
                        },
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
