/**
 * Team Relationship Tools - 2 tools
 *
 * Tools: team_link_entries, team_visualize_relationships
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import {
    TeamLinkEntriesSchema,
    TeamLinkEntriesSchemaMcp,
    TeamVisualizeRelationshipsSchema,
    TeamVisualizeRelationshipsSchemaMcp,
    TeamLinkEntriesOutputSchema,
    TeamVisualizeOutputSchema,
} from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamRelationshipTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_link_entries',
            title: 'Link Team Entries',
            description: 'Create a relationship between two team entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamLinkEntriesSchemaMcp,
            outputSchema: TeamLinkEntriesOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { from_entry_id, to_entry_id, relationship_type, description } =
                        TeamLinkEntriesSchema.parse(params)

                    // Guard: self-referential links are not meaningful
                    if (from_entry_id === to_entry_id) {
                        return {
                            success: false,
                            error: 'Cannot link an entry to itself',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Choose a different target entry to create a meaningful relationship',
                            recoverable: true,
                        }
                    }

                    // Verify both entries exist
                    const fromEntry = teamDb.getEntryById(from_entry_id)
                    if (!fromEntry) {
                        return {
                            success: false,
                            error: `Team entry ${String(from_entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and try again',
                            recoverable: true,
                        }
                    }
                    const toEntry = teamDb.getEntryById(to_entry_id)
                    if (!toEntry) {
                        return {
                            success: false,
                            error: `Team entry ${String(to_entry_id)} not found`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and try again',
                            recoverable: true,
                        }
                    }

                    // Check for existing relationship (exact direction only).
                    // Reverse direction is allowed to model bidirectional relationships.
                    const existing = teamDb.getRelationships(from_entry_id)
                    const duplicate = existing.find(
                        (r) =>
                            r.fromEntryId === from_entry_id &&
                            r.toEntryId === to_entry_id &&
                            r.relationshipType === relationship_type
                    )

                    if (duplicate) {
                        return {
                            success: true,
                            duplicate: true,
                            relationship: duplicate,
                            message: 'Relationship already exists',
                        }
                    }

                    const relationship = teamDb.linkEntries(
                        from_entry_id,
                        to_entry_id,
                        relationship_type,
                        description
                    )

                    return {
                        success: true,
                        relationship,
                        message: `Linked entries ${String(from_entry_id)} → ${String(to_entry_id)} (${relationship_type})`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_visualize_relationships',
            title: 'Visualize Team Relationships',
            description:
                'Generate a Mermaid diagram showing relationships between team entries. Filter by entry ID, tag, or traverse to a specified depth. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamVisualizeRelationshipsSchemaMcp,
            outputSchema: TeamVisualizeOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, tag, depth } = TeamVisualizeRelationshipsSchema.parse(params)

                    // Collect entry IDs to visualize
                    let entryIds: number[] = []

                    if (entry_id !== undefined) {
                        // Start from a specific entry and traverse
                        entryIds = [entry_id]
                        const visited = new Set<number>(entryIds)
                        let frontier = [...entryIds]

                        for (let d = 0; d < depth; d++) {
                            const nextFrontier: number[] = []
                            for (const fid of frontier) {
                                const rels = teamDb.getRelationships(fid)
                                for (const r of rels) {
                                    const otherId =
                                        r.fromEntryId === fid ? r.toEntryId : r.fromEntryId
                                    if (!visited.has(otherId)) {
                                        visited.add(otherId)
                                        nextFrontier.push(otherId)
                                    }
                                }
                            }
                            frontier = nextFrontier
                            entryIds.push(...nextFrontier)
                        }
                    } else if (tag) {
                        // Get entries by tag using an all-time date range to bypass date filtering
                        const tagEntries = teamDb.searchByDateRange('1970-01-01', '2999-12-31', {
                            tags: [tag],
                            limit: 50,
                        })
                        entryIds = tagEntries.map((e) => e.id)
                    } else {
                        // Default: recent entries
                        const recent = teamDb.getRecentEntries(20)
                        entryIds = recent.map((e) => e.id)
                    }

                    if (entryIds.length === 0) {
                        return {
                            success: true,
                            mermaid: 'graph LR\n  empty["No entries found"]',
                            nodeCount: 0,
                            edgeCount: 0,
                        }
                    }

                    // Build graph
                    const nodes = new Map<number, string>()
                    const edges: { from: number; to: number; type: string }[] = []
                    const seenEdges = new Set<string>()

                    for (const eid of entryIds) {
                        const entry = teamDb.getEntryById(eid)
                        if (entry) {
                            const label = entry.content.substring(0, 40).replace(/"/g, "'")
                            nodes.set(eid, label)
                        }

                        const rels = teamDb.getRelationships(eid)
                        for (const r of rels) {
                            const edgeKey = `${String(r.fromEntryId)}-${String(r.toEntryId)}`
                            if (
                                !seenEdges.has(edgeKey) &&
                                entryIds.includes(r.fromEntryId) &&
                                entryIds.includes(r.toEntryId)
                            ) {
                                seenEdges.add(edgeKey)
                                edges.push({
                                    from: r.fromEntryId,
                                    to: r.toEntryId,
                                    type: r.relationshipType,
                                })
                            }
                        }
                    }

                    // Generate Mermaid
                    let mermaid = 'graph LR\n'
                    for (const [id, label] of nodes) {
                        mermaid += `  e${String(id)}["#${String(id)}: ${label}"]\n`
                    }
                    for (const edge of edges) {
                        mermaid += `  e${String(edge.from)} -->|${edge.type}| e${String(edge.to)}\n`
                    }

                    return {
                        success: true,
                        mermaid,
                        nodeCount: nodes.size,
                        edgeCount: edges.length,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
