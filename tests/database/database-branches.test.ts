/**
 * memory-journal-mcp — Database Adapter Branch Coverage Tests
 *
 * Targets uncovered branches in native-connection.ts exec/run methods.
 * Uses a raw better-sqlite3 db to manually set up tables, bypassing
 * the sqlite-vec extension requirement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a NativeConnectionManager with internal db set to a manual
 * better-sqlite3 instance that has basic tables, bypassing initialize().
 */
function createTestConn(): NativeConnectionManager {
    const conn = new NativeConnectionManager(':memory:')
    const db = new Database(':memory:')

    // Create minimal tables for testing exec/run branches
    db.exec(`
        CREATE TABLE IF NOT EXISTS test_table (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            usage_count INTEGER DEFAULT 0
        );
    `)

    // Inject the db into the connection manager
    Object.assign(conn, { db, initialized: true })
    return conn
}

// ============================================================================
// Tests
// ============================================================================

describe('NativeConnectionManager exec branches', () => {
    let conn: NativeConnectionManager

    beforeEach(() => {
        vi.clearAllMocks()
        conn = createTestConn()
    })

    afterEach(() => {
        conn.close()
    })

    it('should handle INSERT (mutation) without params', () => {
        const result = conn.exec("INSERT INTO test_table (name, value) VALUES ('a', 'b')")
        expect(result).toEqual([])
    })

    it('should handle INSERT (mutation) with params', () => {
        const result = conn.exec('INSERT INTO test_table (name, value) VALUES (?, ?)', [
            'test',
            'data',
        ])
        expect(result).toEqual([])
    })

    it('should reject multi-statement mutations (semicolon path) as forbidden', () => {
        expect(() => {
            conn.exec(
                "INSERT INTO tags (name, usage_count) VALUES ('a', 1); INSERT INTO tags (name, usage_count) VALUES ('b', 2);"
            )
        }).toThrow(
            'Multi-statement queries via exec() are strictly forbidden. Use properly parameterized adapter methods instead.'
        )
    })

    it('should handle SELECT returning rows with columns/values', () => {
        conn.run("INSERT INTO test_table (name, value) VALUES ('row1', 'val1')")
        conn.run("INSERT INTO test_table (name, value) VALUES ('row2', 'val2')")

        const result = conn.exec('SELECT * FROM test_table')
        expect(result.length).toBe(1)
        expect(result[0]!.columns).toContain('name')
        expect(result[0]!.values.length).toBe(2)
    })

    it('should handle SELECT with params', () => {
        conn.run('INSERT INTO test_table (name, value) VALUES (?, ?)', ['find-me', 'v1'])

        const result = conn.exec('SELECT * FROM test_table WHERE name = ?', ['find-me'])
        expect(result.length).toBe(1)
        expect(result[0]!.values[0]![1]).toBe('find-me')
    })

    it('should handle SELECT returning empty rows', () => {
        const result = conn.exec("SELECT * FROM test_table WHERE name = 'nonexistent'")
        expect(result).toEqual([])
    })

    it('should handle PRAGMA queries', () => {
        const result = conn.exec('PRAGMA table_info(test_table)')
        expect(result.length).toBeGreaterThan(0)
    })

    it('should handle run() without params', () => {
        expect(() =>
            conn.run("INSERT INTO tags (name, usage_count) VALUES ('test', 0)")
        ).not.toThrow()
    })

    it('should handle run() with params', () => {
        expect(() =>
            conn.run('INSERT INTO tags (name, usage_count) VALUES (?, ?)', ['tag1', 0])
        ).not.toThrow()
    })

    it('should handle scheduleSave as no-op', () => {
        expect(() => conn.scheduleSave()).not.toThrow()
    })

    it('should return db path', () => {
        expect(conn.getDbPath()).toBe(':memory:')
    })
})
