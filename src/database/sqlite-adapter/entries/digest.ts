/**
 * Memory Journal MCP Server - Analytics Digest
 *
 * Computes and persists analytical snapshots for proactive insight surfacing.
 * Uses the same SQL patterns as statistics.ts and importance.ts.
 */

import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { buildImportanceSqlExpression, buildImportanceCte } from './importance.js'
import { queryRow, queryRows } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

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

/** Runtime schema for persisted digest snapshots read back from the database. */
export const digestSnapshotSchema: z.ZodType<DigestSnapshot> = z.object({
    computedAt: z.string(),
    currentPeriodEntries: z.number(),
    previousPeriodEntries: z.number(),
    activityGrowthPercent: z.number().nullable(),
    currentPeriodSignificant: z.number(),
    historicalAvgSignificant: z.number(),
    significanceMultiplier: z.number().nullable(),
    staleProjects: z.array(
        z.object({
            projectNumber: z.number(),
            lastEntryDate: z.string(),
            daysSilent: z.number(),
        })
    ),
    currentRelDensity: z.number(),
    previousRelDensity: z.number(),
    topImportanceEntries: z.array(
        z.object({ id: z.number(), score: z.number(), preview: z.string() })
    ),
})

/** Validate untrusted persisted data as a DigestSnapshot; returns null when it does not match. */
export function parseDigestSnapshot(data: unknown): DigestSnapshot | null {
    const result = digestSnapshotSchema.safeParse(data)
    return result.success ? result.data : null
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

interface DigestScope {
    filter: string
    filterAlias: string
    filterE: string
    params: unknown[]
    isScoped: boolean
}

function buildDigestScope(workspaceId: string): DigestScope {
    const scopeId = effectiveWorkspace(workspaceId)
    const isScoped = scopeId !== '*'
    return {
        filter: isScoped ? ' AND workspace_id = ?' : '',
        filterAlias: isScoped ? ' AND m.workspace_id = ?' : '',
        filterE: isScoped ? ' AND e.workspace_id = ?' : '',
        params: isScoped ? [scopeId] : [],
        isScoped,
    }
}

interface UtcMonthWindow {
    curYm: string
    prevYm: string
    prevStartIso: string
    nextStartIso: string
}

function getUtcMonthWindow(now = new Date()): UtcMonthWindow {
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const fmtYm = (dt: Date): string =>
        `${String(dt.getUTCFullYear())}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    const curYm = `${String(y)}-${String(m + 1).padStart(2, '0')}`
    const prevYm = fmtYm(new Date(Date.UTC(y, m - 1, 1)))
    const nextYm = fmtYm(new Date(Date.UTC(y, m + 1, 1)))
    return { curYm, prevYm, prevStartIso: `${prevYm}-01`, nextStartIso: `${nextYm}-01` }
}

/** Activity trend & significance spike in a single memory_journal scan (non-strftime SUBSTR). */
function computeActivityAndSignificance(
    db: Database,
    s: DigestScope,
    win: UtcMonthWindow
): {
    currentPeriodEntries: number
    previousPeriodEntries: number
    activityGrowthPercent: number | null
    currentPeriodSignificant: number
    historicalAvgSignificant: number
    significanceMultiplier: number | null
} {
    const row = queryRow(
        db,
        `SELECT
            COALESCE(SUM(CASE WHEN SUBSTR(timestamp, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS current_count,
            COALESCE(SUM(CASE WHEN SUBSTR(timestamp, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS previous_count,
            COALESCE(SUM(CASE WHEN significance_type IS NOT NULL AND SUBSTR(timestamp, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS current_significant,
            COUNT(DISTINCT SUBSTR(timestamp, 1, 7)) AS total_periods,
            COALESCE(SUM(CASE WHEN significance_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_significant
        FROM memory_journal
        WHERE deleted_at IS NULL${s.filter}`,
        win.curYm,
        win.prevYm,
        win.curYm,
        ...s.params
    )
    const currentPeriodEntries = (row?.['current_count'] as number) ?? 0
    const previousPeriodEntries = (row?.['previous_count'] as number) ?? 0
    const activityGrowthPercent =
        previousPeriodEntries > 0
            ? Math.round(((currentPeriodEntries - previousPeriodEntries) / previousPeriodEntries) * 100)
            : null
    const currentPeriodSignificant = (row?.['current_significant'] as number) ?? 0
    const totalPeriods = (row?.['total_periods'] as number) ?? 1
    const totalSignificant = (row?.['total_significant'] as number) ?? 0
    const historicalAvgSignificant =
        totalPeriods > 0 ? Math.round((totalSignificant / totalPeriods) * 10) / 10 : 0
    const significanceMultiplier =
        historicalAvgSignificant > 0
            ? Math.round((currentPeriodSignificant / historicalAvgSignificant) * 10) / 10
            : null
    return {
        currentPeriodEntries,
        previousPeriodEntries,
        activityGrowthPercent,
        currentPeriodSignificant,
        historicalAvgSignificant,
        significanceMultiplier,
    }
}

/** Projects with no entries in the last N days. */
function computeStaleProjects(db: Database, s: DigestScope): StaleProject[] {
    const staleRows = queryRows(
        db,
        `SELECT
            project_number,
            MAX(timestamp) AS last_entry_date,
            CAST(julianday('now') - julianday(MAX(timestamp)) AS INTEGER) AS days_silent
        FROM memory_journal
        WHERE deleted_at IS NULL AND project_number IS NOT NULL${s.filter}
        GROUP BY project_number
        HAVING days_silent > ?`,
        ...s.params,
        STALE_PROJECT_THRESHOLD_DAYS
    )
    return staleRows.map((r) => ({
        projectNumber: r['project_number'] as number,
        lastEntryDate: r['last_entry_date'] as string,
        daysSilent: r['days_silent'] as number,
    }))
}

/** Relationship density (current vs previous month) in a single date-bounded join scan. */
function computeRelationshipDensity(
    db: Database,
    s: DigestScope,
    win: UtcMonthWindow,
    currentPeriodEntries: number,
    previousPeriodEntries: number
): { currentRelDensity: number; previousRelDensity: number } {
    const relDensityRow = queryRow(
        db,
        `SELECT
            COALESCE(SUM(CASE WHEN SUBSTR(m.timestamp, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS current_rels,
            COALESCE(SUM(CASE WHEN SUBSTR(m.timestamp, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS previous_rels
        FROM relationships r
        JOIN memory_journal m ON r.from_entry_id = m.id
        JOIN memory_journal p ON r.to_entry_id = p.id
        WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.workspace_id = p.workspace_id
          AND m.timestamp >= ? AND m.timestamp < ?${s.filterAlias}`,
        win.curYm,
        win.prevYm,
        win.prevStartIso,
        win.nextStartIso,
        ...s.params
    )
    const currentRels = (relDensityRow?.['current_rels'] as number) ?? 0
    const previousRels = (relDensityRow?.['previous_rels'] as number) ?? 0
    return {
        currentRelDensity:
            currentPeriodEntries > 0 ? Math.round((currentRels / currentPeriodEntries) * 100) / 100 : 0,
        previousRelDensity:
            previousPeriodEntries > 0 ? Math.round((previousRels / previousPeriodEntries) * 100) / 100 : 0,
    }
}

/** Highest-importance entries (uses workspace-scoped CTE when scoped). */
function computeTopImportance(db: Database, s: DigestScope): TopImportanceEntry[] {
    const importanceExpr = buildImportanceSqlExpression()
    const importanceCte = buildImportanceCte(s.isScoped)
    const topRows = queryRows(
        db,
        `WITH ${importanceCte}
        SELECT
            e.id,
            ${importanceExpr} AS importance_score,
            SUBSTR(e.content, 1, ?) AS preview
        FROM memory_journal e
        LEFT JOIN rel_stats rs ON e.id = rs.entry_id
        LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
        WHERE e.deleted_at IS NULL${s.filterE}
        ORDER BY importance_score DESC
        LIMIT ?`,
        ...s.params,
        PREVIEW_LENGTH,
        ...s.params,
        TOP_IMPORTANCE_COUNT
    )
    return topRows.map((r) => ({
        id: r['id'] as number,
        score: Math.round((r['importance_score'] as number) * 100) / 100,
        preview: r['preview'] as string,
    }))
}

/**
 * Compute a full DigestSnapshot from the database.
 * All queries are synchronous (better-sqlite3) and individually lightweight.
 */
export function computeDigest(db: Database, workspaceId = 'default'): DigestSnapshot {
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const win = getUtcMonthWindow(nowDate)
    const scope = buildDigestScope(workspaceId)

    const {
        currentPeriodEntries,
        previousPeriodEntries,
        activityGrowthPercent,
        currentPeriodSignificant,
        historicalAvgSignificant,
        significanceMultiplier,
    } = computeActivityAndSignificance(db, scope, win)
    const staleProjects = computeStaleProjects(db, scope)
    const { currentRelDensity, previousRelDensity } = computeRelationshipDensity(
        db,
        scope,
        win,
        currentPeriodEntries,
        previousPeriodEntries
    )
    const topImportanceEntries = computeTopImportance(db, scope)

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
 * Encode the workspace into the snapshot_type key so one workspace's snapshots are never
 * served to another. An omitted workspace keeps the plain legacy key. Explicit `default`
 * is its own workspace and uses `${type}:default`.
 */
export function workspaceSnapshotType(type: string, workspaceId?: string): string {
    if (workspaceId === undefined || workspaceId === '') {
        return type
    }
    return `${type}:${workspaceId}`
}

/**
 * Save an analytics snapshot to the database.
 * Returns the inserted row ID.
 */
export function saveAnalyticsSnapshot(
    db: Database,
    type: string,
    data: object,
    workspaceId?: string
): number {
    const stmt = db.prepare(`INSERT INTO analytics_snapshots (snapshot_type, data) VALUES (?, ?)`)
    const result = stmt.run(workspaceSnapshotType(type, workspaceId), JSON.stringify(data))
    return Number(result.lastInsertRowid)
}

/**
 * Get the latest analytics snapshot of a given type.
 */
export function getLatestAnalyticsSnapshot(
    db: Database,
    type: string,
    workspaceId?: string
): { id: number; createdAt: string; data: Record<string, unknown> } | null {
    const row = queryRow(
        db,
        `SELECT id, created_at, data FROM analytics_snapshots
         WHERE snapshot_type = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        workspaceSnapshotType(type, workspaceId)
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
    limit = 10,
    workspaceId?: string
): { id: number; createdAt: string; data: Record<string, unknown> }[] {
    const rows = queryRows(
        db,
        `SELECT id, created_at, data FROM analytics_snapshots
         WHERE snapshot_type = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        workspaceSnapshotType(type, workspaceId),
        limit
    )
    return rows.map((r) => ({
        id: r['id'] as number,
        createdAt: r['created_at'] as string,
        data: JSON.parse(r['data'] as string) as Record<string, unknown>,
    }))
}
