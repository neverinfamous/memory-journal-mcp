/**
 * memory://graph neighborhood renderer.
 *
 * [INTENT] The briefing only carries one-hop pointers; this resource is the lazily-read
 * "relevant slice of the whole graph": the newest edges touching recent entries, with
 * short fenced labels and link degrees, so agents can move between journal, git and graph
 * without pulling full entry content (~400-800 tokens at defaults).
 */

import {
    isoDaysAgo,
    type RecentNeighborhood,
} from '../../database/sqlite-adapter/graph-pivots.js'
import { ValidationError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import { fenceNonCanonicalRefOrKey, markUntrustedContent } from '../../utils/security-utils.js'
import { loadProjectRegistryFromConfig } from '../../utils/workspace-resolver.js'
import { exactRegistryKey, uniqueWorkspaceForProject } from '../../utils/write-scope.js'
import {
    previewLabelText,
    resolveBriefingToolNaming,
    type BriefingToolNaming,
} from './core/briefing/graph-pivots-section.js'
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
        throw new ValidationError(
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
    naming: BriefingToolNaming
): string {
    // [BOUNDARY] Workspace ids can come from the request URI; constrain them before echoing.
    const ws = rawWs.replace(/[^A-Za-z0-9._\-/*@]/g, '_').slice(0, 128)
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
    const footer =
        naming === 'codemode'
            ? `Expand: \`mj.relationships.visualizeRelationships({ entry_id, depth: 2 })\` · Link: \`mj.relationships.linkEntries(...)\` (workspace_id: '${ws}')`
            : `Expand: \`visualize_relationships\` · Link: \`link_entries\` (workspace_id: '${ws}')`
    lines.push('', footer)
    return lines.join('\n')
}

export function buildGraphNeighborhoodMarkdown(
    uri: string,
    context: ResourceContext,
    repo: string | undefined
): string {
    const naming = resolveBriefingToolNaming(context.filterConfig)
    const { ws, unresolvedRepo } = resolveGraphWorkspace(context, repo)
    if (unresolvedRepo !== undefined) {
        const safeRepo = unresolvedRepo.replace(/[^A-Za-z0-9._\-/*@]/g, '_').slice(0, 128)
        const listHint = naming === 'codemode' ? 'mj.admin.listProjects' : 'list_projects'
        return `# Graph neighborhood · ${safeRepo} · unresolved\n'${safeRepo}' is not a registered project. Use ${listHint} (or the project registry) to find the correct repo, then re-read memory://graph/{repo}.`
    }
    const days = readIntParam(uri, 'days', DEFAULT_DAYS, 1, MAX_DAYS)
    const limit = readIntParam(uri, 'limit', DEFAULT_EDGE_LIMIT, 1, MAX_EDGE_LIMIT)
    const ctx: Partial<ResourceContext> | undefined = context
    const db = ctx?.db
    if (db === undefined || db === null || typeof db.getRecentNeighborhood !== 'function') {
        return `# Graph neighborhood\nGraph neighborhood queries are unavailable on this database adapter.`
    }
    try {
        const hood = db.getRecentNeighborhood(isoDaysAgo(days), limit, ws)
        const degrees =
            typeof db.getRelationshipDegrees === 'function' && hood.nodes.length > 0
                ? db.getRelationshipDegrees(
                      hood.nodes.map((n) => n.id),
                      ws
                  )
                : new Map<number, number>()
        return renderNeighborhood(ws, days, hood, degrees, naming)
    } catch (error) {
        logger.warning('Graph neighborhood query failed (degraded)', {
            module: 'RESOURCES',
            operation: 'graph-neighborhood',
            error: error instanceof Error ? error.message : String(error),
        })
        return `# Graph neighborhood\nGraph neighborhood is temporarily unavailable (database query failed).`
    }
}
