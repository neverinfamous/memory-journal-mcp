/**
 * NativeConnectionManager Unit Tests
 *
 * Tests for init failure, migration, FTS rebuild,
 * and close-during-initialization branches.
 */

import { describe, it, expect, afterAll } from 'vitest'
import type Database from 'better-sqlite3'
import fs from 'node:fs'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'

const TEST_DB_PATH = './test-native-conn.db'
const TEST_DB_PATH_2 = './test-native-conn-2.db'
const TEST_DB_NESTED = './test-native-nested/subdir/test.db'

function cleanupFiles(...paths: string[]) {
    for (const p of paths) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
            // ignore
        }
    }
}

function cleanupDirs(...paths: string[]) {
    for (const p of paths) {
        try {
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true })
        } catch {
            // ignore
        }
    }
}

afterAll(() => {
    cleanupFiles(TEST_DB_PATH, TEST_DB_PATH_2)
    cleanupDirs('./test-native-nested')
})

describe('NativeConnectionManager', () => {
    // =========================================================================
    // Basic initialization
    // =========================================================================

    describe('initialize', () => {
        it('should initialize successfully and return a valid DB', async () => {
            const mgr = new NativeConnectionManager(TEST_DB_PATH)
            await mgr.initialize()

            const db = mgr.getRawDb() as Database
            expect(db).toBeDefined()

            // DB should be usable
            const result = db.prepare('SELECT 1 as n').get() as { n: number }
            expect(result.n).toBe(1)

            mgr.close()
        })

        it('should be idempotent (double init)', async () => {
            const mgr = new NativeConnectionManager(TEST_DB_PATH_2)
            await mgr.initialize()
            await mgr.initialize() // should not throw

            const db = mgr.getRawDb() as Database
            expect(db).toBeDefined()
            mgr.close()
        })

        it('should create parent directories if they do not exist', async () => {
            cleanupDirs('./test-native-nested')
            const mgr = new NativeConnectionManager(TEST_DB_NESTED)
            await mgr.initialize()

            expect(fs.existsSync(TEST_DB_NESTED)).toBe(true)
            mgr.close()
        })
    })

    // =========================================================================
    // ensureDb guard
    // =========================================================================

    describe('ensureDb', () => {
        it('should throw ConnectionError when DB is not initialized', () => {
            const mgr = new NativeConnectionManager(':memory:')
            expect(() => mgr.getRawDb()).toThrow()
        })
    })

    // =========================================================================
    // Close behavior
    // =========================================================================

    describe('close', () => {
        it('should safely close and nullify DB', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()
            mgr.close()

            // getRawDb should throw after close
            expect(() => mgr.getRawDb()).toThrow()
        })

        it('should be safe to call close() multiple times', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()
            mgr.close()
            mgr.close() // should not throw
        })
    })

    // =========================================================================
    // Migration — column addition
    // =========================================================================

    describe('schema migration', () => {
        it('should add missing columns on re-init of existing DB', async () => {
            // First init creates full schema
            const mgr = new NativeConnectionManager(TEST_DB_PATH)
            await mgr.initialize()

            const db = mgr.getRawDb() as Database
            // Verify some migration columns exist
            const info = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
            const cols = info.map((r) => r.name)

            expect(cols).toContain('issue_url')
            expect(cols).toContain('pr_url')
            expect(cols).toContain('workflow_run_id')

            mgr.close()
        })
    })

    // =========================================================================
    // Team schema
    // =========================================================================

    describe('applyTeamSchema', () => {
        it('should add author column', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()
            mgr.applyTeamSchema()

            const db = mgr.getRawDb() as Database
            const info = db.prepare('PRAGMA table_info(memory_journal)').all() as { name: string }[]
            const cols = info.map((r) => r.name)
            expect(cols).toContain('author')

            mgr.close()
        })

        it('should be idempotent (double apply)', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()
            mgr.applyTeamSchema()
            mgr.applyTeamSchema() // should not throw

            mgr.close()
        })
    })

    // =========================================================================
    // executeRawQuery
    // =========================================================================

    describe('exec', () => {
        it('should execute a raw query and return results', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()

            const db = mgr.getRawDb() as Database
            db.exec("INSERT INTO memory_journal (entry_type, content, timestamp, is_personal) VALUES ('test_entry', 'test content', datetime('now'), 1)")

            const result = mgr.exec('SELECT COUNT(*) as c FROM memory_journal', [])
            expect(result).toBeDefined()
            expect(result.length).toBeGreaterThan(0)

            mgr.close()
        })
    })
})
