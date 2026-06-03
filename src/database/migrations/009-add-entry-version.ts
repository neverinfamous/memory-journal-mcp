import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration009AddEntryVersion: Migration = {
    version: 9,
    name: 'add-entry-version',
    up(db: Database): void {
        // Self-healing check: check if the column already exists
        const columns = db.pragma('table_info(memory_journal)') as { name: string }[]
        const hasVersion = columns.some((col) => col.name === 'version')

        if (!hasVersion) {
            db.prepare(
                'ALTER TABLE memory_journal ADD COLUMN version INTEGER NOT NULL DEFAULT 1'
            ).run()
        }
    },
}
