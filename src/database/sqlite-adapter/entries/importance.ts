import type { ImportanceBreakdown, ImportanceResult } from '../../../types/index.js'
import { type EntriesSharedContext, rowToObject } from './shared.js'

const IMPORTANCE_WEIGHTS = {
    significance: 0.3,
    relationships: 0.35,
    causal: 0.2,
    recency: 0.15,
} as const

export function calculateImportance(context: EntriesSharedContext, entryId: number): ImportanceResult {
    const { db } = context
    const round2 = (n: number): number => Math.round(n * 100) / 100

    const stmt = db.prepare(`SELECT
        m.significance_type as significanceType,
        m.timestamp,
        (SELECT COUNT(*) FROM relationships
         WHERE from_entry_id = ? OR to_entry_id = ?) AS rel_count,
        (SELECT COUNT(*) FROM relationships
         WHERE (from_entry_id = ? OR to_entry_id = ?)
         AND relationship_type IN ('blocked_by', 'resolved', 'caused')) AS causal_count
    FROM memory_journal m
    WHERE m.id = ? AND m.deleted_at IS NULL`)

    const row = rowToObject(stmt.get(entryId, entryId, entryId, entryId, entryId))

    if (!row) {
        return {
            score: 0,
            breakdown: { significance: 0, relationships: 0, causal: 0, recency: 0 },
        }
    }

    const significanceType = row['significanceType'] as string | null
    const timestamp = row['timestamp'] as string
    const relCount = (row['rel_count'] as number) ?? 0
    const causalCount = (row['causal_count'] as number) ?? 0

    const significanceRaw = significanceType ? 1.0 : 0.0
    const relationshipsRaw = Math.min(relCount / 5, 1.0)
    const causalRaw = Math.min(causalCount / 3, 1.0)

    const entryDate = new Date(timestamp)
    const now = new Date()
    const daysSince = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
    const recencyRaw = Math.max(0, 1 - daysSince / 90)

    const w = IMPORTANCE_WEIGHTS

    const breakdown: ImportanceBreakdown = {
        significance: round2(significanceRaw * w.significance),
        relationships: round2(relationshipsRaw * w.relationships),
        causal: round2(causalRaw * w.causal),
        recency: round2(recencyRaw * w.recency),
    }

    const score = round2(
        significanceRaw * w.significance +
            relationshipsRaw * w.relationships +
            causalRaw * w.causal +
            recencyRaw * w.recency
    )

    return { score, breakdown }
}
