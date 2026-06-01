import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration005AddEntryRevisions: Migration = {
    version: 5,
    name: '005-add-entry-revisions',
    up(db: Database): void {
        db.exec(`
            -- Entry revisions for history tracking
            CREATE TABLE IF NOT EXISTS entry_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL,
                revision_number INTEGER NOT NULL,
                content_snapshot TEXT NOT NULL,
                changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                changed_by TEXT,
                FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_entry_revisions_entry_id ON entry_revisions(entry_id, revision_number DESC);

            -- Composite covering index for getRecentEntries (WHERE deleted_at IS NULL ORDER BY timestamp DESC, id DESC)
            CREATE INDEX IF NOT EXISTS idx_memory_journal_recent ON memory_journal(deleted_at, timestamp DESC, id DESC);

            -- Partial index on active entries to speed up timestamp queries without indexing deleted rows
            CREATE INDEX IF NOT EXISTS idx_memory_journal_active_timestamp ON memory_journal(timestamp DESC) WHERE deleted_at IS NULL;

            -- Partial covering index for the most common query pattern (active & non-archived sorted by timestamp)
            CREATE INDEX IF NOT EXISTS idx_memory_journal_active_recent ON memory_journal(timestamp DESC, id DESC) WHERE deleted_at IS NULL AND is_archived = 0;

            -- Composite partial index for entry type searches sorted/grouped by timestamp
            CREATE INDEX IF NOT EXISTS idx_memory_journal_type_timestamp ON memory_journal(entry_type, timestamp DESC) WHERE deleted_at IS NULL;
        `)
    },
}
