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

/** Cached live digest with expiry timestamp */
const liveDigestCache = new WeakMap<
    object,
    { snapshot: DigestSnapshot; workspaceId: string; expiresAt: number }
>()

/** Cache TTL in milliseconds (60 seconds) */
const LIVE_DIGEST_TTL_MS = 60_000

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
    const snapshot = resolveDigestSnapshot(context, workspaceId)
    if (!snapshot) return null

    return formatDigest(snapshot)
}

/**
 * Resolve the latest digest snapshot from live compute (with 60s TTL cache) or DB fallback.
 */
function resolveDigestSnapshot(
    context: ResourceContext,
    workspaceId?: string
): DigestSnapshot | null {
    const effectiveWorkspace = workspaceId ?? resourceWorkspace(context)

    // Live compute with 60s TTL cache to prevent redundant recomputation across rapid reads.
    const dbObj: unknown = context.db
    const dbCacheKey = typeof dbObj === 'object' && dbObj !== null ? dbObj : undefined
    const cachedDigest = dbCacheKey !== undefined ? liveDigestCache.get(dbCacheKey) : undefined
    if (
        cachedDigest?.workspaceId === effectiveWorkspace &&
        Date.now() < cachedDigest.expiresAt
    ) {
        return cachedDigest.snapshot
    }

    try {
        const liveDigest = context.db?.computeDigest?.(effectiveWorkspace)
        if (liveDigest !== undefined) {
            const snapshot: DigestSnapshot = liveDigest
            if (dbCacheKey !== undefined) {
                liveDigestCache.set(dbCacheKey, {
                    snapshot,
                    workspaceId: effectiveWorkspace,
                    expiresAt: Date.now() + LIVE_DIGEST_TTL_MS,
                })
            }
            logger.debug('Live digest computed for briefing', {
                module: 'BRIEFING',
                operation: 'insights-live-compute',
            })
            return snapshot
        }
    } catch (error) {
        logger.debug('Failed to compute live digest (non-critical)', {
            module: 'BRIEFING',
            operation: 'insights-live-compute',
            error: error instanceof Error ? error.message : String(error),
        })
    }

    // Fallback: persisted snapshot in database (survives server restarts)
    // Guards against undefined db (test mocks) and missing method (older adapters)
    const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest', effectiveWorkspace)
    if (dbSnapshot) return parseDigestSnapshot(dbSnapshot.data)

    return null
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
