/**
 * Relationships Tool Group - 2 tools
 *
 * Tools: link_entries, visualize_relationships
 */

import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from './write-workspace.js'
import {
    LinkEntriesSchema,
    LinkEntriesSchemaMcp,
    LinkEntriesOutputSchema,
    VisualizeInputSchema,
    VisualizeInputSchemaMcp,
    VisualizationOutputSchema,
} from './relationship-schemas.js'

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
                    // [INVARIANT] H4: '*' is a read-only wildcard; links are writes and must be scoped.
                    const wsId = resolveWriteWorkspaceId(
                        input.workspace_id,
                        input.project_number,
                        context.config
                    )

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

                    if (fromEntry.workspaceId !== toEntry.workspaceId) {
                        return {
                            ...formatHandlerError(
                                new ValidationError(
                                    'Cannot link entries that belong to different workspaces'
                                )
                            ),
                            success: false,
                        }
                    }

                    if (
                        input.project_number !== undefined &&
                        (fromEntry.projectNumber !== input.project_number ||
                            toEntry.projectNumber !== input.project_number)
                    ) {
                        const foreignId =
                            fromEntry.projectNumber !== input.project_number
                                ? input.from_entry_id
                                : input.to_entry_id
                        return {
                            ...formatHandlerError(new ResourceNotFoundError('Entry', String(foreignId))),
                            success: false,
                        }
                    }

                    // Check for existing duplicate relationship (exact direction only).
                    // Reverse direction (B→A when A→B exists) is intentionally allowed
                    // so agents can model bidirectional relationships explicitly.
                    const existingRelationships = db.getRelationships(input.from_entry_id, wsId)
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
                        input.description,
                        wsId
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
                    const projectNumber = alignedProjectFilter(
                        wsId,
                        input.project_number,
                        activeProjectRegistry(context.config?.projectRegistry)
                    )
                    if (input.entry_id !== undefined) {
                        const entry = db.getEntryById(input.entry_id, wsId)
                        const foreignProject =
                            input.project_number !== undefined &&
                            entry?.projectNumber !== input.project_number
                        if (!entry || entry.deletedAt || foreignProject) {
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
                        workspaceId: wsId,
                        ...(projectNumber !== undefined ? { projectNumber } : {}),
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
                            nodes: [],
                            edges: [],
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
                        const entryTypeShort = (node.group || '').slice(0, 20)
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
                        nodes: results.nodes,
                        edges: results.edges,
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
