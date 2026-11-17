/**
 * Team Relationship Tools - 2 tools
 *
 * Tools: team_link_entries, team_visualize_relationships
 */

import type { z } from 'zod'
import type { JournalEntry, ToolDefinition, ToolContext } from '../../../types/index.js'
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

type TeamLinkInput = z.infer<typeof TeamLinkEntriesSchema>

function validateTeamEntryProjectMembership(
    entryId: number,
    entry: JournalEntry | null | undefined,
    projectNumber: number
): Record<string, unknown> | undefined {
    if (!entry) {
        return {
            success: false,
            error: `Team entry ${String(entryId)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the team entry ID and try again',
            recoverable: true,
        }
    }
    if (entry.projectNumber !== projectNumber) {
        return {
            success: false,
            error: `Team entry ${String(entryId)} does not belong to project ${String(projectNumber)}`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: 'Verify the team entry ID and project number, and try again',
            recoverable: true,
        }
    }
    return undefined
}

function resolveValidatedTeamLinkTargets(
    context: ToolContext,
    teamDb: IDatabaseAdapter,
    input: TeamLinkInput
): { wsId: string } | { errorResponse: Record<string, unknown> } {
    const { from_entry_id, to_entry_id, project_number, workspace_id } = input
    if (workspace_id?.trim() === '*') {
        throw new ValidationError(
            "Wildcard workspace_id '*' is not supported for team_link_entries. Specify a concrete workspace_id."
        )
    }
    let wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)
    if (from_entry_id === to_entry_id) {
        return {
            errorResponse: {
                success: false,
                error: 'Cannot link an entry to itself',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Choose a different target entry to create a meaningful relationship',
                recoverable: true,
            },
        }
    }

    const fromEntry = teamDb.getEntryById(from_entry_id, wsId)
    const explicitOrResolvedPn = resolveTeamProjectNumber(context, wsId, project_number, workspace_id)
    const resolvedPn =
        explicitOrResolvedPn ??
        (fromEntry?.projectNumber !== null ? fromEntry?.projectNumber : undefined)
    const projectNumber = resolvedPn !== null ? resolvedPn : undefined
    if (projectNumber === undefined) {
        return { errorResponse: missingTeamProjectNumberError() }
    }
    wsId = resolveWriteWorkspaceId(workspace_id ?? wsId, projectNumber, context.config)

    const fromErr = validateTeamEntryProjectMembership(from_entry_id, fromEntry, projectNumber)
    if (fromErr !== undefined) return { errorResponse: fromErr }
    const toEntry = teamDb.getEntryById(to_entry_id, wsId)
    const toErr = validateTeamEntryProjectMembership(to_entry_id, toEntry, projectNumber)
    if (toErr !== undefined) return { errorResponse: toErr }

    if (fromEntry?.workspaceId !== toEntry?.workspaceId) {
        return {
            errorResponse: {
                success: false,
                error: 'Cannot link team entries that belong to different workspaces',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Both team entries must belong to the same workspace',
                recoverable: true,
            },
        }
    }
    return { wsId }
}

function executeTeamLinkEntries(
    context: ToolContext,
    teamDb: IDatabaseAdapter,
    params: unknown
): Record<string, unknown> {
    const input = TeamLinkEntriesSchema.parse(params)
    const resolved = resolveValidatedTeamLinkTargets(context, teamDb, input)
    if ('errorResponse' in resolved) return resolved.errorResponse
    const { wsId } = resolved
    const { from_entry_id, to_entry_id, relationship_type, description } = input

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
}

function collectTeamVisualizeEntryIds(
    teamDb: IDatabaseAdapter,
    initialWsId: string,
    projectNumber: number,
    entryId: number | undefined,
    tag: string | undefined,
    depth: number
): { wsId: string; entryIds: number[] } | { errorResponse: Record<string, unknown> } {
    let wsId = initialWsId
    if (entryId !== undefined) {
        const fromEntry = teamDb.getEntryById(entryId, wsId)
        if (fromEntry?.workspaceId !== undefined && wsId === '*') {
            wsId = fromEntry.workspaceId
        }
        if (fromEntry?.projectNumber !== projectNumber) {
            return {
                errorResponse: {
                    success: false,
                    error: `Team entry ${String(entryId)} not found`,
                    code: 'RESOURCE_NOT_FOUND',
                    category: 'resource',
                    suggestion: 'Verify the team entry ID and try again',
                    recoverable: true,
                },
            }
        }
        return { wsId, entryIds: collectNeighborhood(teamDb, entryId, depth, wsId, projectNumber) }
    }
    if (tag) {
        const { entries: tagEntries } = teamDb.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
            tags: [tag],
            limit: 50,
            workspaceId: wsId,
            projectNumber,
        })
        return { wsId, entryIds: tagEntries.map((e) => e.id) }
    }
    const { entries: recent } = teamDb.getRecentEntries(
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        wsId,
        projectNumber
    )
    return { wsId, entryIds: recent.map((e) => e.id) }
}

function executeTeamVisualizeRelationships(
    context: ToolContext,
    teamDb: IDatabaseAdapter,
    params: unknown
): Record<string, unknown> {
    const { entry_id, tag, depth, project_number, workspace_id } =
        TeamVisualizeRelationshipsSchema.parse(params)
    const initialWsId = resolveWorkspaceId(workspace_id, project_number, context.config)
    const resolvedProject = resolveTeamProjectNumber(
        context,
        initialWsId,
        project_number,
        workspace_id
    )
    const projectNumber = typeof resolvedProject === 'number' ? resolvedProject : undefined
    if (projectNumber === undefined) {
        return missingTeamProjectNumberError()
    }

    const collected = collectTeamVisualizeEntryIds(
        teamDb,
        initialWsId,
        projectNumber,
        entry_id,
        tag,
        depth
    )
    if ('errorResponse' in collected) return collected.errorResponse
    const { wsId, entryIds } = collected

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
}

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
        if (typeof projectNumber === 'number' && candidateIds.length > 0) {
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
            const edgeKey = `${String(r.fromEntryId)}-${String(r.toEntryId)}-${r.relationshipType}`
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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamLinkEntries(context, teamDb, params)
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
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamVisualizeRelationships(context, teamDb, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
