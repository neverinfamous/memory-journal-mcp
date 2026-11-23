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
import { extractPreview } from './preview-helpers.js'

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

/**
 * Resolve a single tool hint accurately across mixed presets (`starter`, `essential`, `readonly`,
 * `codemode`, `full`): prefers direct tool name when that specific tool is enabled, otherwise
 * `mj.*` when Code Mode (`mj_execute_code`) is enabled.
 */
export function resolveToolHintName(
    filterConfig: ToolFilterConfig | null | undefined,
    directToolName: string,
    codemodeHint: string,
    directHint: string = directToolName
): string {
    if (!filterConfig) return directHint
    const enabled = filterConfig.enabledTools
    if (enabled.has(directToolName)) return directHint
    return enabled.has('mj_execute_code') ? codemodeHint : directHint
}

/** Unfenced first meaningful line of an entry, clipped for labels (shared preview rules). */
export function previewLabelText(content: string): string {
    return extractPreview(content, THREAD_PREVIEW_LENGTH, { firstLineOnly: true })
}

/** First meaningful line of an entry, clipped to a short fenced label. */
export function previewLabel(content: string): string {
    return sliceUntrustedInline(previewLabelText(content), THREAD_PREVIEW_LENGTH + 1)
}

function logPivotSubqueryError(operation: string, error: unknown): void {
    logger.warning(`Briefing graph pivot subquery '${operation}' failed (non-critical)`, {
        module: 'BRIEFING',
        operation,
        error: error instanceof Error ? error.message : String(error),
    })
}

function safeLoadDegrees(
    db: NonNullable<ResourceContext['db']>,
    entryIds: readonly number[],
    ws: string
): { degrees: Record<number, number>; ok: boolean } {
    if (typeof db.getRelationshipDegrees !== 'function') return { degrees: {}, ok: false }
    try {
        const degreeMap = db.getRelationshipDegrees(entryIds, ws)
        const degrees: Record<number, number> = {}
        for (const [id, degree] of degreeMap) degrees[id] = degree
        return { degrees, ok: true }
    } catch (error) {
        logPivotSubqueryError('graph-pivots-degrees', error)
        return { degrees: {}, ok: false }
    }
}

function safeLoadCommitRefs(
    db: NonNullable<ResourceContext['db']>,
    commitHashes: readonly string[],
    ws: string
): Record<string, number> {
    const commitRefs: Record<string, number> = {}
    if (commitHashes.length === 0 || typeof db.getEntryIdsByCommitShas !== 'function') {
        return commitRefs
    }
    try {
        const refMap = db.getEntryIdsByCommitShas(commitHashes, ws)
        for (const hash of commitHashes) {
            const id = refMap.get(hash.trim().toLowerCase())
            if (id !== undefined) commitRefs[hash] = id
        }
    } catch (error) {
        logPivotSubqueryError('graph-pivots-commits', error)
    }
    return commitRefs
}

/**
 * Compute graph pivots for the briefing. Returns undefined when the adapter lacks the
 * pivot queries (e.g. test mocks) or every core pivot query fails, so the briefing
 * degrades to the legacy Graph row.
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
    const { degrees, ok: degreesOk } = safeLoadDegrees(db, entryIds, ws)
    const commitRefs = safeLoadCommitRefs(db, commitHashes, ws)

    let activeThreads: BriefingActiveThread[] = []
    let threadsOk = false
    try {
        activeThreads = db.getActiveThreads(since, ACTIVE_THREAD_LIMIT, ws).map((t) => ({
            id: t.entryId,
            type: t.entryType,
            preview: previewLabel(t.content),
            links: t.recentLinks,
        }))
        threadsOk = true
    } catch (error) {
        logPivotSubqueryError('graph-pivots-threads', error)
    }

    let stats = { recentEntries: 0, unlinkedEntries: 0 }
    let statsOk = false
    try {
        stats = db.getRecentLinkageStats(since, ws)
        statsOk = true
    } catch (error) {
        logPivotSubqueryError('graph-pivots-linkage', error)
    }

    if (!degreesOk && !threadsOk && !statsOk) return undefined
    return {
        windowDays: GRAPH_PIVOT_WINDOW_DAYS,
        degrees,
        commitRefs,
        activeThreads,
        recentEntries: stats.recentEntries,
        unlinkedEntries: stats.unlinkedEntries,
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
