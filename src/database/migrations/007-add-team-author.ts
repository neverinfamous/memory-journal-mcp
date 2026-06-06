import type { Database } from 'better-sqlite3'
import { type Migration, addColumnIfNotExists } from './migration.js'

export const Migration007AddTeamAuthor: Migration = {
    version: 7,
    name: '007-add-team-author',
    up(db: Database): void {
        addColumnIfNotExists(db, 'memory_journal', 'author TEXT', 'author')
    },
}
