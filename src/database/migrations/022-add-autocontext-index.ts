import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

/**
 * [INTENT] Partial index on `auto_context IS NOT NULL` so briefing commit→entry cross-link
 * queries (`queryEntryIdsByCommitShas`) scan only entries carrying `auto_context` instead of
 * full workspace tables.
 */
export const Migration022AddAutoContextIndex: Migration = {
    version: 22,
    name: '022-add-autocontext-index',
    up(db: Database): void {
        const exists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'`)
            .get()
        if (exists === undefined) return
        const cols = new Set(
            (db.prepare(`PRAGMA table_info(memory_journal)`).all() as { name: string }[]).map((r) =>
                r.name.toLowerCase()
            )
        )
        if (!cols.has('workspace_id') || !cols.has('auto_context') || !cols.has('deleted_at')) {
            return
        }
        db.exec(
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_autocontext
             ON memory_journal(workspace_id, id)
             WHERE deleted_at IS NULL AND auto_context IS NOT NULL`
        )
        db.pragma('optimize')
    },
}
