import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration003AddDeletedAndArchived: Migration = {
    version: 3,
    name: '003-add-deleted-and-archived',
    up(db: Database): void {
        db.exec(`
            ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT;
            ALTER TABLE memory_journal ADD COLUMN is_archived INTEGER DEFAULT 0;

            CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at);

            CREATE TRIGGER IF NOT EXISTS fts_content_soft_delete AFTER UPDATE OF deleted_at ON memory_journal 
            WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
            BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
            END;
        `)
    },
}
