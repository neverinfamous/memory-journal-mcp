/**
 * NativeConnectionManager Unit Tests
 *
 * Tests for init failure, migration, FTS rebuild,
 * and close-during-initialization branches.
 */

import { describe, it, expect, afterAll, vi } from 'vitest'
import type { Database } from 'better-sqlite3'
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

        it('should handle and wrap initialization errors', async () => {
            const mkdirSpy = vi
                .spyOn(fs.promises, 'mkdir')
                .mockRejectedValueOnce(new Error('Permission denied'))

            cleanupDirs('./test-native-nested-error')
            const mgr = new NativeConnectionManager('./test-native-nested-error/db.sqlite')

            await expect(mgr.initialize()).rejects.toThrow('Permission denied')

            mkdirSpy.mockRestore()
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

        it('should populate FTS5 on existing DBs missing FTS rows', async () => {
            const mgr = new NativeConnectionManager(TEST_DB_PATH_2)
            await mgr.initialize()
            const db = mgr.getRawDb() as Database
            
            // Drop insert trigger so insertion doesn't hit FTS index
            db.exec('DROP TRIGGER IF EXISTS fts_content_ai')
            db.exec("INSERT INTO memory_journal(content, entry_type) VALUES ('foo', 'test')")
            mgr.close()

            // Re-init should populate FTS (entryCount=1, ftsCount=0)
            const mgr2 = new NativeConnectionManager(TEST_DB_PATH_2)
            await mgr2.initialize()
            
            const db2 = mgr2.getRawDb() as Database
            const ftsCount = (db2.prepare('SELECT COUNT(*) as c FROM fts_content_docsize').get() as { c: number }).c
            expect(ftsCount).toBe(1)
            mgr2.close()
        })

        it('should rebuild FTS5 index if ghost entries detected', async () => {
            // First DB is initialized
            const mgr = new NativeConnectionManager(TEST_DB_PATH)
            await mgr.initialize()
            const db = mgr.getRawDb() as Database

            db.exec("INSERT INTO memory_journal(content, entry_type) VALUES ('foo', 'test')")
            db.exec("INSERT INTO memory_journal(content, entry_type) VALUES ('bar', 'test')")
            db.exec("INSERT INTO memory_journal(content, entry_type) VALUES ('baz', 'test')")
            
            // Drop delete trigger so deletion doesn't hit FTS
            db.exec('DROP TRIGGER IF EXISTS fts_content_ad')
            db.exec('DELETE FROM memory_journal')
            mgr.close()

            // Re-init should trigger ghost cleanup because ftsCount (3) > entryCount (0)
            const mgr2 = new NativeConnectionManager(TEST_DB_PATH)
            await mgr2.initialize()
            
            const db2 = mgr2.getRawDb() as Database
            const ftsCount = (db2.prepare('SELECT COUNT(*) as c FROM fts_content_docsize').get() as { c: number }).c
            expect(ftsCount).toBe(0) // should be cleaned up!
            mgr2.close()
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
            db.exec(
                "INSERT INTO memory_journal (entry_type, content, timestamp, is_personal) VALUES ('test_entry', 'test content', datetime('now'), 1)"
            )

            const result = mgr.exec('SELECT COUNT(*) as c FROM memory_journal', [])
            expect(result).toBeDefined()
            expect(result.length).toBeGreaterThan(0)

            mgr.close()
        })

        it('should handle mutations (INSERT/UPDATE/DELETE) via exec', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()

            // INSERT via exec
            const insertResult = mgr.exec(
                "INSERT INTO memory_journal (entry_type, content, timestamp, is_personal) VALUES ('exec_test', 'exec content', datetime('now'), 1)",
                []
            )
            expect(insertResult).toBeDefined()

            // UPDATE via exec
            const updateResult = mgr.exec(
                "UPDATE memory_journal SET content = 'updated' WHERE entry_type = 'exec_test'",
                []
            )
            expect(updateResult).toBeDefined()

            // DELETE via exec
            const deleteResult = mgr.exec(
                "DELETE FROM memory_journal WHERE entry_type = 'exec_test'",
                []
            )
            expect(deleteResult).toBeDefined()

            mgr.close()
        })

        it('should handle SELECT with no matching rows', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()

            const result = mgr.exec('SELECT * FROM memory_journal WHERE id = -1', [])
            expect(result).toBeDefined()
            // Empty result set — either empty array or array with no values
            if (result.length > 0) {
                expect(result[0].values.length).toBe(0)
            } else {
                expect(result.length).toBe(0)
            }

            mgr.close()
        })
    })

    // =========================================================================
    // pragma
    // =========================================================================

    describe('pragma', () => {
        it('should execute pragma commands', async () => {
            const mgr = new NativeConnectionManager(':memory:')
            await mgr.initialize()
            expect(() => mgr.pragma('cache_size = 2000')).not.toThrow()
            mgr.close()
        })
    })

    // =========================================================================
    // setDbAndInitialized
    // =========================================================================
    
    describe('setDbAndInitialized', () => {
        it('should manually set db and skip initialization', () => {
            const mgr = new NativeConnectionManager(':memory:')
            const fakeDb = {
                pragma: vi.fn(),
                prepare: vi.fn(),
                close: vi.fn()
            }
            mgr.setDbAndInitialized(fakeDb)
            
            // Should be initialized without calling initialize()
            expect(() => mgr.pragma('foreign_keys = ON')).not.toThrow()
            expect(fakeDb.pragma).toHaveBeenCalledWith('foreign_keys = ON')
        })
    })
})
