/**
 * Shared Entry Helpers Unit Tests
 *
 * Tests for rowToObject, queryRow, queryRows from
 * src/database/sqlite-adapter/entries/shared.ts
 */

import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import {
    rowToObject,
    queryRow,
    queryRows,
} from '../../src/database/sqlite-adapter/entries/shared.js'

describe('shared entry helpers', () => {
    // =========================================================================
    // rowToObject
    // =========================================================================

    describe('rowToObject', () => {
        it('should return undefined for null', () => {
            expect(rowToObject(null)).toBeUndefined()
        })

        it('should return undefined for undefined', () => {
            expect(rowToObject(undefined)).toBeUndefined()
        })

        it('should return undefined for non-object types', () => {
            expect(rowToObject(42)).toBeUndefined()
            expect(rowToObject('string')).toBeUndefined()
            expect(rowToObject(true)).toBeUndefined()
        })

        it('should return the object for valid objects', () => {
            const obj = { id: 1, name: 'test' }
            expect(rowToObject(obj)).toBe(obj)
        })

        it('should handle empty objects', () => {
            const obj = {}
            expect(rowToObject(obj)).toBe(obj)
        })
    })

    // =========================================================================
    // queryRow / queryRows with real in-memory DB
    // =========================================================================

    describe('queryRow and queryRows', () => {
        const db = new Database(':memory:')

        afterAll(() => {
            db.close()
        })

        // Set up a tiny test table
        db.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT, value INTEGER)')
        db.exec(
            "INSERT INTO test_items (name, value) VALUES ('alpha', 10), ('beta', 20), ('gamma', 30)"
        )

        describe('queryRow', () => {
            it('should return a single row as Record<string, unknown>', () => {
                const row = queryRow(db, 'SELECT * FROM test_items WHERE id = ?', 1)
                expect(row).toBeDefined()
                expect(row!['name']).toBe('alpha')
                expect(row!['value']).toBe(10)
            })

            it('should return undefined when no rows match', () => {
                const row = queryRow(db, 'SELECT * FROM test_items WHERE id = ?', 999)
                expect(row).toBeUndefined()
            })

            it('should work with no bind parameters', () => {
                const row = queryRow(db, 'SELECT COUNT(*) as c FROM test_items')
                expect(row).toBeDefined()
                expect(row!['c']).toBe(3)
            })
        })

        describe('queryRows', () => {
            it('should return all matching rows', () => {
                const rows = queryRows(db, 'SELECT * FROM test_items WHERE value >= ?', 20)
                expect(rows).toHaveLength(2)
                expect(rows[0]!['name']).toBe('beta')
                expect(rows[1]!['name']).toBe('gamma')
            })

            it('should return empty array when no rows match', () => {
                const rows = queryRows(db, 'SELECT * FROM test_items WHERE value > ?', 100)
                expect(rows).toHaveLength(0)
            })

            it('should return all rows with no filter', () => {
                const rows = queryRows(db, 'SELECT * FROM test_items')
                expect(rows).toHaveLength(3)
            })
        })
    })
})
