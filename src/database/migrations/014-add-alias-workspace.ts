import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration014AddAliasWorkspace: Migration = {
    version: 14,
    name: '014-add-alias-workspace',
    up(db: Database): void {
        const table = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'author_aliases'`)
            .get()
        if (table === undefined) return

        const column = db
            .prepare(`SELECT 1 FROM pragma_table_info('author_aliases') WHERE name = 'workspace_id'`)
            .get()
        if (column === undefined) {
            db.prepare(`ALTER TABLE author_aliases ADD COLUMN workspace_id TEXT`).run()
        }

        db.exec(
            `CREATE INDEX IF NOT EXISTS idx_author_aliases_workspace ON author_aliases(workspace_id)`
        )
    },
}
