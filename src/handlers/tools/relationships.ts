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
import { probeMatchingTeamEntry } from './search/helpers.js'
import { enforceAccessBoundary } from '../../auth/validation.js'
import { TEAM_DB_ERROR_RESPONSE, assertCanonicalFallbackToolAllowed } from './team/helpers.js'
import { enforceTeamRbac, getCallerIdentity } from './team/rbac.js'
import { executeTeamVisualizeRelationships } from './team/relationship-tools.js'
import { extractPreview, redactHomePaths } from '../resources/core/briefing/preview-helpers.js'
import { isRecord } from '../../utils/type-guards.js'
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

type LinkEntriesInput = ReturnType<typeof LinkEntriesSchema.parse>

function validateLinkTargets(
    db: ToolContext['db'],
    input: LinkEntriesInput,
    wsId: string
): Record<string, unknown> | undefined {
    // Guard: self-referential links are not meaningful
    if (input.from_entry_id === input.to_entry_id) {
        return { ...formatHandlerError(new ValidationError('Cannot link an entry to itself')), success: false }
    }
    // Guard: both entries must exist and not be soft-deleted.
    const fromEntry = db.getEntryById(input.from_entry_id, wsId)
    if (!fromEntry || fromEntry.deletedAt) {
        return { ...formatHandlerError(new ResourceNotFoundError('Entry', String(input.from_entry_id))), success: false }
    }
    const toEntry = db.getEntryById(input.to_entry_id, wsId)
    if (!toEntry || toEntry.deletedAt) {
        return { ...formatHandlerError(new ResourceNotFoundError('Entry', String(input.to_entry_id))), success: false }
    }
    if (fromEntry.workspaceId !== toEntry.workspaceId) {
        return {
            ...formatHandlerError(new ValidationError('Cannot link entries that belong to different workspaces')),
            success: false,
        }
    }
    if (
        input.project_number !== undefined &&
        (fromEntry.projectNumber !== input.project_number || toEntry.projectNumber !== input.project_number)
    ) {
        const foreignId =
            fromEntry.projectNumber !== input.project_number ? input.from_entry_id : input.to_entry_id
        return { ...formatHandlerError(new ResourceNotFoundError('Entry', String(foreignId))), success: false }
    }
    return undefined
}

function executeLinkEntries(params: unknown, context: ToolContext): Record<string, unknown> {
    const { db } = context
    let input: LinkEntriesInput | undefined
    try {
        input = LinkEntriesSchema.parse(LinkEntriesSchemaMcp.parse(params))
        // [INVARIANT] H4: '*' is a read-only wildcard; links are writes and must be scoped.
        const wsId = resolveWriteWorkspaceId(input.workspace_id, input.project_number, context.config)
        const targetError = validateLinkTargets(db, input, wsId)
        if (targetError !== undefined) return targetError

        // Reverse direction (B->A when A->B exists) is intentionally allowed.
        const { from_entry_id, to_entry_id, relationship_type } = input
        const existing = db
            .getRelationships(from_entry_id, wsId)
            .find(
                (r) =>
                    r.fromEntryId === from_entry_id &&
                    r.toEntryId === to_entry_id &&
                    r.relationshipType === relationship_type
            )
        if (existing) {
            return {
                success: true,
                relationship: existing,
                duplicate: true,
                message: 'Relationship already exists',
            }
        }
        const relationship = db.linkEntries(
            input.from_entry_id,
            input.to_entry_id,
            input.relationship_type,
            input.description,
            wsId
        )
        return { success: true, relationship }
    } catch (error) {
        if (input !== undefined) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error'
            if (errMsg.includes('FOREIGN KEY constraint failed')) {
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
        return { ...formatHandlerError(error) }
    }
}

const MERMAID_REL_SYMBOLS: Record<string, string> = {
    references: '-->',
    implements: '==>',
    clarifies: '-.->',
    evolves_from: '-->',
    response_to: '<-->',
    blocked_by: '--x',
    resolved: '==>',
    caused: '-.->',
}

function buildRelationshipMermaid(
    results: ReturnType<ToolContext['db']['visualizeRelationships']>
): string {
    const MERMAID_CONTENT_PREVIEW_LENGTH = 40
    const mermaidLines: string[] = ['```mermaid', 'graph TD']
    for (const node of results.nodes) {
        const rawContent = node.metadata?.['content']
        const content = typeof rawContent === 'string' ? rawContent : ''
        const extracted = extractPreview(content, MERMAID_CONTENT_PREVIEW_LENGTH, { firstLineOnly: true })
        const contentPreview = extracted
            .replace(/[\r\n`]+/g, ' ')
            .replace(/"/g, "'")
            .replace(/\[/g, '(')
            .replace(/\]/g, ')')
        const entryTypeShort = (node.group || '').slice(0, 20).replace(/[\r\n`"]+/g, ' ')
        mermaidLines.push(`    E${node.id}["#${node.id}: ${contentPreview}<br/>${entryTypeShort}"]`)
    }
    mermaidLines.push('')
    for (const edge of results.edges) {
        const arrow = Object.hasOwn(MERMAID_REL_SYMBOLS, edge.type) ? MERMAID_REL_SYMBOLS[edge.type] : '-->'
        const safeEdgeType = edge.type.replace(/[\r\n`|]+/g, '_')
        mermaidLines.push(`    E${String(edge.from)} ${arrow}|${safeEdgeType}| E${String(edge.to)}`)
    }
    mermaidLines.push('')
    for (const node of results.nodes) {
        const isPersonal = Boolean(node.metadata?.['is_personal'])
        mermaidLines.push(`    style E${node.id} fill:${isPersonal ? '#E3F2FD' : '#FFF3E0'}`)
    }
    mermaidLines.push('```')
    return mermaidLines.join('\n')
}

type VisualizeInput = ReturnType<typeof VisualizeInputSchema.parse>

interface TeamVisualizeNode {
    id: number
    label: string
}

interface TeamVisualizeEdge {
    from: number
    to: number
    type: string
}

function parseTeamVisualizeNodes(raw: unknown): TeamVisualizeNode[] {
    if (!Array.isArray(raw)) return []
    const out: TeamVisualizeNode[] = []
    for (const item of raw) {
        if (isRecord(item) && typeof item['id'] === 'number' && typeof item['label'] === 'string') {
            out.push({ id: item['id'], label: item['label'] })
        }
    }
    return out
}

function parseTeamVisualizeEdges(raw: unknown): TeamVisualizeEdge[] {
    if (!Array.isArray(raw)) return []
    const out: TeamVisualizeEdge[] = []
    for (const item of raw) {
        if (
            isRecord(item) &&
            typeof item['from'] === 'number' &&
            typeof item['to'] === 'number' &&
            typeof item['type'] === 'string'
        ) {
            out.push({ from: item['from'], to: item['to'], type: item['type'] })
        }
    }
    return out
}

function formatTeamVisualizePayload(
    input: VisualizeInput,
    teamRes: Record<string, unknown>
): Record<string, unknown> {
    const rawNodes = parseTeamVisualizeNodes(teamRes['nodes'])
    const rawEdges = parseTeamVisualizeEdges(teamRes['edges'])
    const edges =
        input.relationship_type !== undefined
            ? rawEdges.filter((e) => e.type === input.relationship_type)
            : rawEdges
    let filteredNodes = rawNodes
    if (input.relationship_type !== undefined) {
        const connectedIds = new Set<number>()
        for (const e of edges) {
            connectedIds.add(e.from)
            connectedIds.add(e.to)
        }
        if (input.entry_id !== undefined) {
            connectedIds.add(input.entry_id)
        }
        filteredNodes = rawNodes.filter((n) => connectedIds.has(n.id))
    }
    const omitContent = !input.include_content
    const nodes = omitContent
        ? filteredNodes.map((n) => ({ id: n.id, label: `#${String(n.id)}` }))
        : filteredNodes
    const format = input.format
    let mermaid: string | undefined
    if (format !== 'edges') {
        const needsRebuild = input.relationship_type !== undefined || omitContent
        if (!needsRebuild && typeof teamRes['mermaid'] === 'string') {
            mermaid = teamRes['mermaid']
        } else {
            const lines = ['graph LR']
            for (const n of nodes) {
                const nodeText = omitContent ? `#${String(n.id)}` : `#${String(n.id)}: ${n.label}`
                lines.push(`  e${String(n.id)}["${nodeText}"]`)
            }
            for (const e of edges) {
                const safeType = e.type.replace(/[\r\n`|]+/g, ' ')
                lines.push(`  e${String(e.from)} -->|${safeType}| e${String(e.to)}`)
            }
            mermaid = `${lines.join('\n')}\n`
        }
    }
    return {
        success: true,
        entry_count: nodes.length,
        relationship_count: edges.length,
        root_entry: input.entry_id ?? null,
        depth: input.depth,
        ...(mermaid !== undefined ? { mermaid } : {}),
        ...(format !== 'mermaid' ? { nodes, edges } : {}),
    }
}

function delegateTeamVisualizeRelationships(
    input: VisualizeInput,
    wsId: string,
    context: ToolContext
): Record<string, unknown> {
    assertCanonicalFallbackToolAllowed('team_visualize_relationships', 'team', context, true)
    enforceAccessBoundary(
        'team_visualize_relationships',
        'tool',
        { requiresTeamScope: true },
        context.config?.runtime?.auditLogger
    )
    if (!context.teamDb) {
        return { ...TEAM_DB_ERROR_RESPONSE }
    }
    enforceTeamRbac(context, getCallerIdentity(), 'viewer', wsId)
    const teamRes = executeTeamVisualizeRelationships(
        context,
        context.teamDb,
        {
            ...(input.entry_id !== undefined ? { entry_id: input.entry_id } : {}),
            ...(input.tags?.[0] !== undefined ? { tag: input.tags[0] } : {}),
            depth: input.depth,
            ...(input.project_number !== undefined ? { project_number: input.project_number } : {}),
            ...(input.workspace_id !== undefined ? { workspace_id: input.workspace_id } : {}),
        },
        {
            ...(input.tags !== undefined && input.tags.length > 0 ? { tags: input.tags } : {}),
            limit: input.limit,
        }
    )
    if (teamRes['success'] === false) {
        return teamRes
    }
    return formatTeamVisualizePayload(input, teamRes)
}

function assertPersonalVisualizeSeedExists(
    input: VisualizeInput,
    wsId: string,
    context: ToolContext
): Record<string, unknown> | undefined {
    if (input.entry_id === undefined) return undefined
    const entry = context.db.getEntryById(input.entry_id, wsId)
    const foreignProject =
        input.project_number !== undefined && entry?.projectNumber !== input.project_number
    if (entry && !entry.deletedAt && !foreignProject) return undefined

    const baseErr = {
        ...formatHandlerError(new ResourceNotFoundError('Entry', String(input.entry_id))),
        success: false,
    }
    if (
        !entry &&
        probeMatchingTeamEntry(
            context,
            input.entry_id,
            wsId,
            input.project_number,
            'team_visualize_relationships'
        )
    ) {
        return {
            ...baseErr,
            suggestion: `No personal entry #${String(input.entry_id)} was found in workspace '${wsId}', but team entry #${String(input.entry_id)} exists in the team database. Call team_visualize_relationships (or mj.team.teamVisualizeRelationships) instead.`,
        }
    }
    return baseErr
}

function executeVisualizeRelationships(params: unknown, context: ToolContext): Record<string, unknown> {
    const { db } = context
    const input = VisualizeInputSchema.parse(VisualizeInputSchemaMcp.parse(params))
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    if (input.source === 'team') {
        return delegateTeamVisualizeRelationships(input, wsId, context)
    }
    const projectNumber = alignedProjectFilter(
        wsId,
        input.project_number,
        activeProjectRegistry(context.config?.projectRegistry)
    )
    const seedError = assertPersonalVisualizeSeedExists(input, wsId, context)
    if (seedError !== undefined) return seedError

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
    const format = input.format
    const nodes = input.include_content ? results.nodes : compactNodeContent(results.nodes)
    return {
        entry_count: results.nodes.length,
        relationship_count: results.edges.length,
        root_entry: input.entry_id ?? null,
        depth: input.depth,
        // [INTENT] Mermaid labels come from full content, so build the diagram before compaction.
        ...(format !== 'edges' ? { mermaid: buildRelationshipMermaid(results) } : {}),
        ...(format !== 'mermaid' ? { nodes, edges: results.edges } : {}),
    }
}

/** Preview length for node metadata content when `include_content` is false. */
const NODE_CONTENT_PREVIEW_LENGTH = 120

function compactNodeContent(
    nodes: ReturnType<ToolContext['db']['visualizeRelationships']>['nodes']
): ReturnType<ToolContext['db']['visualizeRelationships']>['nodes'] {
    return nodes.map((node) => {
        const raw = node.metadata?.['content']
        if (typeof raw !== 'string') return node
        const compacted =
            raw.length <= NODE_CONTENT_PREVIEW_LENGTH
                ? redactHomePaths(raw)
                : extractPreview(raw, NODE_CONTENT_PREVIEW_LENGTH)
        if (compacted === raw) return node
        return {
            ...node,
            metadata: { ...node.metadata, content: compacted },
        }
    })
}

export function getRelationshipTools(context: ToolContext): ToolDefinition[] {
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
            handler: (params: unknown) => executeLinkEntries(params, context),
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
                    return executeVisualizeRelationships(params, context)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
