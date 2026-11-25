import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

/**
 * [INTENT] Keep the external-content FTS5 index consistent with soft-delete state.
 * [INVARIANT] fts_content holds exactly the rows where deleted_at IS NULL. Issuing an
 * FTS 'delete' for a row that is not indexed corrupts the index (SQLITE_CORRUPT_VTAB),
 * so update/hard-delete triggers only fire for live rows, and restore re-inserts.
 */
export const Migration016FtsSoftDeleteTriggers: Migration = {
    version: 16,
    name: '016-fts-soft-delete-triggers',
    up(db: Database): void {
        const fts = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fts_content'`).get()
        if (fts === undefined) return

        db.exec(`
            DROP TRIGGER IF EXISTS fts_content_au;
            DROP TRIGGER IF EXISTS fts_content_ad;
            DROP TRIGGER IF EXISTS fts_content_soft_delete;
            DROP TRIGGER IF EXISTS fts_content_restore;

            CREATE TRIGGER fts_content_au AFTER UPDATE OF content ON memory_journal
            WHEN old.deleted_at IS NULL AND new.deleted_at IS NULL
            BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
                INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
            END;

            CREATE TRIGGER fts_content_ad AFTER DELETE ON memory_journal
            WHEN old.deleted_at IS NULL
            BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
            END;

            CREATE TRIGGER fts_content_soft_delete AFTER UPDATE OF deleted_at ON memory_journal
            WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
            BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
            END;

            CREATE TRIGGER fts_content_restore AFTER UPDATE OF deleted_at ON memory_journal
            WHEN new.deleted_at IS NULL AND old.deleted_at IS NOT NULL
            BEGIN
                INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
            END;

            -- [SIDE-EFFECT] One-time rebuild of live rows to repair prior desync.
            INSERT INTO fts_content(fts_content) VALUES ('delete-all');
            INSERT INTO fts_content(rowid, content)
                SELECT id, content FROM memory_journal WHERE deleted_at IS NULL;
        `)
    },
}
