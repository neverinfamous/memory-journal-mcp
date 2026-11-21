/**
 * Briefing Insights Section
 *
 * Formats a DigestSnapshot into a compact briefing section (~50 tokens).
 * Uses live compute with a 60s TTL cache, falling back to persisted DB snapshots.
 */

import {
    parseDigestSnapshot,
    type DigestSnapshot,
} from '../../../../database/sqlite-adapter/entries/digest.js'
import type { ResourceContext } from '../../shared.js'
import { resourceWorkspace, sliceUntrustedInline } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'

/** Compact insights payload for the briefing JSON */
export interface BriefingInsights {
    activityTrend: string
    significanceSpike: string | null
    staleProjects: { projectNumber: number; daysSilent: number }[]
    topImportance: { id: number; score: number; preview: string }[]
    relationshipDensity?: number
}

// ============================================================================
// TTL Cache — avoids recomputing live digest on every briefing read
// ============================================================================

/** Cached live digest by DB instance and workspace ID, with bounded expiry */
const liveDigestCache = new WeakMap<
    object,
    Map<string, { snapshot: DigestSnapshot; expiresAt: number }>
>()

/** Cache TTL in milliseconds (60 seconds) */
const LIVE_DIGEST_TTL_MS = 60_000
const MAX_DIGEST_CACHE_WORKSPACES = 64

function writeLiveDigestCache(
    dbCacheKey: object | undefined,
    existingByWs: Map<string, { snapshot: DigestSnapshot; expiresAt: number }> | undefined,
    effectiveWorkspace: string,
    snapshot: DigestSnapshot,
    expiresAt: number
): void {
    if (dbCacheKey === undefined) return
    let wsMap = existingByWs
    if (wsMap === undefined) {
        wsMap = new Map()
        liveDigestCache.set(dbCacheKey, wsMap)
    }
    if (wsMap.size >= MAX_DIGEST_CACHE_WORKSPACES && !wsMap.has(effectiveWorkspace)) {
        const oldest = wsMap.keys().next().value
        if (oldest !== undefined) wsMap.delete(oldest)
    }
    wsMap.set(effectiveWorkspace, { snapshot, expiresAt })
}

function resolvePersistedDigest(
    context: ResourceContext,
    effectiveWorkspace: string,
    allowRawPersisted: boolean
): { snapshot: unknown; source: 'persisted'; computedAt?: string } | null {
    const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest', effectiveWorkspace)
    if (!dbSnapshot) return null
    const parsed = parseDigestSnapshot(dbSnapshot.data)
    if (parsed !== null) {
        return { snapshot: parsed, source: 'persisted', computedAt: dbSnapshot.createdAt }
    }
    if (allowRawPersisted && dbSnapshot.data !== undefined && dbSnapshot.data !== null) {
        return { snapshot: dbSnapshot.data, source: 'persisted', computedAt: dbSnapshot.createdAt }
    }
    return null
}

/**
 * Resolve and cache the latest live digest snapshot for `dbObj` + `effectiveWorkspace` (60s TTL),
 * or return the persisted DB snapshot when live compute is unavailable.
 */
export function resolveCachedOrLiveDigest(
    context: ResourceContext,
    workspaceId?: string
): { snapshot: DigestSnapshot; source: 'computed' | 'persisted'; computedAt?: string } | null
export function resolveCachedOrLiveDigest(
    context: ResourceContext,
    workspaceId: string | undefined,
    options: { allowRawPersisted: true }
): { snapshot: unknown; source: 'computed' | 'persisted'; computedAt?: string } | null
export function resolveCachedOrLiveDigest(
    context: ResourceContext,
    workspaceId?: string,
    options?: { allowRawPersisted?: boolean }
): { snapshot: unknown; source: 'computed' | 'persisted'; computedAt?: string } | null {
    const effectiveWorkspace = workspaceId ?? resourceWorkspace(context)
    const dbObj: unknown = context.db
    const dbCacheKey = typeof dbObj === 'object' && dbObj !== null ? dbObj : undefined
    const byWs = dbCacheKey !== undefined ? liveDigestCache.get(dbCacheKey) : undefined
    const cachedDigest = byWs?.get(effectiveWorkspace)
    const now = Date.now()
    if (cachedDigest !== undefined && now < cachedDigest.expiresAt) {
        return { snapshot: cachedDigest.snapshot, source: 'computed' }
    }

    try {
        const liveDigest = context.db?.computeDigest?.(effectiveWorkspace)
        if (liveDigest !== undefined) {
            writeLiveDigestCache(dbCacheKey, byWs, effectiveWorkspace, liveDigest, now + LIVE_DIGEST_TTL_MS)
            logger.debug('Live digest computed for briefing', {
                module: 'BRIEFING',
                operation: 'insights-live-compute',
            })
            return { snapshot: liveDigest, source: 'computed' }
        }
    } catch (error) {
        logger.debug('Failed to compute live digest (non-critical)', {
            module: 'BRIEFING',
            operation: 'insights-live-compute',
            error: error instanceof Error ? error.message : String(error),
        })
    }

    return resolvePersistedDigest(context, effectiveWorkspace, options?.allowRawPersisted === true)
}

/**
 * Build the insights section from the latest digest snapshot.
 *
 * Resolution order:
 * 1. Live compute with 60s TTL cache
 * 2. Persisted DB snapshot (survives server restarts / fallback if compute fails)
 *
 * Returns null only if compute itself fails or database has no entries.
 */
export function buildInsightsSection(
    context: ResourceContext,
    workspaceId?: string
): BriefingInsights | null {
    const resolved = resolveCachedOrLiveDigest(context, workspaceId)
    if (!resolved) return null
    return formatDigest(resolved.snapshot)
}

/**
 * Format a DigestSnapshot into a compact BriefingInsights payload.
 */
function formatDigest(snapshot: DigestSnapshot): BriefingInsights {
    // Activity trend
    let activityTrend: string
    if (snapshot.activityGrowthPercent !== null) {
        const sign = snapshot.activityGrowthPercent >= 0 ? '+' : ''
        activityTrend = `${sign}${String(snapshot.activityGrowthPercent)}% vs. last period (${String(snapshot.currentPeriodEntries)} entries)`
    } else {
        activityTrend = `${String(snapshot.currentPeriodEntries)} entries this period`
    }

    // Significance spike
    let significanceSpike: string | null = null
    if (snapshot.currentPeriodSignificant > 0) {
        if (snapshot.significanceMultiplier !== null && snapshot.significanceMultiplier > 1.5) {
            significanceSpike = `${String(snapshot.currentPeriodSignificant)} significant entries (${String(snapshot.significanceMultiplier)}× avg)`
        } else {
            significanceSpike = `${String(snapshot.currentPeriodSignificant)} significant entries this period`
        }
    }

    return {
        activityTrend,
        significanceSpike,
        staleProjects: snapshot.staleProjects.map((p) => ({
            projectNumber: p.projectNumber,
            daysSilent: p.daysSilent,
        })),
        topImportance: snapshot.topImportanceEntries.map((e) => ({
            id: e.id,
            score: e.score,
            preview: sliceUntrustedInline(e.preview, 80, '...'),
        })),
        ...(snapshot.currentRelDensity > 0
            ? { relationshipDensity: snapshot.currentRelDensity }
            : {}),
    }
}
