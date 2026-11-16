import type { ImportanceBreakdown, ImportanceResult, JournalEntry } from '../../../types/index.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { type EntriesSharedContext, rowToObject } from './shared.js'
import { getEntriesByIds } from './crud.js'

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

/**
 * Build a Common Table Expression (CTE) which aggregates a relationship
 * count (rel_count) and a causal_count for every entry_id present in the relationships table.
 * Used with buildImportanceSqlExpression.
 */
export function buildImportanceCte(): string {
    return `
        rel_stats AS (
            SELECT entry_id,
                   COUNT(*) AS rel_count,
                   SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
            FROM (
                SELECT r.from_entry_id AS entry_id, r.relationship_type
                FROM relationships r
                JOIN memory_journal peer ON peer.id = r.to_entry_id AND peer.deleted_at IS NULL
                UNION ALL
                SELECT r.to_entry_id AS entry_id, r.relationship_type
                FROM relationships r
                JOIN memory_journal peer ON peer.id = r.from_entry_id AND peer.deleted_at IS NULL
            )
            GROUP BY entry_id
        ),
        anchor_stats AS (
            SELECT entry_id,
                   MIN(
                       CASE status
                           WHEN 'invalidated' THEN 1
                           WHEN 'stale' THEN 2
                           ELSE 3
                       END
                   ) as worst_status_rank
            FROM entry_anchors
            GROUP BY entry_id
        )
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

    const stmt = db.prepare(`SELECT
        m.significance_type as significanceType,
        m.impact_score as impactScore,
        m.trust_score as trustScore,
        m.validation_status as validationStatus,
        m.timestamp,
        (SELECT COUNT(*) FROM relationships r
         WHERE (r.from_entry_id = ? AND EXISTS (SELECT 1 FROM memory_journal p WHERE p.id = r.to_entry_id AND p.deleted_at IS NULL))
            OR (r.to_entry_id = ? AND EXISTS (SELECT 1 FROM memory_journal p WHERE p.id = r.from_entry_id AND p.deleted_at IS NULL))) AS rel_count,
        (SELECT COUNT(*) FROM relationships r
         WHERE ((r.from_entry_id = ? AND EXISTS (SELECT 1 FROM memory_journal p WHERE p.id = r.to_entry_id AND p.deleted_at IS NULL))
            OR (r.to_entry_id = ? AND EXISTS (SELECT 1 FROM memory_journal p WHERE p.id = r.from_entry_id AND p.deleted_at IS NULL)))
         AND r.relationship_type IN ('blocked_by', 'resolved', 'caused')) AS causal_count,
        (SELECT MIN(
            CASE status
                WHEN 'invalidated' THEN 1
                WHEN 'stale' THEN 2
                ELSE 3
            END
         ) FROM entry_anchors WHERE entry_id = ?) AS worst_status_rank
    FROM memory_journal m
    WHERE m.id = ? AND m.deleted_at IS NULL${scoped ? ' AND m.workspace_id = ?' : ''}`)

    const baseParams = [entryId, entryId, entryId, entryId, entryId, entryId]
    const row = rowToObject(stmt.get(...(scoped ? [...baseParams, scopeId] : baseParams)))

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

/** Per-entry relationship/anchor statistics feeding the importance score. */
interface ImportanceStats {
    relCount: number
    causalCount: number
    worstStatusRank: number
}

/**
 * Load relationship counts and worst anchor status for a set of entries using chunked batched queries.
 * Every id gets an entry (zero counts, rank 3 when no data).
 */
function loadImportanceStats(
    db: EntriesSharedContext['db'],
    validIds: number[]
): Map<number, ImportanceStats> {
    const relData = new Map<number, ImportanceStats>()
    for (const id of validIds) {
        relData.set(id, { relCount: 0, causalCount: 0, worstStatusRank: 3 })
    }

    const CHUNK_SIZE = 450
    for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
        const chunk = validIds.slice(i, i + CHUNK_SIZE)
        const marks = chunk.map(() => '?').join(', ')

        const sql = `
            SELECT entry_id,
                   COUNT(*) AS rel_count,
                   SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
            FROM (
                SELECT r.from_entry_id AS entry_id, r.relationship_type
                FROM relationships r
                JOIN memory_journal peer ON peer.id = r.to_entry_id AND peer.deleted_at IS NULL
                WHERE r.from_entry_id IN (${marks})
                UNION ALL
                SELECT r.to_entry_id AS entry_id, r.relationship_type
                FROM relationships r
                JOIN memory_journal peer ON peer.id = r.from_entry_id AND peer.deleted_at IS NULL
                WHERE r.to_entry_id IN (${marks})
            )
            GROUP BY entry_id
        `
        const rows = db.prepare(sql).all(...chunk, ...chunk) as {
            entry_id: number
            rel_count: number
            causal_count: number
        }[]

        const anchorSql = `
            SELECT entry_id,
                   MIN(CASE status WHEN 'invalidated' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END) AS worst_status_rank
            FROM entry_anchors WHERE entry_id IN (${marks})
            GROUP BY entry_id
        `
        const anchorRows = db.prepare(anchorSql).all(...chunk) as {
            entry_id: number
            worst_status_rank: number
        }[]

        for (const row of rows) {
            const d = relData.get(row.entry_id)
            if (d) {
                d.relCount = row.rel_count
                d.causalCount = row.causal_count
            }
        }
        for (const row of anchorRows) {
            const d = relData.get(row.entry_id)
            if (d) {
                d.worstStatusRank = row.worst_status_rank
            }
        }
    }
    return relData
}

/**
 * Batch-attaches rounded importanceScore values directly onto an array of hydrated JournalEntry objects.
 * Uses only 2 chunked batched SQL query sets (relationships + entry_anchors) for all entries.
 */
export function attachImportanceScoresToEntries(
    context: EntriesSharedContext,
    entries: JournalEntry[]
): void {
    if (entries.length === 0) return

    const { db } = context
    const validIds = entries.map((e) => e.id)
    const relData = loadImportanceStats(db, validIds)
    const nowMs = Date.now()

    for (const entry of entries) {
        const stats = relData.get(entry.id) ?? { relCount: 0, causalCount: 0, worstStatusRank: 3 }
        entry.importanceScore = computeImportanceBreakdownAndScore({
            impactScore: entry.impactScore ?? null,
            significanceType: entry.significanceType ?? null,
            trustScore: entry.trustScore ?? null,
            validationStatus: entry.validationStatus ?? null,
            timestamp: entry.timestamp,
            relCount: stats.relCount,
            causalCount: stats.causalCount,
            worstStatusRank: stats.worstStatusRank,
            nowMs,
        }).score
    }
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
    const validIds = Array.from(entriesMap.keys())
    const relData = loadImportanceStats(db, validIds)
    const nowMs = Date.now()

    for (const [id, entry] of entriesMap.entries()) {
        const stats = relData.get(id) ?? { relCount: 0, causalCount: 0, worstStatusRank: 3 }
        const importance = computeImportanceBreakdownAndScore({
            impactScore: entry.impactScore ?? null,
            significanceType: entry.significanceType ?? null,
            trustScore: entry.trustScore ?? null,
            validationStatus: entry.validationStatus ?? null,
            timestamp: entry.timestamp,
            relCount: stats.relCount,
            causalCount: stats.causalCount,
            worstStatusRank: stats.worstStatusRank,
            nowMs,
        })
        result.set(id, { entry, importance })
    }

    return result
}
