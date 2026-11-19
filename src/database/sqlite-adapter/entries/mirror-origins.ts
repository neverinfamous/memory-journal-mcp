import type { Database } from 'better-sqlite3'
import { bucketInParams } from '../row-helpers.js'

const originColumnCache = new WeakMap<object, boolean>()

function hasOriginColumn(db: Database): boolean {
    const cached = originColumnCache.get(db)
    if (cached !== undefined) return cached
    const rows = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
    const hasCol = rows.some((row) => row.name === 'origin_personal_id')
    // [INVARIANT] Only cache positives: migration 020 may add the column later on this handle.
    if (hasCol) originColumnCache.set(db, true)
    return hasCol
}

/**
 * Team DB: map team entry ID -> origin personal ID for mirrored rows (migration 020).
 * Returns an empty map on databases without the column (personal DBs, pre-020 team DBs).
 */
export function getMirrorOrigins(db: Database, entryIds: readonly number[]): Map<number, number> {
    const origins = new Map<number, number>()
    if (entryIds.length === 0 || !hasOriginColumn(db)) return origins
    const unique = Array.from(new Set(entryIds))
    for (const { placeholders, params } of bucketInParams(unique)) {
        const rows = db
            .prepare(
                `SELECT id, origin_personal_id AS originPersonalId FROM memory_journal WHERE id IN (${placeholders}) AND origin_personal_id IS NOT NULL`
            )
            .all(...params) as { id: number; originPersonalId: number }[]
        for (const row of rows) origins.set(row.id, row.originPersonalId)
    }
    return origins
}
