/**
 * Briefing — Graph row rendering.
 *
 * Legacy mode (pivots disabled): totals, causal counts, all-time hubs (now with previews).
 * Pivot mode: totals + density + 14-day unlinked rate, recency-scoped active threads
 * (falling back to all-time hubs), causal counts, and one-hop expansion pointers.
 */

import type { GraphSummary } from './context-section.js'
import {
    isRecentUnlinkedAlert,
    type BriefingGraphPivots,
    type BriefingToolNaming,
} from './graph-pivots-section.js'
import {
    escapeCell,
    fenceUntrustedList,
    sanitizeDisplayIdentifier,
} from '../../fencing-helpers.js'

export interface GraphLineOptions {
    graphPivots?: BriefingGraphPivots
    toolNaming?: BriefingToolNaming
    /** Pre-resolved expansion hint (overrides `toolNaming` for mixed presets like `starter`). */
    expandToolHint?: string
    workspaceId?: string
    relationshipDensity?: number
}

function causalText(graphSummary: GraphSummary): string {
    return (
        Object.entries(graphSummary.causalMetrics)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${String(count)}`)
            .join(', ') || 'none'
    )
}

function hubsText(graphSummary: GraphSummary): string {
    return fenceUntrustedList(
        graphSummary.topHubs.map((h) => `#${String(h.id)}${h.preview ? ` ${h.preview}` : ''}`.trim())
    )
}

function expandHint(opts: GraphLineOptions): string {
    if (opts.expandToolHint !== undefined) return `\`${opts.expandToolHint}\``
    return opts.toolNaming === 'codemode'
        ? '`mj.relationships.visualizeRelationships({ entry_id, depth: 2 })`'
        : '`visualize_relationships`'
}

export function buildGraphLines(
    graphSummary: GraphSummary | undefined,
    opts: GraphLineOptions = {}
): string[] {
    const pivots = opts.graphPivots
    const hasRecentUnlinkedPivot = pivots !== undefined && pivots.unlinkedEntries > 0
    if (!graphSummary || (graphSummary.totalRelationships === 0 && !hasRecentUnlinkedPivot)) {
        return []
    }
    const orphanAlert =
        pivots === undefined && graphSummary.orphanRatio !== undefined && graphSummary.orphanRatio > 0.2
            ? '🔴 '
            : ''

    if (pivots === undefined) {
        let graphText = `${orphanAlert}${String(graphSummary.totalRelationships)} relationships<br>Causal: ${escapeCell(causalText(graphSummary))} (use ${expandHint(opts)})`
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
        // [INVARIANT] Same threshold as the Journal Health alert (≥5 samples, >30% unlinked).
        const warn = isRecentUnlinkedAlert(pivots) ? ' ⚠️' : ''
        headParts.push(
            `Unlinked (${String(pivots.windowDays)}d): ${String(pivots.unlinkedEntries)}/${String(pivots.recentEntries)}${warn}`
        )
    }
    const lines = [headParts.join(' · ')]

    if (pivots.activeThreads.length > 0) {
        // [INTENT] `(+N)` marks recent-window links distinctly from all-time `↔N` entry degrees.
        const threads = fenceUntrustedList(
            pivots.activeThreads.map((t) => `#${String(t.id)} (${t.type}) ${t.preview} (+${String(t.links)})`)
        )
        lines.push(`Active threads (${String(pivots.windowDays)}d): ${escapeCell(threads)}`)
    } else if (graphSummary.topHubs.length > 0) {
        lines.push(`Hubs (all-time): ${escapeCell(hubsText(graphSummary))}`)
    }

    lines.push(`Causal: ${escapeCell(causalText(graphSummary))}`)
    const neighborhood =
        opts.workspaceId !== undefined && opts.workspaceId !== '' && opts.workspaceId !== '*'
            ? ` · Neighborhood: \`memory://graph/${sanitizeDisplayIdentifier(opts.workspaceId)}\``
            : ' · Neighborhood: `memory://graph`'
    lines.push(`Expand: ${expandHint(opts)}${neighborhood}`)
    return [lines.join('<br>')]
}
