/**
 * Briefing Insights Section
 *
 * Formats a DigestSnapshot into a compact briefing section (~50 tokens).
 * Only included when a digest snapshot is available (scheduler has run at least once,
 * or a snapshot was restored from a previous server session).
 */

import type { DigestSnapshot } from '../../../../database/sqlite-adapter/entries/digest.js'
import type { ResourceContext } from '../../shared.js'
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
let liveDigestCache: { snapshot: DigestSnapshot; expiresAt: number } | null = null

/** Cache TTL in milliseconds (60 seconds) */
const LIVE_DIGEST_TTL_MS = 60_000

/**
 * Build the insights section from the latest digest snapshot.
 *
 * Resolution order:
 * 1. Scheduler's in-memory digest (HTTP transport with digest job running)
 * 2. Persisted DB snapshot (survives server restarts)
 * 3. Live compute with 60s TTL cache (stdio transport, fresh databases)
 *
 * Returns null only if compute itself fails or database has no entries.
 */
export function buildInsightsSection(context: ResourceContext): BriefingInsights | null {
    const snapshot = resolveDigestSnapshot(context)
    if (!snapshot) return null

    return formatDigest(snapshot)
}

/**
 * Resolve the latest digest snapshot from scheduler, database, or live compute.
 */
function resolveDigestSnapshot(context: ResourceContext): DigestSnapshot | null {
    // Primary: scheduler's accessor (includes just-computed data)
    const schedulerDigest = context.scheduler?.getLatestDigest?.()
    if (schedulerDigest) return schedulerDigest

    // Fallback: persisted snapshot in database (survives server restarts)
    // Guards against undefined db (test mocks) and missing method (older adapters)
    const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest')
    if (dbSnapshot) return dbSnapshot.data as unknown as DigestSnapshot

    // Live compute: real-time digest when no cached snapshot exists.
    // Covers stdio transport (no scheduler) and fresh databases.
    // TTL cache prevents redundant recomputation across rapid reads.
    if (liveDigestCache && Date.now() < liveDigestCache.expiresAt) {
        return liveDigestCache.snapshot
    }

    try {
        const liveDigest = context.db?.computeDigest?.()
        if (liveDigest !== undefined) {
            const snapshot = liveDigest as unknown as DigestSnapshot
            liveDigestCache = { snapshot, expiresAt: Date.now() + LIVE_DIGEST_TTL_MS }
            logger.debug('Live digest computed for briefing (no scheduler/persisted snapshot)', {
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
        activityTrend = `${String(snapshot.currentPeriodEntries)} entries this period (no previous data)`
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
            preview: e.preview,
        })),
        ...(snapshot.currentRelDensity > 0
            ? { relationshipDensity: snapshot.currentRelDensity }
            : {}),
    }
}
