import type { Database } from 'better-sqlite3'
import { type Migration, addColumnIfNotExists } from './migration.js'

export const Migration002AddSignificanceAndContext: Migration = {
    version: 2,
    name: '002-add-significance-and-context',
    up(db: Database): void {
        addColumnIfNotExists(db, 'memory_journal', 'significance_type TEXT', 'significance_type')
        addColumnIfNotExists(db, 'memory_journal', 'auto_context TEXT', 'auto_context')
    },
}
