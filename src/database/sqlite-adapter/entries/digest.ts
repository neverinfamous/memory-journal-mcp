/**
 * Memory Journal MCP Server - Analytics Digest
 *
 * Computes and persists analytical snapshots for proactive insight surfacing.
 * Uses the same SQL patterns as statistics.ts and importance.ts.
 */

import type { Database } from 'better-sqlite3'
import { buildImportanceSqlExpression } from './importance.js'
import { queryRow, queryRows } from './shared.js'

// ============================================================================
// Types
// ============================================================================

/** A single stale project entry */
export interface StaleProject {
    projectNumber: number
    lastEntryDate: string
    daysSilent: number
}

/** A top-importance entry summary */
export interface TopImportanceEntry {
    id: number
    score: number
    preview: string
}

/** Full digest snapshot structure */
export interface DigestSnapshot {
    computedAt: string
    // Activity
    currentPeriodEntries: number
    previousPeriodEntries: number
    activityGrowthPercent: number | null
    // Significance
    currentPeriodSignificant: number
    historicalAvgSignificant: number
    significanceMultiplier: number | null
    // Stale projects
    staleProjects: StaleProject[]
    // Relationship density
    currentRelDensity: number
    previousRelDensity: number
    // Top importance
    topImportanceEntries: TopImportanceEntry[]
}

// ============================================================================
// Digest Computation
// ============================================================================

/** Days after which a project is considered stale */
const STALE_PROJECT_THRESHOLD_DAYS = 14
/** Max preview characters for top-importance entries */
const PREVIEW_LENGTH = 80
/** Number of top-importance entries to surface */
const TOP_IMPORTANCE_COUNT = 3

/**
 * Compute a full DigestSnapshot from the database.
 * All queries are synchronous (better-sqlite3) and individually lightweight.
 */
export function computeDigest(db: Database): DigestSnapshot {
    const now = new Date().toISOString()

    // --- Activity trend (current vs previous month) ---
    const activityRow = queryRow(
        db,
        `SELECT
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END), 0) AS current_count,
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', '-1 month') THEN 1 ELSE 0 END), 0) AS previous_count
        FROM memory_journal
        WHERE deleted_at IS NULL`
    )
    const currentPeriodEntries = (activityRow?.['current_count'] as number) ?? 0
    const previousPeriodEntries = (activityRow?.['previous_count'] as number) ?? 0
    const activityGrowthPercent =
        previousPeriodEntries > 0
            ? Math.round(
                  ((currentPeriodEntries - previousPeriodEntries) / previousPeriodEntries) * 100
              )
            : null

    // --- Significance spike ---
    const sigRow = queryRow(
        db,
        `SELECT
            COALESCE(SUM(CASE
                WHEN significance_type IS NOT NULL AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
                THEN 1 ELSE 0 END), 0) AS current_significant,
            COUNT(DISTINCT strftime('%Y-%m', timestamp)) AS total_periods,
            COALESCE(SUM(CASE WHEN significance_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_significant
        FROM memory_journal
        WHERE deleted_at IS NULL`
    )
    const currentPeriodSignificant = (sigRow?.['current_significant'] as number) ?? 0
    const totalPeriods = (sigRow?.['total_periods'] as number) ?? 1
    const totalSignificant = (sigRow?.['total_significant'] as number) ?? 0
    const historicalAvgSignificant =
        totalPeriods > 0 ? Math.round((totalSignificant / totalPeriods) * 10) / 10 : 0
    const significanceMultiplier =
        historicalAvgSignificant > 0
            ? Math.round((currentPeriodSignificant / historicalAvgSignificant) * 10) / 10
            : null

    // --- Stale projects (no entries in last N days) ---
    const staleRows = queryRows(
        db,
        `SELECT
            project_number,
            MAX(timestamp) AS last_entry_date,
            CAST(julianday('now') - julianday(MAX(timestamp)) AS INTEGER) AS days_silent
        FROM memory_journal
        WHERE deleted_at IS NULL AND project_number IS NOT NULL
        GROUP BY project_number
        HAVING days_silent > ?`,
        STALE_PROJECT_THRESHOLD_DAYS
    )
    const staleProjects: StaleProject[] = staleRows.map((r) => ({
        projectNumber: r['project_number'] as number,
        lastEntryDate: r['last_entry_date'] as string,
        daysSilent: r['days_silent'] as number,
    }))

    // --- Relationship density (current vs previous month) ---
    const relDensityRow = queryRow(
        db,
        `SELECT
            COALESCE((SELECT COUNT(*) FROM relationships r
                JOIN memory_journal m ON r.from_entry_id = m.id
                WHERE strftime('%Y-%m', m.timestamp) = strftime('%Y-%m', 'now')
            ), 0) AS current_rels,
            COALESCE((SELECT COUNT(*) FROM relationships r
                JOIN memory_journal m ON r.from_entry_id = m.id
                WHERE strftime('%Y-%m', m.timestamp) = strftime('%Y-%m', 'now', '-1 month')
            ), 0) AS previous_rels`
    )
    const currentRels = (relDensityRow?.['current_rels'] as number) ?? 0
    const previousRels = (relDensityRow?.['previous_rels'] as number) ?? 0
    const currentRelDensity =
        currentPeriodEntries > 0 ? Math.round((currentRels / currentPeriodEntries) * 100) / 100 : 0
    const previousRelDensity =
        previousPeriodEntries > 0
            ? Math.round((previousRels / previousPeriodEntries) * 100) / 100
            : 0

    // --- Top importance entries ---
    const importanceExpr = buildImportanceSqlExpression()
    const topRows = queryRows(
        db,
        `SELECT
            e.id,
            ${importanceExpr} AS importance_score,
            SUBSTR(e.content, 1, ${String(PREVIEW_LENGTH)}) AS preview
        FROM memory_journal e
        WHERE e.deleted_at IS NULL
        ORDER BY importance_score DESC
        LIMIT ${String(TOP_IMPORTANCE_COUNT)}`
    )
    const topImportanceEntries: TopImportanceEntry[] = topRows.map((r) => ({
        id: r['id'] as number,
        score: Math.round((r['importance_score'] as number) * 100) / 100,
        preview: r['preview'] as string,
    }))

    return {
        computedAt: now,
        currentPeriodEntries,
        previousPeriodEntries,
        activityGrowthPercent,
        currentPeriodSignificant,
        historicalAvgSignificant,
        significanceMultiplier,
        staleProjects,
        currentRelDensity,
        previousRelDensity,
        topImportanceEntries,
    }
}

// ============================================================================
// Snapshot Persistence (operates directly on Database for SqliteAdapter wiring)
// ============================================================================

/**
 * Save an analytics snapshot to the database.
 * Returns the inserted row ID.
 */
export function saveAnalyticsSnapshot(
    db: Database,
    type: string,
    data: Record<string, unknown>
): number {
    const stmt = db.prepare(`INSERT INTO analytics_snapshots (snapshot_type, data) VALUES (?, ?)`)
    const result = stmt.run(type, JSON.stringify(data))
    return Number(result.lastInsertRowid)
}

/**
 * Get the latest analytics snapshot of a given type.
 */
export function getLatestAnalyticsSnapshot(
    db: Database,
    type: string
): { id: number; createdAt: string; data: Record<string, unknown> } | null {
    const row = queryRow(
        db,
        `SELECT id, created_at, data FROM analytics_snapshots
         WHERE snapshot_type = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        type
    )
    if (!row) return null
    return {
        id: row['id'] as number,
        createdAt: row['created_at'] as string,
        data: JSON.parse(row['data'] as string) as Record<string, unknown>,
    }
}

/**
 * Get multiple analytics snapshots of a given type (for historical comparison).
 */
export function getAnalyticsSnapshots(
    db: Database,
    type: string,
    limit = 10
): { id: number; createdAt: string; data: Record<string, unknown> }[] {
    const rows = queryRows(
        db,
        `SELECT id, created_at, data FROM analytics_snapshots
         WHERE snapshot_type = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        type,
        limit
    )
    return rows.map((r) => ({
        id: r['id'] as number,
        createdAt: r['created_at'] as string,
        data: JSON.parse(r['data'] as string) as Record<string, unknown>,
    }))
}
