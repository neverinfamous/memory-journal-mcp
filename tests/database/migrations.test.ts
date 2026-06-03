import { describe, it, expect } from 'vitest'
import DatabaseAdapter from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'

describe('Database Migration Framework', () => {
    it('should initialize a fresh database with all migrations applied', () => {
        const db = new DatabaseAdapter(':memory:')

        // Run migrations
        MigrationManager.runMigrations(db, false)

        // Verify schema_migrations exists and is populated
        const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as {
            version: number
            name: string
        }[]

        expect(applied.length).toBe(8) // 1 to 6, plus 8, 9
        expect(applied[0].version).toBe(1)
        expect(applied[0].name).toBe('001-init')
        expect(applied[6].version).toBe(8)
        expect(applied[6].name).toBe('008-add-team-members')

        // Verify tables exist
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memory_journal', 'tags', 'entry_tags', 'relationships', 'entry_revisions', 'analytics_snapshots')")
            .all() as { name: string }[]
        const tableNames = tables.map((t) => t.name)
        expect(tableNames).toContain('memory_journal')
        expect(tableNames).toContain('tags')
        expect(tableNames).toContain('entry_tags')
        expect(tableNames).toContain('relationships')
        expect(tableNames).toContain('entry_revisions')
        expect(tableNames).toContain('analytics_snapshots')

        // Verify columns in memory_journal
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
        const cols = tableInfo.map((row) => row.name)
        expect(cols).toContain('id')
        expect(cols).toContain('content')
        expect(cols).toContain('significance_type')
        expect(cols).toContain('deleted_at')
        expect(cols).toContain('is_archived')
        expect(cols).toContain('project_number')
        expect(cols).not.toContain('author') // personal db should not have author

        db.close()
    })

    it('should apply team migrations (version 7) when requested', () => {
        const db = new DatabaseAdapter(':memory:')

        // Run team migrations
        MigrationManager.applyTeamMigrations(db)

        // Verify schema_migrations contains version 7
        const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as {
            version: number
            name: string
        }[]

        expect(applied.length).toBe(9)
        expect(applied[7].version).toBe(8) // since 007 is applied after 008 if not careful? Wait, 007 is 7, 008 is 8. So it sorts by version. applied[6] = 7, applied[7] = 8.
        expect(applied[6].version).toBe(7)
        expect(applied[6].name).toBe('007-add-team-author')

        // Verify memory_journal has author column
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
        const cols = tableInfo.map((row) => row.name)
        expect(cols).toContain('author')

        db.close()
    })

    it('should self-heal and retrofit a pre-migration-framework database', () => {
        const db = new DatabaseAdapter(':memory:')

        // 1. Manually create pre-existing database schema matching an older version
        // Let's simulate a database that had the base tables plus significance_type and auto_context (up to Version 2)
        db.exec(`
            CREATE TABLE memory_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                is_personal INTEGER DEFAULT 1,
                significance_type TEXT,
                auto_context TEXT
            );

            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                usage_count INTEGER DEFAULT 0
            );
        `)

        // 2. Run MigrationManager
        // This should auto-detect memory_journal, verify columns, retrofit versions 1 and 2,
        // and then run migrations 3, 4, 5, 6 automatically!
        MigrationManager.runMigrations(db, false)

        // 3. Verify schema_migrations was retrofitted and advanced
        const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as {
            version: number
            name: string
        }[]

        expect(applied.length).toBe(8)
        expect(applied[0].version).toBe(1)
        expect(applied[1].version).toBe(2)
        expect(applied[2].version).toBe(3) // applied in run
        expect(applied[6].version).toBe(8) // applied in run

        // Verify newer tables like entry_revisions exist now
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entry_revisions', 'analytics_snapshots')")
            .all() as { name: string }[]
        const tableNames = tables.map((t) => t.name)
        expect(tableNames).toContain('entry_revisions')
        expect(tableNames).toContain('analytics_snapshots')

        // Verify newer columns like project_number and deleted_at exist
        const tableInfo = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
        const cols = tableInfo.map((row) => row.name)
        expect(cols).toContain('deleted_at')
        expect(cols).toContain('project_number')

        db.close()
    })

    it('should be idempotent (running migrations twice is a no-op)', () => {
        const db = new DatabaseAdapter(':memory:')

        // First run
        MigrationManager.runMigrations(db, false)
        const count1 = (db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number }).c

        // Second run
        MigrationManager.runMigrations(db, false)
        const count2 = (db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number }).c

        expect(count1).toBe(8)
        expect(count2).toBe(8)

        db.close()
    })
})
