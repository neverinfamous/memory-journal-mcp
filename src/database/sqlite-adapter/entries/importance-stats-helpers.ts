import type { ImportanceResult } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { DUAL_IN_PARAM_BUCKETS, bucketInParams } from '../row-helpers.js'

/** Per-entry relationship/anchor statistics feeding the importance score. */
export interface ImportanceStats {
    relCount: number
    causalCount: number
    worstStatusRank: number
}

function loadRelStatsChunk(
    db: EntriesSharedContext['db'],
    marks: string,
    bucket: number[],
    relData: Map<number, ImportanceStats>,
    scopedPeerWorkspace: boolean
): void {
    const fromJoin = scopedPeerWorkspace
        ? 'CROSS JOIN memory_journal self_e ON self_e.id = r.from_entry_id CROSS JOIN memory_journal peer ON peer.id = r.to_entry_id AND peer.deleted_at IS NULL AND peer.workspace_id = self_e.workspace_id AND r.from_entry_id != r.to_entry_id'
        : 'CROSS JOIN memory_journal peer ON peer.id = r.to_entry_id AND peer.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id'
    const toJoin = scopedPeerWorkspace
        ? 'CROSS JOIN memory_journal self_e ON self_e.id = r.to_entry_id CROSS JOIN memory_journal peer ON peer.id = r.from_entry_id AND peer.deleted_at IS NULL AND peer.workspace_id = self_e.workspace_id AND r.from_entry_id != r.to_entry_id'
        : 'CROSS JOIN memory_journal peer ON peer.id = r.from_entry_id AND peer.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id'
    const sql = `
        SELECT entry_id,
               COUNT(*) AS rel_count,
               SUM(CASE WHEN relationship_type IN ('blocked_by', 'resolved', 'caused') THEN 1 ELSE 0 END) AS causal_count
        FROM (
            SELECT r.from_entry_id AS entry_id, r.relationship_type
            FROM relationships r
            ${fromJoin}
            WHERE r.from_entry_id IN (${marks})
            UNION ALL
            SELECT r.to_entry_id AS entry_id, r.relationship_type
            FROM relationships r
            ${toJoin}
            WHERE r.to_entry_id IN (${marks})
        )
        GROUP BY entry_id
    `
    const rows = db
        .prepare<unknown[], { entry_id: number; rel_count: number; causal_count: number }>(sql)
        .all(...bucket, ...bucket)
    for (const row of rows) {
        const d = relData.get(row.entry_id)
        if (d) {
            d.relCount = row.rel_count
            d.causalCount = row.causal_count
        }
    }
}

function loadAnchorStatsChunk(
    db: EntriesSharedContext['db'],
    marks: string,
    bucket: number[],
    relData: Map<number, ImportanceStats>
): void {
    const anchorSql = `
        SELECT entry_id,
               MIN(CASE status WHEN 'invalidated' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END) AS worst_status_rank
        FROM entry_anchors WHERE entry_id IN (${marks})
        GROUP BY entry_id
    `
    const anchorRows = db
        .prepare<unknown[], { entry_id: number; worst_status_rank: number }>(anchorSql)
        .all(...bucket)
    for (const row of anchorRows) {
        const d = relData.get(row.entry_id)
        if (d) {
            d.worstStatusRank = row.worst_status_rank
        }
    }
}

/**
 * Load relationship counts and worst anchor status for a set of entries using bucketed batched queries.
 * When `scopedPeerWorkspace` is true, foreign-workspace relationship peers are excluded.
 */
export function loadImportanceStats(
    db: EntriesSharedContext['db'],
    validIds: number[],
    scopedPeerWorkspace = true
): Map<number, ImportanceStats> {
    const relData = new Map<number, ImportanceStats>()
    for (const id of validIds) {
        relData.set(id, { relCount: 0, causalCount: 0, worstStatusRank: 3 })
    }
    for (const { placeholders, params } of bucketInParams(validIds, DUAL_IN_PARAM_BUCKETS)) {
        loadRelStatsChunk(db, placeholders, params, relData, scopedPeerWorkspace)
    }
    for (const { placeholders, params } of bucketInParams(validIds)) {
        loadAnchorStatsChunk(db, placeholders, params, relData)
    }
    return relData
}

export function computeBreakdownScore(
    entry: {
        impactScore?: number | null
        significanceType?: string | null
        trustScore?: number | null
        validationStatus?: string | null
        timestamp: string
    },
    stats: ImportanceStats,
    nowMs: number,
    computeFn: (params: {
        impactScore: number | null
        significanceType: string | null
        trustScore: number | null
        validationStatus: string | null
        timestamp: string
        relCount: number
        causalCount: number
        worstStatusRank: number
        nowMs: number
    }) => ImportanceResult
): ImportanceResult {
    return computeFn({
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
}
