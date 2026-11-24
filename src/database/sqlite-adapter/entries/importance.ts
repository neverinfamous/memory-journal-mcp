import type { ImportanceBreakdown, ImportanceResult, JournalEntry } from '../../../types/index.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { type EntriesSharedContext, rowToObject } from './shared.js'
import { getEntriesByIds } from './crud.js'
import { SCOPED_IN_PARAM_BUCKETS, bucketInParams } from '../row-helpers.js'
import {
    type ImportanceStats,
    computeBreakdownScore,
    loadImportanceStats,
} from './importance-stats-helpers.js'

export const IMPORTANCE_WEIGHTS = {
    significance: 0.3,
    relationships: 0.35,
    causal: 0.2,
    recency: 0.15,
} as const

/** Relationship count at which the relationships component reaches its maximum score (1.0) */
export const MAX_RELATIONSHIP_SCORE_AT = 5
/** Causal relationship count at which the causal component reaches its maximum score (1.0) */
export const MAX_CAUSAL_SCORE_AT = 3
/** Number of days after which the recency component decays to zero */
export const RECENCY_WINDOW_DAYS = 90
/** Baseline significance value when significance_type is set without a higher impact_score */
export const SIGNIFICANCE_TYPE_BASELINE = 0.5

export function buildStatsCteBody(
    seedCte?: { name: string; col: string },
    scopedPeerWorkspace = false
): string {
    const seedRelFrom = seedCte
        ? `FROM ${seedCte.name} s CROSS JOIN relationships r ON r.from_entry_id = s.${seedCte.col}`
        : 'FROM relationships r'
    const seedRelTo = seedCte
        ? `FROM ${seedCte.name} s CROSS JOIN relationships r ON r.to_entry_id = s.${seedCte.col}`
        : 'FROM relationships r'
    const anchorFrom = seedCte
        ? `FROM ${seedCte.name} s CROSS JOIN entry_anchors ea ON ea.entry_id = s.${seedCte.col}`
        : 'FROM entry_anchors ea'
    const peerWsClause =
        seedCte !== undefined && scopedPeerWorkspace ? ' AND peer.workspace_id = s.workspace_id' : ''
    return `
        rel_stats AS (
            SELECT entry_id,
                   COUNT(*) AS rel_count,
                   SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
            FROM (
                SELECT r.from_entry_id AS entry_id, r.relationship_type
                ${seedRelFrom}
                CROSS JOIN memory_journal peer ON peer.id = r.to_entry_id AND peer.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id${peerWsClause}
                UNION ALL
                SELECT r.to_entry_id AS entry_id, r.relationship_type
                ${seedRelTo}
                CROSS JOIN memory_journal peer ON peer.id = r.from_entry_id AND peer.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id${peerWsClause}
            )
            GROUP BY entry_id
        ),
        anchor_stats AS (
            SELECT ea.entry_id,
                   MIN(
                       CASE ea.status
                           WHEN 'invalidated' THEN 1
                           WHEN 'stale' THEN 2
                           ELSE 3
                       END
                   ) as worst_status_rank
            ${anchorFrom}
            GROUP BY ea.entry_id
        )`
}

/**
 * Build a Common Table Expression (CTE) which aggregates a relationship
 * count (rel_count) and a causal_count for entries present in relationships/entry_anchors.
 * When `scopedToWorkspace` is true, prepends a positional `?` filter (`ws_entries`)
 * to avoid full-table scans across all workspaces (callers must bind workspaceId first).
 * Used with buildImportanceSqlExpression.
 */
export function buildImportanceCte(scopedToWorkspace = false): string {
    if (scopedToWorkspace) {
        return `
        ws_entries AS MATERIALIZED (
            SELECT id, workspace_id FROM memory_journal WHERE deleted_at IS NULL AND workspace_id = ?
        ),${buildStatsCteBody({ name: 'ws_entries', col: 'id' }, true)}
    `
    }
    return buildStatsCteBody()
}

/**
 * Build a materialized FTS-scoped importance CTE so `fts_content MATCH ?` runs once
 * and `rel_stats`/`anchor_stats` only probe workspace-scoped matching entries.
 */
export function buildScopedFtsImportanceCte(scopedWorkspace = false): string {
    const wsFilter = scopedWorkspace ? ' AND mj.workspace_id = ?' : ''
    return `
        fts_hits AS MATERIALIZED (
            SELECT fts.rowid AS entry_id, fts.rank AS fts_rank, mj.workspace_id AS workspace_id
            FROM fts_content fts
            CROSS JOIN memory_journal mj ON mj.id = fts.rowid
            WHERE fts_content MATCH ? AND mj.deleted_at IS NULL${wsFilter}
        ),${buildStatsCteBody({ name: 'fts_hits', col: 'entry_id' }, scopedWorkspace)}
    `
}

/**
 * Build an inline SQL expression that computes importance score per row.
 * Expects the entry table aliased as `e` and a LEFT JOIN on `rel_stats` aliased as `rs`.
 */
export function buildImportanceSqlExpression(): string {
    const w = IMPORTANCE_WEIGHTS
    return `(
    (
        MAX(COALESCE(e.impact_score, 0.0), CASE WHEN e.significance_type IS NOT NULL THEN ${String(SIGNIFICANCE_TYPE_BASELINE)} ELSE 0.0 END) * ${String(w.significance)}
        + MIN(COALESCE(rs.rel_count, 0) * 1.0 / ${String(MAX_RELATIONSHIP_SCORE_AT)}, 1.0) * ${String(w.relationships)}
        + MIN(COALESCE(rs.causal_count, 0) * 1.0 / ${String(MAX_CAUSAL_SCORE_AT)}, 1.0) * ${String(w.causal)}
        + MIN(1.0, MAX(0.0, 1.0 - (julianday('now') - julianday(e.timestamp)) / ${String(RECENCY_WINDOW_DAYS)}.0)) * ${String(w.recency)}
    ) 
    * CASE COALESCE(ans.worst_status_rank, 3) WHEN 1 THEN 0.1 WHEN 2 THEN 0.8 ELSE 1.0 END
    * (0.5 + COALESCE(e.trust_score, 0.5) + CASE e.validation_status WHEN 'passed' THEN 0.5 WHEN 'failed' THEN -0.4 ELSE 0.0 END)
  )`
}

function computeImportanceBreakdownAndScore(params: {
    impactScore: number | null
    significanceType: string | null
    trustScore: number | null
    validationStatus: string | null
    timestamp: string
    relCount: number
    causalCount: number
    worstStatusRank: number
    nowMs: number
}): ImportanceResult {
    const round2 = (n: number): number => Math.round(n * 100) / 100
    const significanceRaw = Math.max(
        params.impactScore ?? 0.0,
        params.significanceType ? SIGNIFICANCE_TYPE_BASELINE : 0.0
    )
    const relationshipsRaw = Math.min(params.relCount / MAX_RELATIONSHIP_SCORE_AT, 1.0)
    const causalRaw = Math.min(params.causalCount / MAX_CAUSAL_SCORE_AT, 1.0)

    const entryMs = new Date(params.timestamp).getTime()
    const daysSince = Number.isFinite(entryMs)
        ? Math.max(0, (params.nowMs - entryMs) / 86_400_000)
        : RECENCY_WINDOW_DAYS
    const recencyRaw = Math.min(1, Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS))

    const anchorMultiplier =
        params.worstStatusRank === 1 ? 0.1 : params.worstStatusRank === 2 ? 0.8 : 1.0
    const validationStatus = params.validationStatus ?? 'none'
    const validationMultiplier =
        validationStatus === 'passed' ? 0.5 : validationStatus === 'failed' ? -0.4 : 0.0
    const trustMultiplier = 0.5 + (params.trustScore ?? 0.5) + validationMultiplier
    const totalModifier = anchorMultiplier * trustMultiplier

    const w = IMPORTANCE_WEIGHTS
    const breakdown: ImportanceBreakdown = {
        significance: round2(significanceRaw * w.significance),
        relationships: round2(relationshipsRaw * w.relationships),
        causal: round2(causalRaw * w.causal),
        recency: round2(recencyRaw * w.recency),
        trustModifier: round2(totalModifier),
    }

    const baseScore =
        significanceRaw * w.significance +
        relationshipsRaw * w.relationships +
        causalRaw * w.causal +
        recencyRaw * w.recency

    return { score: round2(baseScore * totalModifier), breakdown }
}

export function calculateImportance(
    context: EntriesSharedContext,
    entryId: number,
    workspaceId?: string
): ImportanceResult | null {
    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const scoped = scopeId !== '*'
    const peerWsClause = scoped ? ' AND p.workspace_id = ?' : ''

    const stmt = db.prepare(`SELECT
        m.significance_type as significanceType,
        m.impact_score as impactScore,
        m.trust_score as trustScore,
        m.validation_status as validationStatus,
        m.timestamp,
        COALESCE(rel.rel_count, 0) AS rel_count,
        COALESCE(rel.causal_count, 0) AS causal_count,
        (SELECT MIN(
            CASE status
                WHEN 'invalidated' THEN 1
                WHEN 'stale' THEN 2
                ELSE 3
            END
         ) FROM entry_anchors WHERE entry_id = ?) AS worst_status_rank
    FROM memory_journal m
    LEFT JOIN (
        SELECT
            COUNT(*) AS rel_count,
            SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
        FROM (
            SELECT r.relationship_type
            FROM relationships r
            CROSS JOIN memory_journal p ON p.id = r.to_entry_id AND p.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id${peerWsClause}
            WHERE r.from_entry_id = ?
            UNION ALL
            SELECT r.relationship_type
            FROM relationships r
            CROSS JOIN memory_journal p ON p.id = r.from_entry_id AND p.deleted_at IS NULL${peerWsClause}
            WHERE r.to_entry_id = ? AND r.from_entry_id != ?
        )
    ) rel ON 1 = 1
    WHERE m.id = ? AND m.deleted_at IS NULL${scoped ? ' AND m.workspace_id = ?' : ''}`)

    const params = scoped
        ? [entryId, scopeId, entryId, scopeId, entryId, entryId, entryId, scopeId]
        : [entryId, entryId, entryId, entryId, entryId]
    const row = rowToObject(stmt.get(...params))

    if (!row) return null

    return computeImportanceBreakdownAndScore({
        impactScore: typeof row['impactScore'] === 'number' ? row['impactScore'] : 0.0,
        significanceType:
            typeof row['significanceType'] === 'string' ? row['significanceType'] : null,
        trustScore: typeof row['trustScore'] === 'number' ? row['trustScore'] : 0.5,
        validationStatus:
            typeof row['validationStatus'] === 'string' ? row['validationStatus'] : 'none',
        timestamp: typeof row['timestamp'] === 'string' ? row['timestamp'] : '',
        relCount: typeof row['rel_count'] === 'number' ? row['rel_count'] : 0,
        causalCount: typeof row['causal_count'] === 'number' ? row['causal_count'] : 0,
        worstStatusRank: typeof row['worst_status_rank'] === 'number' ? row['worst_status_rank'] : 3,
        nowMs: Date.now(),
    })
}

/**
 * Batch-attaches rounded importanceScore values directly onto an array of hydrated JournalEntry objects.
 * Uses only 2 bucketed SQL query sets (relationships + entry_anchors) for all entries.
 */
export function attachImportanceScoresToEntries(
    context: EntriesSharedContext,
    entries: JournalEntry[],
    workspaceId?: string
): void {
    if (entries.length === 0) return

    const { db } = context
    const scopeId = workspaceId !== undefined ? effectiveWorkspace(workspaceId) : 'scoped'
    const validIds = entries.map((e) => e.id)
    const relData = loadImportanceStats(db, validIds, scopeId !== '*')
    const nowMs = Date.now()
    const defaultStats: ImportanceStats = { relCount: 0, causalCount: 0, worstStatusRank: 3 }

    for (const entry of entries) {
        const stats = relData.get(entry.id) ?? defaultStats
        entry.importanceScore = computeBreakdownScore(
            entry,
            stats,
            nowMs,
            computeImportanceBreakdownAndScore
        ).score
    }
}

/**
 * Lightweight batch importance calculation fetching only scalar importance columns (no content/tags).
 */
export function getImportanceScoresByIds(
    context: EntriesSharedContext,
    entryIds: number[],
    workspaceId?: string
): Map<number, ImportanceResult> {
    const result = new Map<number, ImportanceResult>()
    if (entryIds.length === 0) return result

    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const wsClause = scopeId !== '*' ? ' AND workspace_id = ?' : ''
    const wsParams = scopeId !== '*' ? [scopeId] : []
    const scalarRows: {
        id: number
        significanceType: string | null
        impactScore: number | null
        trustScore: number | null
        validationStatus: string | null
        timestamp: string
    }[] = []

    for (const { placeholders, params } of bucketInParams(entryIds, SCOPED_IN_PARAM_BUCKETS)) {
        const rows = db
            .prepare<
                unknown[],
                {
                    id: number
                    significanceType: string | null
                    impactScore: number | null
                    trustScore: number | null
                    validationStatus: string | null
                    timestamp: string
                }
            >(
                `SELECT id, significance_type as significanceType, impact_score as impactScore, trust_score as trustScore, validation_status as validationStatus, timestamp
                 FROM memory_journal
                 WHERE deleted_at IS NULL${wsClause} AND id IN (${placeholders})`
            )
            .all(...wsParams, ...params)
        for (const r of rows) scalarRows.push(r)
    }
    if (scalarRows.length === 0) return result

    const relData = loadImportanceStats(
        db,
        scalarRows.map((r) => r.id),
        scopeId !== '*'
    )
    const nowMs = Date.now()
    const defaultStats: ImportanceStats = { relCount: 0, causalCount: 0, worstStatusRank: 3 }
    for (const row of scalarRows) {
        result.set(
            row.id,
            computeBreakdownScore(
                row,
                relData.get(row.id) ?? defaultStats,
                nowMs,
                computeImportanceBreakdownAndScore
            )
        )
    }
    return result
}

export function getEntriesByIdsWithImportance(
    context: EntriesSharedContext,
    entryIds: number[],
    workspaceId?: string
): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
    const result = new Map<number, { entry: JournalEntry; importance: ImportanceResult }>()
    if (entryIds.length === 0) return result

    const entriesMap = getEntriesByIds(context, entryIds, workspaceId)
    if (entriesMap.size === 0) return result

    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const validIds = Array.from(entriesMap.keys())
    const relData = loadImportanceStats(db, validIds, scopeId !== '*')
    const nowMs = Date.now()
    const defaultStats: ImportanceStats = { relCount: 0, causalCount: 0, worstStatusRank: 3 }

    for (const [id, entry] of entriesMap.entries()) {
        const stats = relData.get(id) ?? defaultStats
        result.set(id, {
            entry,
            importance: computeBreakdownScore(
                entry,
                stats,
                nowMs,
                computeImportanceBreakdownAndScore
            ),
        })
    }

    return result
}
