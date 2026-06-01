import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration002AddSignificanceAndContext: Migration = {
    version: 2,
    name: '002-add-significance-and-context',
    up(db: Database): void {
        db.exec(`
            ALTER TABLE memory_journal ADD COLUMN significance_type TEXT;
            ALTER TABLE memory_journal ADD COLUMN auto_context TEXT;
        `)
    },
}
