/**
 * Briefing — Graph Pivots Section
 *
 * Token-cheap cross-source pivots between journal entries, git commits and the
 * relationship graph (~50-80 tokens total):
 * - per-entry link degree (`↔N`, or `⚪` when unlinked)
 * - commit → entry refs (`→#id`) resolved from `auto_context.commits`
 * - recency-scoped "active threads" replacing all-time hubs
 * - 14-day unlinked rate replacing the all-time orphan ratio alert
 *
 * Disable with `--no-briefing-graph`, `BRIEFING_GRAPH=false`, config
 * `briefingGraph: false`, or `update_configuration({ briefing_graph: false })`.
 */

import { isoDaysAgo } from '../../../../database/sqlite-adapter/graph-pivots.js'
import type { ToolFilterConfig } from '../../../../filtering/tool-filter.js'
import { logger } from '../../../../utils/logger.js'
import { sliceUntrustedInline } from '../../fencing-helpers.js'
import type { ResourceContext } from '../../shared.js'

/** Recency window (days) for active threads and the unlinked rate. */
export const GRAPH_PIVOT_WINDOW_DAYS = 14
/** Maximum active threads rendered in the Graph row. */
const ACTIVE_THREAD_LIMIT = 3
/** Preview length for active-thread labels. */
const THREAD_PREVIEW_LENGTH = 40

export interface BriefingActiveThread {
    id: number
    type: string
    preview: string
    links: number
}

export interface BriefingGraphPivots {
    windowDays: number
    /** Live link degree per briefing entry id (0 = unlinked). */
    degrees: Record<number, number>
    /** Abbreviated commit hash → earliest entry id carrying it in `auto_context.commits`. */
    commitRefs: Record<string, number>
    activeThreads: BriefingActiveThread[]
    recentEntries: number
    unlinkedEntries: number
}

/** How hint strings should name operations for the active tool surface. */
export type BriefingToolNaming = 'codemode' | 'direct'

/**
 * Codemode-only surfaces cannot call direct tool names, so hints must use `mj.*` APIs.
 */
export function resolveBriefingToolNaming(filterConfig: ToolFilterConfig | null | undefined): BriefingToolNaming {
    if (!filterConfig) return 'direct'
    const enabled = filterConfig.enabledTools
    if (enabled.has('visualize_relationships') || enabled.has('get_entry_by_id')) return 'direct'
    return enabled.has('mj_execute_code') ? 'codemode' : 'direct'
}

/** First meaningful line of an entry, clipped to a short fenced label. */
export function previewLabel(content: string): string {
    const firstLine =
        content
            .split(/\r?\n/)
            .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').trim())
            .find((l) => l.length > 0) ?? ''
    const clipped =
        firstLine.length > THREAD_PREVIEW_LENGTH
            ? `${firstLine.slice(0, THREAD_PREVIEW_LENGTH).trimEnd()}…`
            : firstLine
    return sliceUntrustedInline(clipped, THREAD_PREVIEW_LENGTH + 1)
}

/**
 * Compute graph pivots for the briefing. Returns undefined when the adapter lacks the
 * pivot queries (e.g. test mocks) or every query fails, so the briefing degrades to the
 * legacy Graph row.
 */
export function buildGraphPivots(
    context: ResourceContext,
    workspaceId: string | undefined,
    entryIds: readonly number[],
    commitHashes: readonly string[],
    now: number = Date.now()
): BriefingGraphPivots | undefined {
    const ctx: Partial<ResourceContext> | undefined = context
    const db = ctx?.db
    if (
        db === undefined ||
        db === null ||
        typeof db.getRelationshipDegrees !== 'function' ||
        typeof db.getActiveThreads !== 'function' ||
        typeof db.getRecentLinkageStats !== 'function'
    ) {
        return undefined
    }
    const ws = workspaceId ?? 'default'
    const since = isoDaysAgo(GRAPH_PIVOT_WINDOW_DAYS, now)
    try {
        const degreeMap = db.getRelationshipDegrees(entryIds, ws)
        const degrees: Record<number, number> = {}
        for (const [id, degree] of degreeMap) degrees[id] = degree

        const commitRefs: Record<string, number> = {}
        if (commitHashes.length > 0 && typeof db.getEntryIdsByCommitShas === 'function') {
            const refMap = db.getEntryIdsByCommitShas(commitHashes, ws)
            for (const hash of commitHashes) {
                const id = refMap.get(hash.trim().toLowerCase())
                if (id !== undefined) commitRefs[hash] = id
            }
        }

        const activeThreads = db.getActiveThreads(since, ACTIVE_THREAD_LIMIT, ws).map((t) => ({
            id: t.entryId,
            type: t.entryType,
            preview: previewLabel(t.content),
            links: t.recentLinks,
        }))
        const stats = db.getRecentLinkageStats(since, ws)
        return {
            windowDays: GRAPH_PIVOT_WINDOW_DAYS,
            degrees,
            commitRefs,
            activeThreads,
            recentEntries: stats.recentEntries,
            unlinkedEntries: stats.unlinkedEntries,
        }
    } catch (error) {
        logger.warning('Briefing graph pivots failed (non-critical)', {
            module: 'BRIEFING',
            operation: 'graph-pivots',
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

/** ` ↔N` for linked entries, ` ⚪` for unlinked; empty when the degree is unknown. */
export function degreeSuffix(pivots: BriefingGraphPivots | undefined, entryId: number): string {
    if (!pivots) return ''
    const degree = pivots.degrees[entryId]
    if (degree === undefined) return ''
    return degree > 0 ? ` ↔${String(degree)}` : ' ⚪'
}

/** Unlinked ratio worth surfacing as a health alert (enough samples, > 30% unlinked). */
export function isRecentUnlinkedAlert(pivots: BriefingGraphPivots | undefined): boolean {
    if (!pivots || pivots.recentEntries < 5) return false
    return pivots.unlinkedEntries / pivots.recentEntries > 0.3
}
