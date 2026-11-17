import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { Migration017AddPerformanceIndexes } from '../../src/database/migrations/017-add-performance-indexes.js'

const EXPECTED_INDEXES = [
    'idx_memory_journal_ws_recent',
    'idx_memory_journal_session',
    'idx_memory_journal_workflow',
    'idx_memory_journal_ws_significant',
    'idx_tags_lower_name',
    'idx_entry_tags_tag_entry',
    'idx_relationships_created_at',
]

describe('Migration 017: performance indexes', () => {
    it('creates performance indexes, drops redundant indexes, and is idempotent', () => {
        const db = new Database(':memory:')
        try {
            MigrationManager.runMigrations(db, false)

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            for (const expected of EXPECTED_INDEXES) {
                expect(names.has(expected)).toBe(true)
            }
            expect(names.has('idx_tags_name')).toBe(false)
            expect(names.has('idx_entry_tags_entry')).toBe(false)

            // Idempotent repeat execution
            expect(() => Migration017AddPerformanceIndexes.up(db)).not.toThrow()
        } finally {
            db.close()
        }
    })

    it('skips indexes safely when legacy retrofit database lacks optional tables or columns', () => {
        const db = new Database(':memory:')
        try {
            db.exec(`
                CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT);
                CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
                CREATE INDEX idx_tags_name ON tags(name);
            `)

            expect(() => Migration017AddPerformanceIndexes.up(db)).not.toThrow()

            const rows = db
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
                .all() as { name: string }[]
            const names = new Set(rows.map((r) => r.name))

            expect(names.has('idx_tags_lower_name')).toBe(true)
            expect(names.has('idx_tags_name')).toBe(false)
            expect(names.has('idx_memory_journal_ws_recent')).toBe(false)
            expect(names.has('idx_entry_tags_tag_entry')).toBe(false)
            expect(names.has('idx_relationships_created_at')).toBe(false)
        } finally {
            db.close()
        }
    })
})
