/**
 * Relationships Tool Group - 2 tools
 *
 * Tools: link_entries, visualize_relationships
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext, RelationshipType } from '../../types/index.js'
import { formatHandlerErrorResponse } from '../../utils/error-helpers.js'
import { RelationshipOutputSchema, relaxedNumber } from './schemas.js'
import { ErrorResponseFields } from './error-response-fields.js'

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
})

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
const LinkEntriesSchemaMcp = z.object({
    from_entry_id: relaxedNumber(),
    to_entry_id: relaxedNumber(),
    relationship_type: z.string().optional().default('references'),
    description: z.string().optional(),
})

const VisualizeInputSchema = z.object({
    entry_id: z
        .number()
        .optional()
        .describe('Specific entry ID to visualize (shows connected entries)'),
    tags: z.array(z.string()).optional().describe('Filter entries by tags'),
    depth: z.number().min(1).max(3).optional().default(2).describe('Relationship traversal depth'),
    limit: z.number().max(500).optional().default(20).describe('Maximum entries to include'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
const VisualizeInputSchemaMcp = z.object({
    entry_id: relaxedNumber()
        .optional()
        .describe('Specific entry ID to visualize (shows connected entries)'),
    tags: z.array(z.string()).optional().describe('Filter entries by tags'),
    depth: relaxedNumber().optional().default(2).describe('Relationship traversal depth'),
    limit: relaxedNumber().optional().default(20).describe('Maximum entries to include'),
})

// ============================================================================
// Output Schemas
// ============================================================================

const LinkEntriesOutputSchema = z.object({
    success: z.boolean().optional(),
    relationship: RelationshipOutputSchema.optional(),
    duplicate: z.boolean().optional().describe('True if relationship already existed'),
    message: z.string().optional().describe('Additional context about the operation'),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

const VisualizationOutputSchema = z.object({
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
}).extend(ErrorResponseFields.shape)

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
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const input = LinkEntriesSchema.parse(params)

                    // Check for existing duplicate relationship
                    const existingRelationships = db.getRelationships(input.from_entry_id)
                    const existing = existingRelationships.find(
                        (r) =>
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
                        input.relationship_type as RelationshipType,
                        input.description
                    )
                    return { success: true, relationship }
                } catch (error) {
                    // Domain errors from db.linkEntries (nonexistent entries)
                    const input = (() => {
                        try {
                            return LinkEntriesSchema.parse(params)
                        } catch {
                            // If parse itself failed, use formatHandlerErrorResponse
                            return null
                        }
                    })()

                    if (input) {
                        return {
                            success: false,
                            relationship: {
                                id: 0,
                                fromEntryId: input.from_entry_id,
                                toEntryId: input.to_entry_id,
                                relationshipType: input.relationship_type,
                                description: input.description ?? null,
                                createdAt: '',
                            },
                            message: error instanceof Error ? error.message : 'Unknown error',
                        }
                    }
                    return formatHandlerErrorResponse(error)
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
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const input = VisualizeInputSchema.parse(params)

                    const rawDb = db.getRawDb() as {
                        exec: (sql: string, params?: unknown[]) => { columns: string[]; values: unknown[][] }[]
                    }
                    let entriesResult

                    if (input.entry_id !== undefined) {
                        const entry = db.getEntryById(input.entry_id)
                        if (!entry) {
                            return {
                                entry_count: 0,
                                relationship_count: 0,
                                root_entry: input.entry_id,
                                depth: input.depth,
                                mermaid: null,
                                message: `Entry ${String(input.entry_id)} not found`,
                            }
                        }

                        entriesResult = rawDb.exec(
                            `
                            WITH RECURSIVE connected_entries(id, distance) AS (
                                SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                                UNION
                                SELECT DISTINCT
                                    CASE
                                        WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                                        ELSE r.from_entry_id
                                    END,
                                    ce.distance + 1
                                FROM connected_entries ce
                                JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                                WHERE ce.distance < ?
                            )
                            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                            FROM memory_journal mj
                            JOIN connected_entries ce ON mj.id = ce.id
                            WHERE mj.deleted_at IS NULL
                            LIMIT ?
                        `,
                            [input.entry_id, input.depth, input.limit]
                        )
                    } else if (input.tags && input.tags.length > 0) {
                        const placeholders = input.tags.map(() => '?').join(',')
                        entriesResult = rawDb.exec(
                            `
                            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                            FROM memory_journal mj
                            WHERE mj.deleted_at IS NULL
                              AND mj.id IN (
                                  SELECT et.entry_id FROM entry_tags et
                                  JOIN tags t ON et.tag_id = t.id
                                  WHERE t.name IN (${placeholders})
                              )
                            LIMIT ?
                        `,
                            [...input.tags, input.limit]
                        )
                    } else {
                        entriesResult = rawDb.exec(
                            `
                            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                            FROM memory_journal mj
                            WHERE mj.deleted_at IS NULL
                              AND mj.id IN (
                                  SELECT DISTINCT from_entry_id FROM relationships
                                  UNION
                                  SELECT DISTINCT to_entry_id FROM relationships
                              )
                            ORDER BY mj.id DESC
                            LIMIT ?
                        `,
                            [input.limit]
                        )
                    }

                    if (!entriesResult[0] || entriesResult[0].values.length === 0) {
                        return {
                            entry_count: 0,
                            relationship_count: 0,
                            root_entry: input.entry_id ?? null,
                            depth: input.depth,
                            mermaid: null,
                            message: 'No entries found with relationships matching your criteria',
                        }
                    }

                    // Build entries map
                    const entries: Record<
                        number,
                        {
                            id: number
                            entry_type: string
                            content: string
                            is_personal: boolean
                        }
                    > = {}
                    const cols = entriesResult[0].columns
                    for (const row of entriesResult[0].values) {
                        const id = row[cols.indexOf('id')] as number
                        entries[id] = {
                            id,
                            entry_type: row[cols.indexOf('entry_type')] as string,
                            content: row[cols.indexOf('content')] as string,
                            is_personal: Boolean(row[cols.indexOf('is_personal')]),
                        }
                    }

                    const entryIds = Object.keys(entries).map(Number)
                    const placeholders = entryIds.map(() => '?').join(',')

                    const relsResult = rawDb.exec(
                        `
                        SELECT from_entry_id, to_entry_id, relationship_type
                        FROM relationships
                        WHERE from_entry_id IN (${placeholders})
                          AND to_entry_id IN (${placeholders})
                    `,
                        [...entryIds, ...entryIds]
                    )

                    const relationships = relsResult[0]?.values ?? []

                    // Generate Mermaid diagram
                    let mermaid = '```mermaid\\ngraph TD\\n'

                    for (const [idStr, entry] of Object.entries(entries)) {
                        let contentPreview = entry.content.slice(0, 40).replace(/\\n/g, ' ')
                        if (entry.content.length > 40) contentPreview += '...'
                        contentPreview = contentPreview
                            .replace(/"/g, "'")
                            .replace(/\[/g, '(')
                            .replace(/\]/g, ')')
                        const entryTypeShort = entry.entry_type.slice(0, 20)
                        mermaid += `    E${idStr}["#${idStr}: ${contentPreview}<br/>${entryTypeShort}"]\\n`
                    }

                    mermaid += '\\n'

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

                    for (const rel of relationships) {
                        const fromId = rel[0] as number
                        const toId = rel[1] as number
                        const relType = rel[2] as string
                        const arrow = relSymbols[relType] ?? '-->'
                        mermaid += `    E${String(fromId)} ${arrow}|${relType}| E${String(toId)}\\n`
                    }

                    mermaid += '\\n'
                    for (const [idStr, entry] of Object.entries(entries)) {
                        if (entry.is_personal) {
                            mermaid += `    style E${idStr} fill:#E3F2FD\\n`
                        } else {
                            mermaid += `    style E${idStr} fill:#FFF3E0\\n`
                        }
                    }
                    mermaid += '```'

                    return {
                        entry_count: Object.keys(entries).length,
                        relationship_count: relationships.length,
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
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
