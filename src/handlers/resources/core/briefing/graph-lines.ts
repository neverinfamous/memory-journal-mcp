/**
 * Briefing — Graph row rendering.
 *
 * Legacy mode (pivots disabled): totals, causal counts, all-time hubs (now with previews).
 * Pivot mode: totals + density + 14-day unlinked rate, recency-scoped active threads
 * (falling back to all-time hubs), causal counts, and one-hop expansion pointers.
 */

import type { GraphSummary } from './context-section.js'
import type { BriefingGraphPivots, BriefingToolNaming } from './graph-pivots-section.js'

export interface GraphLineOptions {
    graphPivots?: BriefingGraphPivots
    toolNaming?: BriefingToolNaming
    workspaceId?: string
    relationshipDensity?: number
}

const escapeCell = (text: string): string =>
    text.replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')

function causalText(graphSummary: GraphSummary): string {
    return (
        Object.entries(graphSummary.causalMetrics)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${String(count)}`)
            .join(', ') || 'none'
    )
}

function hubsText(graphSummary: GraphSummary): string {
    return graphSummary.topHubs
        .map((h) => `#${String(h.id)}${h.preview ? ` ${h.preview}` : ''}`.trim())
        .join(', ')
}

function expandHint(toolNaming: BriefingToolNaming | undefined): string {
    return toolNaming === 'codemode'
        ? '`mj.relationships.visualizeRelationships({ entry_id, depth: 2 })`'
        : '`visualize_relationships`'
}

export function buildGraphLines(
    graphSummary: GraphSummary | undefined,
    opts: GraphLineOptions = {}
): string[] {
    if (!graphSummary || graphSummary.totalRelationships === 0) return []
    const pivots = opts.graphPivots
    const orphanAlert =
        pivots === undefined && graphSummary.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2
            ? '🔴 '
            : ''

    if (pivots === undefined) {
        let graphText = `${orphanAlert}${String(graphSummary.totalRelationships)} relationships<br>Causal: ${escapeCell(causalText(graphSummary))} (use ${expandHint(opts.toolNaming)})`
        if (graphSummary.topHubs.length > 0) {
            graphText += `<br>Context Hubs: ${escapeCell(hubsText(graphSummary))}`
        }
        return [graphText]
    }

    const headParts = [`${String(graphSummary.totalRelationships)} relationships`]
    if (opts.relationshipDensity !== undefined) {
        headParts.push(`🔗 density ${escapeCell(String(opts.relationshipDensity))}`)
    }
    if (pivots.recentEntries > 0) {
        const warn = pivots.unlinkedEntries / pivots.recentEntries > 0.3 ? ' ⚠️' : ''
        headParts.push(
            `Unlinked (${String(pivots.windowDays)}d): ${String(pivots.unlinkedEntries)}/${String(pivots.recentEntries)}${warn}`
        )
    }
    const lines = [headParts.join(' · ')]

    if (pivots.activeThreads.length > 0) {
        const threads = pivots.activeThreads
            .map((t) => `#${String(t.id)} (${t.type}) ${t.preview} ↔${String(t.links)}`)
            .join(', ')
        lines.push(`Active threads (${String(pivots.windowDays)}d): ${escapeCell(threads)}`)
    } else if (graphSummary.topHubs.length > 0) {
        lines.push(`Hubs (all-time): ${escapeCell(hubsText(graphSummary))}`)
    }

    lines.push(`Causal: ${escapeCell(causalText(graphSummary))}`)
    const neighborhood =
        opts.workspaceId !== undefined && opts.workspaceId !== '' && opts.workspaceId !== '*'
            ? ` · Neighborhood: \`memory://graph/${escapeCell(opts.workspaceId)}\``
            : ' · Neighborhood: `memory://graph`'
    lines.push(`Expand: ${expandHint(opts.toolNaming)}${neighborhood}`)
    return [lines.join('<br>')]
}
