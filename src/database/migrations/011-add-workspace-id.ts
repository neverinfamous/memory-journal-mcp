import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration011AddWorkspaceId: Migration = {
    version: 11,
    name: '011-add-workspace-id',
    up(db: Database): void {
        const columnExists = Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'workspace_id'`).get());
        if (!columnExists) {
            db.prepare(`ALTER TABLE memory_journal ADD COLUMN workspace_id TEXT DEFAULT 'default'`).run();
        }

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_memory_journal_workspace ON memory_journal(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_active_recent
                ON memory_journal(workspace_id, timestamp DESC, id DESC)
                WHERE deleted_at IS NULL AND is_archived = 0;
            DROP INDEX IF EXISTS idx_memory_journal_active_recent;
        `);
    }
}
