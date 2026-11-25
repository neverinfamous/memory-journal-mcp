import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

/**
 * [INTENT] Prune 3 redundant/low-selectivity legacy `001-init` indexes on `memory_journal`
 * (`idx_memory_journal_personal`, `idx_memory_journal_timestamp`, `idx_memory_journal_type`),
 * and add `id DESC` tie-breaker to `idx_analytics_snapshots_type_created` so snapshot queries
 * avoid temp B-tree sorts.
 * [INVARIANT] Preserves covering `idx_memory_journal_deleted` and unscoped `idx_memory_journal_active_timestamp`.
 */
export const Migration024PruneLegacyJournalIndexes: Migration = {
    version: 24,
    name: '024-prune-legacy-journal-indexes',
    up(db: Database): void {
        db.exec(`
            DROP INDEX IF EXISTS idx_memory_journal_personal;
            DROP INDEX IF EXISTS idx_memory_journal_timestamp;
            DROP INDEX IF EXISTS idx_memory_journal_type;
        `)

        const snapshotsExists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'analytics_snapshots'`)
            .get()
        if (snapshotsExists !== undefined) {
            const cols = new Set(
                db
                    .prepare<unknown[], { name: string }>(`PRAGMA table_info(analytics_snapshots)`)
                    .all()
                    .map((r) => r.name.toLowerCase())
            )
            if (cols.has('snapshot_type') && cols.has('created_at') && cols.has('id')) {
                db.exec(`
                    DROP INDEX IF EXISTS idx_analytics_snapshots_type_created;
                    CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_created
                        ON analytics_snapshots(snapshot_type, created_at DESC, id DESC);
                `)
            }
        }
        db.pragma('optimize')
    },
}
