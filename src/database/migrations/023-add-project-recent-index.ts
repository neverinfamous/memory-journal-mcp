import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

/**
 * [INTENT] Replace redundant single-column `idx_memory_journal_project` with a partial
 * covering composite index `(project_number, timestamp DESC, id DESC)` so unscoped
 * (`workspace_id = '*'`) project lookups avoid scanning active rows by timestamp.
 */
export const Migration023AddProjectRecentIndex: Migration = {
    version: 23,
    name: '023-add-project-recent-index',
    up(db: Database): void {
        db.exec(`DROP INDEX IF EXISTS idx_memory_journal_project`)
        const exists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'`)
            .get()
        if (exists === undefined) return
        const cols = new Set(
            db
                .prepare<unknown[], { name: string }>(`PRAGMA table_info(memory_journal)`)
                .all()
                .map((r) => r.name.toLowerCase())
        )
        if (!cols.has('project_number') || !cols.has('timestamp') || !cols.has('deleted_at')) {
            return
        }
        db.exec(
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_project_recent
             ON memory_journal(project_number, timestamp DESC, id DESC)
             WHERE deleted_at IS NULL AND project_number IS NOT NULL`
        )
        db.pragma('optimize')
    },
}
