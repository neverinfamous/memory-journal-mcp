import type { Database } from 'better-sqlite3'
import { type Migration, addColumnIfNotExists } from './migration.js'

export const Migration009AddEntryVersion: Migration = {
    version: 9,
    name: 'add-entry-version',
    up(db: Database): void {
        addColumnIfNotExists(db, 'memory_journal', 'version INTEGER NOT NULL DEFAULT 1', 'version')
    },
}
