import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { Migration021AddEntityLookupAndPruneAliasIndex } from '../../src/database/migrations/021-add-entity-lookup-and-prune-alias-index.js'

describe('Migration 021: entity lookup composite indexes and alias index pruning', () => {
    it('creates partial composite indexes, drops redundant indexes, and is idempotent', () => {
        const db = new Database(':memory:')
        try {
            MigrationManager.applyTeamMigrations(db)

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            expect(names.has('idx_memory_journal_ws_workflow_recent')).toBe(true)
            expect(names.has('idx_memory_journal_issue_ws_recent')).toBe(true)
            expect(names.has('idx_memory_journal_pr_ws_recent')).toBe(true)
            expect(names.has('idx_author_aliases_alias')).toBe(false)
            expect(names.has('idx_memory_journal_issue')).toBe(false)
            expect(names.has('idx_memory_journal_pr')).toBe(false)

            expect(() => Migration021AddEntityLookupAndPruneAliasIndex.up(db)).not.toThrow()
        } finally {
            db.close()
        }
    })

    it('skips safely on partial legacy retrofit schemas missing required tables or columns', () => {
        const db = new Database(':memory:')
        try {
            db.exec(`
                CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT);
                CREATE TABLE author_aliases (id INTEGER PRIMARY KEY, alias TEXT COLLATE NOCASE);
                CREATE INDEX idx_author_aliases_alias ON author_aliases(alias COLLATE NOCASE);
            `)

            expect(() => Migration021AddEntityLookupAndPruneAliasIndex.up(db)).not.toThrow()

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            expect(names.has('idx_memory_journal_issue_ws_recent')).toBe(false)
            expect(names.has('idx_author_aliases_alias')).toBe(false)
        } finally {
            db.close()
        }
    })
})
