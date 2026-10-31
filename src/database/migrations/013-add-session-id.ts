import type { Migration } from './migration.js'

import type { Database } from 'better-sqlite3'

export const Migration013AddSessionId: Migration = {
    version: 13,
    name: '013-add-session-id',
    up: (db: Database) => {
        // Add session_id column for agent isolation
        db.exec(`
            ALTER TABLE memory_journal ADD COLUMN session_id TEXT;
        `)
    },
}
