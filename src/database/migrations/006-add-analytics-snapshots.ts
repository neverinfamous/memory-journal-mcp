import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration006AddAnalyticsSnapshots: Migration = {
    version: 6,
    name: '006-add-analytics-snapshots',
    up(db: Database): void {
        db.exec(`
            -- Analytics snapshots for persisted digest data across server restarts
            CREATE TABLE IF NOT EXISTS analytics_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_type TEXT NOT NULL DEFAULT 'digest',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                data TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_created
                ON analytics_snapshots(snapshot_type, created_at DESC);
        `)
    },
}
