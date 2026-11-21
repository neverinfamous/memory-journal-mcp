import type { Database } from 'better-sqlite3'
import { bucketInParams } from '../row-helpers.js'

const originColumnCache = new WeakMap<object, { schemaVersion: number; hasCol: boolean }>()

function getSchemaVersion(db: Database): number | undefined {
    if (typeof db.pragma !== 'function') return undefined
    const raw = db.pragma('schema_version', { simple: true })
    return typeof raw === 'number' ? raw : undefined
}

function hasOriginColumn(db: Database): boolean {
    const schemaVersion = getSchemaVersion(db)
    const cached = originColumnCache.get(db)
    if (cached !== undefined && (schemaVersion === undefined || cached.schemaVersion === schemaVersion)) {
        return cached.hasCol
    }
    const rows = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
    const hasCol = rows.some((row) => row.name === 'origin_personal_id')
    if (hasCol || schemaVersion !== undefined) {
        originColumnCache.set(db, { schemaVersion: schemaVersion ?? -1, hasCol })
    }
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
