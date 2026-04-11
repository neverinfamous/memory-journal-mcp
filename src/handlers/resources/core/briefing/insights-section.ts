/**
 * Briefing Insights Section
 *
 * Formats a DigestSnapshot into a compact briefing section (~50 tokens).
 * Only included when a digest snapshot is available (scheduler has run at least once,
 * or a snapshot was restored from a previous server session).
 */

import type { DigestSnapshot } from '../../../../database/sqlite-adapter/entries/digest.js'
import type { ResourceContext } from '../../shared.js'

/** Compact insights payload for the briefing JSON */
export interface BriefingInsights {
    activityTrend: string
    significanceSpike: string | null
    staleProjects: { projectNumber: number; daysSilent: number }[]
    topImportance: { id: number; score: number; preview: string }[]
    relationshipDensity?: number
}

/**
 * Build the insights section from the latest digest snapshot.
 *
 * Returns null if no digest is available (scheduler not configured or
 * hasn't run yet and no persisted snapshot exists).
 */
export function buildInsightsSection(context: ResourceContext): BriefingInsights | null {
    // Try scheduler's in-memory digest first, fall back to DB-persisted snapshot
    const snapshot = resolveDigestSnapshot(context)
    if (!snapshot) return null

    return formatDigest(snapshot)
}

/**
 * Resolve the latest digest snapshot from scheduler or database.
 */
function resolveDigestSnapshot(context: ResourceContext): DigestSnapshot | null {
    // Primary: scheduler's accessor (includes just-computed data)
    const schedulerDigest = context.scheduler?.getLatestDigest?.()
    if (schedulerDigest) return schedulerDigest

    // Fallback: persisted snapshot in database (survives server restarts)
    // Guards against undefined db (test mocks) and missing method (older adapters)
    const dbSnapshot = context.db?.getLatestAnalyticsSnapshot?.('digest')
    if (dbSnapshot) return dbSnapshot.data as unknown as DigestSnapshot

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
        ...(snapshot.currentRelDensity > 0 ? { relationshipDensity: snapshot.currentRelDensity } : {})
    }
}
