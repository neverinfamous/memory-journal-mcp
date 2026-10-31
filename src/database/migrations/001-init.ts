import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration001Init: Migration = {
    version: 1,
    name: '001-init',
    up(db: Database): void {
        db.exec(`
            -- Main journal entries table (baseline)
            CREATE TABLE IF NOT EXISTS memory_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                is_personal INTEGER DEFAULT 1
            );

            -- Tags table
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                usage_count INTEGER DEFAULT 0
            );

            -- Junction table for entry-tag relationships
            CREATE TABLE IF NOT EXISTS entry_tags (
                entry_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (entry_id, tag_id),
                FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            -- Relationships between entries
            CREATE TABLE IF NOT EXISTS relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_entry_id INTEGER NOT NULL,
                to_entry_id INTEGER NOT NULL,
                relationship_type TEXT NOT NULL,
                description TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
                FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
            );

            -- Legacy embeddings table
            CREATE TABLE IF NOT EXISTS embeddings (
                entry_id INTEGER PRIMARY KEY,
                embedding TEXT NOT NULL,
                model_name TEXT NOT NULL,
                FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
            );

            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_memory_journal_timestamp ON memory_journal(timestamp);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_type ON memory_journal(entry_type);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_personal ON memory_journal(is_personal);
            CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
            CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
            CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
            CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id);
            CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id);

            -- FTS5 full-text search index
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
                content,
                content=memory_journal,
                content_rowid=id,
                tokenize='porter unicode61'
            );

            -- Triggers to keep FTS5 index in sync
            CREATE TRIGGER IF NOT EXISTS fts_content_ai AFTER INSERT ON memory_journal BEGIN
                INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS fts_content_au AFTER UPDATE OF content ON memory_journal BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
                INSERT INTO fts_content(rowid, content) VALUES (new.id, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS fts_content_ad AFTER DELETE ON memory_journal BEGIN
                INSERT INTO fts_content(fts_content, rowid, content) VALUES ('delete', old.id, old.content);
            END;
        `)
    },
}
