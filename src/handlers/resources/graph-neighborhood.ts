/**
 * memory://graph neighborhood renderer.
 *
 * [INTENT] The briefing only carries one-hop pointers; this resource is the lazily-read
 * "relevant slice of the whole graph": the newest edges touching recent entries, with
 * short fenced labels and link degrees, so agents can move between journal, git and graph
 * without pulling full entry content (~400-800 tokens at defaults).
 */

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import {
    isoDaysAgo,
    type RecentNeighborhood,
} from '../../database/sqlite-adapter/graph-pivots.js'
import { isFilterEffectivelyReadOnly } from '../../filtering/tool-filter.js'
import { logger } from '../../utils/logger.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { fenceNonCanonicalRefOrKey, markUntrustedContent } from '../../utils/security-utils.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../utils/write-scope.js'
import {
    previewLabelText,
    resolveToolHintName,
} from './core/briefing/graph-pivots-section.js'
import { sanitizeDisplayIdentifier } from './fencing-helpers.js'
import { resourceWorkspace, type ResourceContext } from './shared.js'

const DEFAULT_DAYS = 14
const MAX_DAYS = 90
/** ~600 tokens at defaults (edges cap nodes at ≤ 2× limit). */
const DEFAULT_EDGE_LIMIT = 15
const MAX_EDGE_LIMIT = 100
const MAX_UNLINKED_IDS = 20

function readIntParam(uri: string, key: string, fallback: number, min: number, max: number): number {
    const queryIdx = uri.indexOf('?')
    if (queryIdx === -1) return fallback
    const hashIdx = uri.indexOf('#', queryIdx)
    const raw = new URLSearchParams(hashIdx === -1 ? uri.slice(queryIdx + 1) : uri.slice(queryIdx + 1, hashIdx)).get(key)
    if (raw === null || !/^\d+$/.test(raw.trim())) return fallback
    return Math.min(max, Math.max(min, Number.parseInt(raw.trim(), 10)))
}

function resolveGraphWorkspace(
    context: ResourceContext,
    repo: string | undefined
): { ws: string; unresolvedRepo?: string } {
    if (repo === undefined || repo.trim() === '') return { ws: resourceWorkspace(context) }
    const trimmed = repo.trim()
    if (trimmed === '*') {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            "Wildcard '*' is not supported for memory://graph/{+repo}. Specify a concrete repository name."
        )
    }
    if (trimmed.toLowerCase() === 'default') return { ws: 'default' }
    const registry = context.briefingConfig?.projectRegistry ?? loadProjectRegistryFromConfig()
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    const numericTarget = /^#?(\d+)$/.exec(trimmed)
    const parsedNum =
        numericTarget?.[1] !== undefined ? parseCanonicalPositiveInt(numericTarget[1]) : undefined
    const matched =
        exactRegistryKey(trimmed, registry) ??
        (parsedNum !== undefined ? uniqueWorkspaceForProject(parsedNum, registry) : undefined)
    if (matched !== undefined) return { ws: matched }
    const configuredDefaultWs = context.briefingConfig?.defaultWorkspaceId?.trim()
    if (configuredDefaultWs?.toLowerCase() === trimmed.toLowerCase()) {
        return { ws: configuredDefaultWs }
    }
    if (hasRegistry) {
        return { ws: trimmed, unresolvedRepo: trimmed }
    }
    return { ws: trimmed }
}

function renderNeighborhood(
    rawWs: string,
    days: number,
    hood: RecentNeighborhood,
    degrees: Map<number, number>,
    filterConfig: ResourceContext['filterConfig']
): string {
    // [BOUNDARY] Workspace ids can come from the request URI; constrain them before echoing.
    const ws = sanitizeDisplayIdentifier(rawWs)
    const lines: string[] = [
        `# Graph neighborhood · ${ws} · last ${String(days)}d`,
        `${String(hood.nodes.length)} nodes · ${String(hood.edges.length)} edges (newest first) · unlinked ${String(hood.unlinkedIds.length)}/${String(hood.recentEntries)} recent entries`,
    ]
    if (hood.edges.length > 0) {
        // [INTENT] One block fence around all node labels instead of ~53 chars of wrapper per node.
        const nodeLines = hood.nodes.map((n) => {
            const degree = degrees.get(n.id)
            const degreeText = degree !== undefined ? ` ↔${String(degree)}` : ''
            return `- #${String(n.id)} ${n.entryType}${degreeText} ${n.timestamp.slice(5, 10)} — ${previewLabelText(n.content)}`
        })
        lines.push('', '## Nodes', markUntrustedContent(nodeLines.join('\n')))
        lines.push('', '## Edges')
        for (const e of hood.edges) {
            lines.push(`- #${String(e.from)} -${fenceNonCanonicalRefOrKey(e.type)}-> #${String(e.to)}`)
        }
    }
    if (hood.unlinkedIds.length > 0) {
        const shown = hood.unlinkedIds.slice(0, MAX_UNLINKED_IDS).map((id) => `#${String(id)}`)
        const more = hood.unlinkedIds.length > MAX_UNLINKED_IDS ? ` (+${String(hood.unlinkedIds.length - MAX_UNLINKED_IDS)} more)` : ''
        lines.push('', `## Unlinked (${String(days)}d)`, `${shown.join(' ')}${more}`)
    }
    const expandTool = resolveToolHintName(
        filterConfig,
        'visualize_relationships',
        'mj.relationships.visualizeRelationships({ entry_id, depth: 2 })'
    )
    const isReadonly = filterConfig ? isFilterEffectivelyReadOnly(filterConfig) : false
    const linkSegment = isReadonly
        ? ''
        : ` · Link: \`${resolveToolHintName(filterConfig, 'link_entries', 'mj.relationships.linkEntries(...)')}\``
    lines.push('', `Expand: \`${expandTool}\`${linkSegment} (workspace_id: '${ws}')`)
    return lines.join('\n')
}

export function buildGraphNeighborhoodMarkdown(
    uri: string,
    context: ResourceContext,
    repo: string | undefined
): string {
    const { ws, unresolvedRepo } = resolveGraphWorkspace(context, repo)
    if (unresolvedRepo !== undefined) {
        const safeRepo = sanitizeDisplayIdentifier(unresolvedRepo)
        const listHint = resolveToolHintName(
            context.filterConfig,
            'list_projects',
            'mj.admin.listProjects'
        )
        return `# Graph neighborhood · ${safeRepo} · unresolved\n'${safeRepo}' is not a registered project. Use ${listHint} (or the project registry) to find the correct repo, then re-read memory://graph/{repo}.`
    }
    const days = readIntParam(uri, 'days', DEFAULT_DAYS, 1, MAX_DAYS)
    const limit = readIntParam(uri, 'limit', DEFAULT_EDGE_LIMIT, 1, MAX_EDGE_LIMIT)
    const ctx: Partial<ResourceContext> | undefined = context
    const db = ctx?.db
    if (db === undefined || db === null || typeof db.getRecentNeighborhood !== 'function') {
        return `# Graph neighborhood\nGraph neighborhood queries are unavailable on this database adapter.`
    }
    let hood: RecentNeighborhood
    try {
        hood = db.getRecentNeighborhood(isoDaysAgo(days), limit, ws)
    } catch (error) {
        logger.warning('Graph neighborhood query failed (degraded)', {
            module: 'RESOURCES',
            operation: 'graph-neighborhood',
            error: error instanceof Error ? error.message : String(error),
        })
        return `# Graph neighborhood\nGraph neighborhood is temporarily unavailable (database query failed).`
    }
    let degrees = new Map<number, number>()
    if (typeof db.getRelationshipDegrees === 'function' && hood.nodes.length > 0) {
        try {
            degrees = db.getRelationshipDegrees(
                hood.nodes.map((n) => n.id),
                ws
            )
        } catch (error) {
            logger.warning('Graph neighborhood degree lookup failed (non-critical)', {
                module: 'RESOURCES',
                operation: 'graph-neighborhood-degrees',
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
    return renderNeighborhood(ws, days, hood, degrees, context.filterConfig)
}
