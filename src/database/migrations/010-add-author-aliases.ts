import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration010AddAuthorAliases: Migration = {
    version: 10,
    name: '010-add-author-aliases',
    up(db: Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS author_aliases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
                canonical_author TEXT NOT NULL COLLATE NOCASE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                created_by TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_author_aliases_alias ON author_aliases(alias COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_author_aliases_canonical ON author_aliases(canonical_author COLLATE NOCASE);
        `)
    },
}
