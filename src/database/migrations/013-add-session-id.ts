import { addColumnIfNotExists, type Migration } from './migration.js'

import type { Database } from 'better-sqlite3'

export const Migration013AddSessionId: Migration = {
    version: 13,
    name: '013-add-session-id',
    up: (db: Database) => {
        // Add session_id column for agent isolation idempotently
        addColumnIfNotExists(db, 'memory_journal', 'session_id TEXT', 'session_id')
    },
}
