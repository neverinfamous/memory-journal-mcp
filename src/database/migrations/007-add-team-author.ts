import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration007AddTeamAuthor: Migration = {
    version: 7,
    name: '007-add-team-author',
    up(db: Database): void {
        db.exec(`
            ALTER TABLE memory_journal ADD COLUMN author TEXT;
        `)
    },
}
