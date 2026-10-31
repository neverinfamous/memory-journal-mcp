import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration012AddTrustAndAnchors: Migration = {
    version: 12,
    name: '012-add-trust-and-anchors',
    up(db: Database): void {
        const trustScoreExists = Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'trust_score'`).get());
        if (!trustScoreExists) {
            db.prepare(`ALTER TABLE memory_journal ADD COLUMN trust_score REAL DEFAULT 0.5`).run();
        }

        const validationStatusExists = Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'validation_status'`).get());
        if (!validationStatusExists) {
            db.prepare(`ALTER TABLE memory_journal ADD COLUMN validation_status TEXT DEFAULT 'none'`).run();
        }

        const impactScoreExists = Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'impact_score'`).get());
        if (!impactScoreExists) {
            db.prepare(`ALTER TABLE memory_journal ADD COLUMN impact_score REAL DEFAULT 0.0`).run();
        }

        db.exec(`
            CREATE TABLE IF NOT EXISTS entry_anchors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL,
                anchor_path TEXT NOT NULL,
                anchor_type TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                last_checked_at TEXT,
                FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_entry_anchors_entry_id ON entry_anchors(entry_id);
            CREATE INDEX IF NOT EXISTS idx_entry_anchors_anchor_path ON entry_anchors(anchor_path);
        `);
    }
}
