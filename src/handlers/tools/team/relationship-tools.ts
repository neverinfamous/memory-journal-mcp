/**
 * Team Relationship Tools - 2 tools
 *
 * Tools: team_link_entries, team_visualize_relationships
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { ValidationError } from '../../../types/errors.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import { TEAM_DB_ERROR_RESPONSE, triggerTeamNotifications, resolveTeamProjectNumber, missingTeamProjectNumberError } from './helpers.js'
import { DATE_MIN_SENTINEL, DATE_MAX_SENTINEL } from '../schemas.js'
import {
    TeamLinkEntriesSchema,
    TeamLinkEntriesSchemaMcp,
    TeamVisualizeRelationshipsSchema,
    TeamVisualizeRelationshipsSchemaMcp,
    TeamLinkEntriesOutputSchema,
    TeamVisualizeOutputSchema,
} from './schemas.js'

// ============================================================================
// Helpers
// ============================================================================

function isInScopedGraphPartition(
    entry: { workspaceId?: string; projectNumber?: number | null } | null | undefined,
    wsId: string,
    projectNumber?: number
): boolean {
    if (!entry) return false
    const wsMatches = wsId === '*' || entry.workspaceId === undefined || entry.workspaceId === wsId
    const projMatches = projectNumber === undefined || entry.projectNumber === projectNumber
    return wsMatches && projMatches
}

/** Breadth-first walk of relationships from `startId`, returning the start id plus neighbors up to `depth`. */
function collectNeighborhood(
    teamDb: IDatabaseAdapter,
    startId: number,
    depth: number,
    workspaceId: string,
    projectNumber?: number
): number[] {
    const entryIds: number[] = [startId]
    const visited = new Set<number>(entryIds)
    let frontier = [startId]

    for (let d = 0; d < depth && frontier.length > 0; d++) {
        const relMap =
            typeof teamDb.getRelationshipsForEntries === 'function'
                ? teamDb.getRelationshipsForEntries(frontier, workspaceId)
                : null
        const candidateIds: number[] = []
        for (const fid of frontier) {
            const rels = relMap ? (relMap.get(fid) ?? []) : teamDb.getRelationships(fid, workspaceId)
            for (const r of rels) {
                const otherId = r.fromEntryId === fid ? r.toEntryId : r.fromEntryId
                if (!visited.has(otherId)) {
                    visited.add(otherId)
                    candidateIds.push(otherId)
                }
            }
        }
        let nextFrontier = candidateIds
        if (projectNumber !== undefined && candidateIds.length > 0) {
            const batchEntries =
                typeof teamDb.getEntriesByIds === 'function'
                    ? teamDb.getEntriesByIds(candidateIds, workspaceId)
                    : null
            nextFrontier = candidateIds.filter((cid) => {
                const target = batchEntries ? (batchEntries.get(cid) ?? null) : teamDb.getEntryById(cid, workspaceId)
                return isInScopedGraphPartition(target, workspaceId, projectNumber)
            })
        }
        frontier = nextFrontier
        entryIds.push(...nextFrontier)
    }
    return entryIds
}

/** Build graph nodes and edges for `entryIds` using batch lookups when available. */
export function buildRelationshipGraph(
    teamDb: IDatabaseAdapter,
    entryIds: number[],
    wsId: string,
    projectNumber?: number
): { nodes: Map<number, string>; edges: { from: number; to: number; type: string }[] } {
    const nodes = new Map<number, string>()
    const edges: { from: number; to: number; type: string }[] = []
    const seenEdges = new Set<string>()
    const entryIdSet = new Set<number>(entryIds)
    const batchEntries =
        typeof teamDb.getEntriesByIds === 'function' ? teamDb.getEntriesByIds(entryIds, wsId) : null
    const batchRels =
        typeof teamDb.getRelationshipsForEntries === 'function'
            ? teamDb.getRelationshipsForEntries(entryIds, wsId)
            : null

    for (const eid of entryIds) {
        const rawEntry = batchEntries ? (batchEntries.get(eid) ?? null) : teamDb.getEntryById(eid, wsId)
        const entry = rawEntry && isInScopedGraphPartition(rawEntry, wsId, projectNumber) ? rawEntry : null
        if (entry) {
            let label = entry.content.substring(0, 40).replace(/\n/g, ' ')
            if (entry.content.length > 40) label += '...'
            label = label.replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')')
            nodes.set(eid, label)
        }

        const rels = batchRels ? (batchRels.get(eid) ?? []) : teamDb.getRelationships(eid, wsId)
        for (const r of rels) {
            const edgeKey = `${String(r.fromEntryId)}-${String(r.toEntryId)}`
            if (!seenEdges.has(edgeKey) && entryIdSet.has(r.fromEntryId) && entryIdSet.has(r.toEntryId)) {
                seenEdges.add(edgeKey)
                edges.push({ from: r.fromEntryId, to: r.toEntryId, type: r.relationshipType })
            }
        }
    }
    // Only keep edges whose endpoints both resolved to nodes in this workspace/project;
    // links that cross into another project or workspace must not leak through.
    const scopedEdges = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to))
    return { nodes, edges: scopedEdges }
}

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
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const {
                        from_entry_id,
                        to_entry_id,
                        relationship_type,
                        description,
                        project_number,
                        workspace_id,
                    } = TeamLinkEntriesSchema.parse(params)
                    if (workspace_id?.trim() === '*') {
                        throw new ValidationError(
                            "Wildcard workspace_id '*' is not supported for team_link_entries. Specify a concrete workspace_id."
                        )
                    }
                    let wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)

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

                    // Verify both entries exist and belong to the project
                    const fromEntry = teamDb.getEntryById(from_entry_id, wsId)
                    const explicitOrResolvedPn = resolveTeamProjectNumber(
                        context,
                        wsId,
                        project_number,
                        workspace_id
                    )
                    const resolvedPn =
                        explicitOrResolvedPn ??
                        (fromEntry?.projectNumber !== null ? fromEntry?.projectNumber : undefined)
                    const projectNumber = resolvedPn !== null ? resolvedPn : undefined
                    if (projectNumber === undefined) {
                        return {
                            success: false,
                            error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion:
                                'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                            recoverable: true,
                        }
                    }
                    wsId = resolveWriteWorkspaceId(workspace_id ?? wsId, projectNumber, context.config)
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
                    if (fromEntry.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            error: `Team entry ${String(from_entry_id)} does not belong to project ${String(projectNumber)}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }
                    const toEntry = teamDb.getEntryById(to_entry_id, wsId)
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
                    if (toEntry.projectNumber !== projectNumber) {
                        return {
                            success: false,
                            error: `Team entry ${String(to_entry_id)} does not belong to project ${String(projectNumber)}`,
                            code: 'RESOURCE_NOT_FOUND',
                            category: 'resource',
                            suggestion: 'Verify the team entry ID and project number, and try again',
                            recoverable: true,
                        }
                    }

                    if (fromEntry.workspaceId !== toEntry.workspaceId) {
                        return {
                            success: false,
                            error: 'Cannot link team entries that belong to different workspaces',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Both team entries must belong to the same workspace',
                            recoverable: true,
                        }
                    }

                    // Check for existing relationship (exact direction only).
                    // Reverse direction is allowed to model bidirectional relationships.
                    const existing = teamDb.getRelationships(from_entry_id, wsId)
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
                        description,
                        wsId
                    )

                    triggerTeamNotifications(context)

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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { entry_id, tag, depth, project_number, workspace_id } =
                        TeamVisualizeRelationshipsSchema.parse(params)
                    let wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
                    const resolvedProject = resolveTeamProjectNumber(context, wsId, project_number, workspace_id)
                    const projectNumber = typeof resolvedProject === 'number' ? resolvedProject : undefined
                    if (projectNumber === undefined) {
                        return missingTeamProjectNumberError()
                    }

                    // Collect entry IDs to visualize
                    let entryIds: number[] = []

                    if (entry_id !== undefined) {
                        const fromEntry = teamDb.getEntryById(entry_id, wsId)
                        if (fromEntry?.workspaceId !== undefined && wsId === '*') {
                            wsId = fromEntry.workspaceId
                        }
                        if (!fromEntry || (projectNumber !== undefined && fromEntry.projectNumber !== projectNumber)) {
                            return {
                                success: false,
                                error: `Team entry ${String(entry_id)} not found`,
                                code: 'RESOURCE_NOT_FOUND',
                                category: 'resource',
                                suggestion: 'Verify the team entry ID and try again',
                                recoverable: true,
                            }
                        }
                        // Start from a specific entry and traverse
                        entryIds = collectNeighborhood(teamDb, entry_id, depth, wsId, projectNumber)
                    } else if (tag) {
                        // Get entries by tag using an all-time date range to bypass date filtering
                        const { entries: tagEntries } = teamDb.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
                            tags: [tag],
                            limit: 50,
                            workspaceId: wsId,
                            ...(projectNumber !== undefined ? { projectNumber } : {}),
                        })
                        entryIds = tagEntries.map((e) => e.id)
                    } else {
                        // Default: recent entries
                        const { entries: recent } = teamDb.getRecentEntries(
                            20,
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            wsId,
                            projectNumber
                        )
                        entryIds = recent.map((e) => e.id)
                    }

                    if (entryIds.length === 0) {
                        return {
                            success: true,
                            mermaid: 'graph LR\n  empty["No entries found"]',
                            nodeCount: 0,
                            edgeCount: 0,
                            nodes: [],
                            edges: [],
                        }
                    }

                    const { nodes, edges } = buildRelationshipGraph(teamDb, entryIds, wsId, projectNumber)

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
                        nodes: Array.from(nodes.entries()).map(([id, label]) => ({ id, label })),
                        edges,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
