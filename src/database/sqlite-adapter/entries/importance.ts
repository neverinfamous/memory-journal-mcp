import type { ImportanceBreakdown, ImportanceResult, JournalEntry } from '../../../types/index.js'
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
                SELECT from_entry_id AS entry_id, relationship_type FROM relationships
                UNION ALL
                SELECT to_entry_id AS entry_id, relationship_type FROM relationships
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
        MAX(COALESCE(e.impact_score, 0.0), CASE WHEN e.significance_type IS NOT NULL THEN 0.5 ELSE 0.0 END) * ${String(w.significance)}
        + MIN(COALESCE(rs.rel_count, 0) * 1.0 / ${String(MAX_RELATIONSHIP_SCORE_AT)}, 1.0) * ${String(w.relationships)}
        + MIN(COALESCE(rs.causal_count, 0) * 1.0 / ${String(MAX_CAUSAL_SCORE_AT)}, 1.0) * ${String(w.causal)}
        + MAX(0, 1.0 - (julianday('now') - julianday(e.timestamp)) / ${String(RECENCY_WINDOW_DAYS)}.0) * ${String(w.recency)}
    ) 
    * CASE COALESCE(ans.worst_status_rank, 3) WHEN 1 THEN 0.1 WHEN 2 THEN 0.8 ELSE 1.0 END
    * (0.5 + COALESCE(e.trust_score, 0.5))
  )`
}

export function calculateImportance(
    context: EntriesSharedContext,
    entryId: number
): ImportanceResult {
    const { db } = context
    const round2 = (n: number): number => Math.round(n * 100) / 100

    const stmt = db.prepare(`SELECT
        m.significance_type as significanceType,
        m.impact_score as impactScore,
        m.trust_score as trustScore,
        m.timestamp,
        (SELECT COUNT(*) FROM relationships
         WHERE from_entry_id = ? OR to_entry_id = ?) AS rel_count,
        (SELECT COUNT(*) FROM relationships
         WHERE (from_entry_id = ? OR to_entry_id = ?)
         AND relationship_type IN ('blocked_by', 'resolved', 'caused')) AS causal_count,
        (SELECT MIN(
            CASE status
                WHEN 'invalidated' THEN 1
                WHEN 'stale' THEN 2
                ELSE 3
            END
         ) FROM entry_anchors WHERE entry_id = ?) AS worst_status_rank
    FROM memory_journal m
    WHERE m.id = ? AND m.deleted_at IS NULL`)

    const row = rowToObject(stmt.get(entryId, entryId, entryId, entryId, entryId, entryId))

    if (!row) {
        return {
            score: 0,
            breakdown: { significance: 0, relationships: 0, causal: 0, recency: 0 },
        }
    }

    const significanceType = row['significanceType'] as string | null
    const impactScore = (row['impactScore'] as number) ?? 0.0
    const trustScore = (row['trustScore'] as number) ?? 0.5
    const timestamp = row['timestamp'] as string
    const relCount = (row['rel_count'] as number) ?? 0
    const causalCount = (row['causal_count'] as number) ?? 0
    const worstStatusRank = (row['worst_status_rank'] as number) ?? 3

    const significanceRaw = Math.max(impactScore, significanceType ? 1.0 : 0.0)
    const relationshipsRaw = Math.min(relCount / MAX_RELATIONSHIP_SCORE_AT, 1.0)
    const causalRaw = Math.min(causalCount / MAX_CAUSAL_SCORE_AT, 1.0)

    const entryDate = new Date(timestamp)
    const now = new Date()
    const daysSince = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
    const recencyRaw = Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS)

    const anchorMultiplier = worstStatusRank === 1 ? 0.1 : (worstStatusRank === 2 ? 0.8 : 1.0)
    const trustMultiplier = 0.5 + trustScore
    const totalModifier = anchorMultiplier * trustMultiplier

    const w = IMPORTANCE_WEIGHTS

    const breakdown: ImportanceBreakdown = {
        significance: round2(significanceRaw * w.significance),
        relationships: round2(relationshipsRaw * w.relationships),
        causal: round2(causalRaw * w.causal),
        recency: round2(recencyRaw * w.recency),
        trustModifier: round2(totalModifier),
    }

    const baseScore = significanceRaw * w.significance +
            relationshipsRaw * w.relationships +
            causalRaw * w.causal +
            recencyRaw * w.recency

    const score = round2(baseScore * totalModifier)

    return { score, breakdown }
}

export function getEntriesByIdsWithImportance(
    context: EntriesSharedContext,
    entryIds: number[]
): Map<number, { entry: JournalEntry; importance: ImportanceResult }> {
    const result = new Map<number, { entry: JournalEntry; importance: ImportanceResult }>()
    if (entryIds.length === 0) return result

    const entriesMap = getEntriesByIds(context, entryIds)
    if (entriesMap.size === 0) return result

    const { db } = context
    const round2 = (n: number): number => Math.round(n * 100) / 100

    const validIds = Array.from(entriesMap.keys())
    const marks = validIds.map(() => '?').join(', ')

    // Single query to get rel_count and causal_count for all matched entry_ids
    const sql = `
        SELECT entry_id,
               COUNT(*) AS rel_count,
               SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
        FROM (
            SELECT from_entry_id AS entry_id, relationship_type FROM relationships WHERE from_entry_id IN (${marks})
            UNION ALL
            SELECT to_entry_id AS entry_id, relationship_type FROM relationships WHERE to_entry_id IN (${marks})
        )
        GROUP BY entry_id
    `
    const rows = db.prepare(sql).all(...validIds, ...validIds) as {
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
    const anchorRows = db.prepare(anchorSql).all(...validIds) as {
        entry_id: number
        worst_status_rank: number
    }[]

    const relData = new Map<number, { relCount: number; causalCount: number; worstStatusRank: number }>()
    for (const id of validIds) {
        relData.set(id, { relCount: 0, causalCount: 0, worstStatusRank: 3 })
    }

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

    const now = new Date()
    const w = IMPORTANCE_WEIGHTS

    for (const [id, entry] of entriesMap.entries()) {
        const stats = relData.get(id) ?? { relCount: 0, causalCount: 0, worstStatusRank: 3 }

        const significanceRaw = Math.max(entry.impactScore ?? 0.0, entry.significanceType ? 0.5 : 0.0)
        const relationshipsRaw = Math.min(stats.relCount / MAX_RELATIONSHIP_SCORE_AT, 1.0)
        const causalRaw = Math.min(stats.causalCount / MAX_CAUSAL_SCORE_AT, 1.0)

        const entryDate = new Date(entry.timestamp)
        const daysSince = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
        const recencyRaw = Math.max(0, 1 - daysSince / RECENCY_WINDOW_DAYS)

        const anchorMultiplier = stats.worstStatusRank === 1 ? 0.1 : (stats.worstStatusRank === 2 ? 0.8 : 1.0)
        const trustMultiplier = 0.5 + (entry.trustScore ?? 0.5)
        const totalModifier = anchorMultiplier * trustMultiplier

        const breakdown: ImportanceBreakdown = {
            significance: round2(significanceRaw * w.significance),
            relationships: round2(relationshipsRaw * w.relationships),
            causal: round2(causalRaw * w.causal),
            recency: round2(recencyRaw * w.recency),
            trustModifier: round2(totalModifier),
        }

        const baseScore = significanceRaw * w.significance +
                relationshipsRaw * w.relationships +
                causalRaw * w.causal +
                recencyRaw * w.recency
                
        const score = round2(baseScore * totalModifier)

        result.set(id, { entry, importance: { score, breakdown } })
    }

    return result
}
