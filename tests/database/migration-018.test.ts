import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { Migration018AddProjectAndPruneDuplicateIndexes } from '../../src/database/migrations/018-add-project-and-prune-duplicate-indexes.js'

describe('Migration 018: composite project index and duplicate index pruning', () => {
    it('creates idx_memory_journal_ws_proj_recent, drops duplicate indexes, preserves covering indexes, and is idempotent', () => {
        const db = new Database(':memory:')
        try {
            MigrationManager.applyTeamMigrations(db)

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            expect(names.has('idx_memory_journal_ws_proj_recent')).toBe(true)
            expect(names.has('idx_entry_tags_tag_entry')).toBe(true)
            expect(names.has('idx_entry_tags_tag')).toBe(false)
            expect(names.has('idx_team_members_author')).toBe(false)
            // Preserve implicit covering and unscoped indexes
            expect(names.has('idx_memory_journal_deleted')).toBe(true)
            expect(names.has('idx_memory_journal_active_timestamp')).toBe(true)

            expect(() => Migration018AddProjectAndPruneDuplicateIndexes.up(db)).not.toThrow()
        } finally {
            db.close()
        }
    })

    it('skips safely on partial legacy retrofit schemas missing required tables or columns', () => {
        const db = new Database(':memory:')
        try {
            db.exec(`
                CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT);
                CREATE TABLE team_members (id INTEGER PRIMARY KEY, author TEXT UNIQUE COLLATE NOCASE);
                CREATE INDEX idx_team_members_author ON team_members(author COLLATE NOCASE);
            `)

            expect(() => Migration018AddProjectAndPruneDuplicateIndexes.up(db)).not.toThrow()

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            expect(names.has('idx_memory_journal_ws_proj_recent')).toBe(false)
            expect(names.has('idx_team_members_author')).toBe(false)
        } finally {
            db.close()
        }
    })
})
