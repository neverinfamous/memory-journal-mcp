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
        let contentPreview = content
            .slice(0, MERMAID_CONTENT_PREVIEW_LENGTH)
            .replace(/[\r\n`]+/g, ' ')
        if (content.length > MERMAID_CONTENT_PREVIEW_LENGTH) contentPreview += '...'
        contentPreview = contentPreview.replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')')
        const entryTypeShort = (node.group || '').slice(0, 20).replace(/[\r\n`"]+/g, ' ')
        mermaidLines.push(`    E${node.id}["#${node.id}: ${contentPreview}<br/>${entryTypeShort}"]`)
    }
    mermaidLines.push('')
    for (const edge of results.edges) {
        const arrow = MERMAID_REL_SYMBOLS[edge.type] ?? '-->'
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

function executeVisualizeRelationships(params: unknown, context: ToolContext): Record<string, unknown> {
    const { db } = context
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
            input.project_number !== undefined && entry?.projectNumber !== input.project_number
        if (!entry || entry.deletedAt || foreignProject) {
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
    return {
        entry_count: results.nodes.length,
        relationship_count: results.edges.length,
        root_entry: input.entry_id ?? null,
        depth: input.depth,
        mermaid: buildRelationshipMermaid(results),
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
