import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration008AddTeamMembers: Migration = {
    version: 8,
    name: '008-add-team-members',
    up(db: Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS team_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author TEXT NOT NULL UNIQUE COLLATE NOCASE,
                role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
                display_name TEXT,
                added_by TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_team_members_author ON team_members(author COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);
        `)
    },
}
