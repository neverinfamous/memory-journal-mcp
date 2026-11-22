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
import {
    canRealignOrphanedRegisteredProject,
    resolveTeamMutationProjectNumber,
} from './admin-tools/team-pk-scope-helpers.js'
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

function teamRelError(
    error: string,
    code: 'RESOURCE_NOT_FOUND' | 'VALIDATION_ERROR',
    category: 'resource' | 'validation',
    suggestion: string
): Record<string, unknown> {
    return { success: false, error, code, category, suggestion, recoverable: true }
}

function validateTeamEntryProjectMembership(
    context: ToolContext,
    wsId: string,
    entryId: number,
    entry: JournalEntry | null | undefined,
    projectNumber: number
): Record<string, unknown> | undefined {
    if (!entry) {
        return teamRelError(
            `Team entry ${String(entryId)} not found`,
            'RESOURCE_NOT_FOUND',
            'resource',
            'Verify the team entry ID and try again'
        )
    }
    if (
        entry.projectNumber !== projectNumber &&
        !canRealignOrphanedRegisteredProject(context, wsId, projectNumber, entry)
    ) {
        return teamRelError(
            `Team entry ${String(entryId)} does not belong to project ${String(projectNumber)}`,
            'RESOURCE_NOT_FOUND',
            'resource',
            'Verify the team entry ID and project number, and try again'
        )
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
            errorResponse: teamRelError(
                'Cannot link an entry to itself',
                'VALIDATION_ERROR',
                'validation',
                'Choose a different target entry to create a meaningful relationship'
            ),
        }
    }

    const fromEntry = teamDb.getEntryById(from_entry_id, wsId)
    const projectNumber = resolveTeamMutationProjectNumber(
        context,
        wsId,
        project_number,
        workspace_id,
        fromEntry?.projectNumber
    )
    if (projectNumber === undefined) return { errorResponse: missingTeamProjectNumberError() }
    wsId = resolveWriteWorkspaceId(workspace_id ?? wsId, projectNumber, context.config)

    const fromErr = validateTeamEntryProjectMembership(context, wsId, from_entry_id, fromEntry, projectNumber)
    if (fromErr !== undefined) return { errorResponse: fromErr }
    const toEntry = teamDb.getEntryById(to_entry_id, wsId)
    const toErr = validateTeamEntryProjectMembership(context, wsId, to_entry_id, toEntry, projectNumber)
    if (toErr !== undefined) return { errorResponse: toErr }

    if (fromEntry?.workspaceId !== toEntry?.workspaceId) {
        return {
            errorResponse: teamRelError(
                'Cannot link team entries that belong to different workspaces',
                'VALIDATION_ERROR',
                'validation',
                'Both team entries must belong to the same workspace'
            ),
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
    context: ToolContext,
    teamDb: IDatabaseAdapter,
    initialWsId: string,
    projectNumber: number,
    entryId: number | undefined,
    tags: string[] | undefined,
    depth: number,
    limit?: number
): { wsId: string; entryIds: number[] } | { errorResponse: Record<string, unknown> } {
    let wsId = initialWsId
    if (entryId !== undefined) {
        const fromEntry = teamDb.getEntryById(entryId, wsId)
        if (fromEntry?.workspaceId !== undefined && wsId === '*') {
            wsId = fromEntry.workspaceId
        }
        if (
            !fromEntry ||
            (fromEntry.projectNumber !== projectNumber &&
                !canRealignOrphanedRegisteredProject(context, wsId, projectNumber, fromEntry))
        ) {
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
        const ids = collectNeighborhood(teamDb, entryId, depth, wsId, projectNumber, context)
        return { wsId, entryIds: limit !== undefined ? ids.slice(0, limit) : ids }
    }
    if (tags !== undefined && tags.length > 0) {
        const { entries: tagEntries } = teamDb.searchByDateRange(DATE_MIN_SENTINEL, DATE_MAX_SENTINEL, {
            tags,
            limit: limit ?? 50,
            workspaceId: wsId,
            projectNumber,
        })
        return { wsId, entryIds: tagEntries.map((e) => e.id) }
    }
    const { entries: recent } = teamDb.getRecentEntries(
        limit ?? 20,
        undefined,
        undefined,
        undefined,
        undefined,
        wsId,
        projectNumber
    )
    return { wsId, entryIds: recent.map((e) => e.id) }
}

export interface TeamVisualizeExtraOptions {
    tags?: string[]
    limit?: number
}

export function executeTeamVisualizeRelationships(
    context: ToolContext,
    teamDb: IDatabaseAdapter,
    params: unknown,
    extra?: TeamVisualizeExtraOptions
): Record<string, unknown> {
    const { entry_id, tag, depth, limit, project_number, workspace_id } =
        TeamVisualizeRelationshipsSchema.parse(params)
    const effectiveTags =
        extra?.tags !== undefined && extra.tags.length > 0
            ? extra.tags
            : tag !== undefined
              ? [tag]
              : undefined
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
        context,
        teamDb,
        initialWsId,
        projectNumber,
        entry_id,
        effectiveTags,
        depth,
        extra?.limit ?? limit
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

    const { nodes, edges } = buildRelationshipGraph(teamDb, entryIds, wsId, projectNumber, context)
    let mermaid = 'graph LR\n'
    for (const [id, label] of nodes) {
        mermaid += `  e${String(id)}["#${String(id)}: ${label}"]\n`
    }
    for (const edge of edges) {
        const safeType = edge.type.replace(/[\r\n`|]+/g, ' ')
        mermaid += `  e${String(edge.from)} -->|${safeType}| e${String(edge.to)}\n`
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
    projectNumber?: number,
    context?: ToolContext
): boolean {
    if (!entry) return false
    const wsMatches = wsId === '*' || entry.workspaceId === undefined || entry.workspaceId === wsId
    const projMatches =
        projectNumber === undefined ||
        entry.projectNumber === projectNumber ||
        (context !== undefined &&
            canRealignOrphanedRegisteredProject(context, wsId, projectNumber, entry))
    return wsMatches && projMatches
}

/** Breadth-first walk of relationships from `startId`, returning the start id plus neighbors up to `depth`. */
function collectNeighborhood(
    teamDb: IDatabaseAdapter,
    startId: number,
    depth: number,
    workspaceId: string,
    projectNumber?: number,
    context?: ToolContext
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
                return isInScopedGraphPartition(target, workspaceId, projectNumber, context)
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
    projectNumber?: number,
    context?: ToolContext
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
        const entry =
            rawEntry && isInScopedGraphPartition(rawEntry, wsId, projectNumber, context)
                ? rawEntry
                : null
        if (entry) {
            let label = entry.content.substring(0, 40).replace(/[\r\n`]+/g, ' ')
            if (entry.content.length > 40) label += '...'
            label = label.replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')')
            nodes.set(eid, label)
        }

        const rels = batchRels ? (batchRels.get(eid) ?? []) : teamDb.getRelationships(eid, wsId)
        for (const r of rels) {
            const edgeKey = `${String(r.fromEntryId)}-${String(r.toEntryId)}-${r.relationshipType}`
            if (r.fromEntryId !== r.toEntryId && !seenEdges.has(edgeKey) && entryIdSet.has(r.fromEntryId) && entryIdSet.has(r.toEntryId)) {
                seenEdges.add(edgeKey)
                edges.push({ from: r.fromEntryId, to: r.toEntryId, type: r.relationshipType })
            }
        }
    }
    // Only keep edges whose endpoints both resolved to nodes in this workspace/project;
    // links that cross into another project or workspace must not leak through.
    return { nodes, edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)) }
}

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
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
