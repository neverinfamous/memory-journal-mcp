import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

/**
 * Rebuild author_aliases so the same alias can exist in different workspaces.
 * Legacy rows with a NULL workspace_id stay as the shared tier.
 */
export const Migration015AliasWorkspaceUnique: Migration = {
    version: 15,
    name: '015-alias-workspace-unique',
    up(db: Database): void {
        const table = db
            .prepare<unknown[], { sql: string }>(
                `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'author_aliases'`
            )
            .get()
        if (table === undefined) return
        if (/UNIQUE\s*\(\s*alias\s*,\s*workspace_id\s*\)/i.test(table.sql)) return

        const fts = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fts_content'`).get()
        if (fts === undefined) {
            db.exec(`DROP TRIGGER IF EXISTS fts_content_soft_delete`)
        }

        db.exec(`
            CREATE TABLE author_aliases_v15 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alias TEXT NOT NULL COLLATE NOCASE,
                canonical_author TEXT NOT NULL COLLATE NOCASE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                created_by TEXT,
                workspace_id TEXT,
                UNIQUE (alias, workspace_id)
            );

            INSERT INTO author_aliases_v15 (id, alias, canonical_author, created_at, created_by, workspace_id)
            SELECT id, alias, canonical_author, created_at, created_by, workspace_id
            FROM author_aliases
            WHERE id IN (
                SELECT MIN(id)
                FROM author_aliases
                GROUP BY alias COLLATE NOCASE, IFNULL(workspace_id, '')
            );

            DROP TABLE author_aliases;
            ALTER TABLE author_aliases_v15 RENAME TO author_aliases;

            CREATE INDEX IF NOT EXISTS idx_author_aliases_alias ON author_aliases(alias COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_author_aliases_canonical ON author_aliases(canonical_author COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_author_aliases_workspace ON author_aliases(workspace_id);
        `)
    },
}
