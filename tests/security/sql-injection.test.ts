/**
 * SQL Injection Security Tests for Memory Journal MCP Server
 *
 * Tests the database layer's resilience against SQL injection attacks.
 * Follows MCP Security Patterns for comprehensive coverage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'
import {
    validateDateFormatPattern,
    sanitizeSearchQuery,
    containsSqlInjection,
    assertNoSqlInjection,
    assertNoPathTraversal,
    InvalidDateFormatError,
    SqlInjectionError,
    PathTraversalError,
} from '../../src/utils/security-utils.js'

// ============================================================================
// Test Payloads
// ============================================================================

/**
 * Standard SQL injection payloads for testing.
 * These represent common attack vectors.
 */
const INJECTION_PAYLOADS = [
    // Stacked queries
    "'; DROP TABLE memory_journal; --",
    "test'; DELETE FROM tags; --",
    "1; INSERT INTO memory_journal (content) VALUES ('hacked'); --",
    "x'; UPDATE memory_journal SET content='pwned' WHERE 1=1; --",

    // Boolean-based
    "' OR '1'='1",
    "' OR 1=1 --",
    "admin' --",

    // UNION-based
    "' UNION SELECT * FROM sqlite_master --",
    "' UNION ALL SELECT 1,2,3,4,5 --",

    // Comment injection
    "test' -- this is a comment",
    'value /* comment */ injection',

    // SQLite-specific
    "'; ATTACH DATABASE 'malicious.db' AS mal; --",
    "'; load_extension('malicious.so'); --",
]

/**
 * Safe inputs that should be accepted
 */
const SAFE_INPUTS = [
    'Normal search query',
    "It's a valid apostrophe",
    'SELECT is just a word here',
    'test@email.com',
    '100% success rate',
    'user_name with underscore',
]

// ============================================================================
// Security Utility Tests
// ============================================================================

describe('Security Utilities', () => {
    describe('validateDateFormatPattern', () => {
        it('should return valid format for day', () => {
            expect(validateDateFormatPattern('day')).toBe('%Y-%m-%d')
        })

        it('should return valid format for week', () => {
            expect(validateDateFormatPattern('week')).toBe('%Y-W%W')
        })

        it('should return valid format for month', () => {
            expect(validateDateFormatPattern('month')).toBe('%Y-%m')
        })

        it('should throw InvalidDateFormatError for invalid values', () => {
            expect(() => validateDateFormatPattern('invalid')).toThrow(InvalidDateFormatError)
            expect(() => validateDateFormatPattern('')).toThrow(InvalidDateFormatError)
            expect(() => validateDateFormatPattern('%Y-%m-%d')).toThrow(InvalidDateFormatError)
        })

        it('should throw InvalidDateFormatError for injection attempts', () => {
            expect(() => validateDateFormatPattern("'; DROP TABLE --")).toThrow(
                InvalidDateFormatError
            )
            expect(() => validateDateFormatPattern('%Y-%m-%d) --')).toThrow(InvalidDateFormatError)
        })
    })

    describe('sanitizeSearchQuery', () => {
        it('should escape % characters', () => {
            expect(sanitizeSearchQuery('100%')).toBe('100\\%')
            expect(sanitizeSearchQuery('50% discount')).toBe('50\\% discount')
        })

        it('should escape _ characters', () => {
            expect(sanitizeSearchQuery('user_name')).toBe('user\\_name')
            expect(sanitizeSearchQuery('test_value_here')).toBe('test\\_value\\_here')
        })

        it('should escape backslashes', () => {
            expect(sanitizeSearchQuery('path\\to\\file')).toBe('path\\\\to\\\\file')
        })

        it('should handle combined special characters', () => {
            expect(sanitizeSearchQuery('50%_test\\')).toBe('50\\%\\_test\\\\')
        })

        it('should not modify safe strings', () => {
            expect(sanitizeSearchQuery('normal text')).toBe('normal text')
            expect(sanitizeSearchQuery("it's fine")).toBe("it's fine")
        })
    })

    describe('containsSqlInjection', () => {
        it('should detect stacked query injection', () => {
            expect(containsSqlInjection('; DROP TABLE users')).toBe(true)
            expect(containsSqlInjection("'; DELETE FROM logs --")).toBe(true)
        })

        it('should detect comment injection', () => {
            expect(containsSqlInjection('value -- comment')).toBe(true)
            expect(containsSqlInjection('test /* block */ comment')).toBe(true)
        })

        it('should detect UNION injection', () => {
            expect(containsSqlInjection("' UNION SELECT * FROM users")).toBe(true)
            expect(containsSqlInjection("' UNION ALL SELECT 1")).toBe(true)
        })

        it('should detect boolean bypass', () => {
            expect(containsSqlInjection("' OR '1'='1")).toBe(true)
        })

        it('should detect SQLite-specific attacks', () => {
            expect(containsSqlInjection("ATTACH DATABASE 'mal.db' AS x")).toBe(true)
            expect(containsSqlInjection("load_extension('evil.so')")).toBe(true)
        })

        it('should not flag safe inputs', () => {
            for (const input of SAFE_INPUTS) {
                expect(containsSqlInjection(input)).toBe(false)
            }
        })
    })

    describe('assertNoSqlInjection', () => {
        it('should throw SqlInjectionError for injection attempts', () => {
            for (const payload of INJECTION_PAYLOADS) {
                expect(() => assertNoSqlInjection(payload)).toThrow(SqlInjectionError)
            }
        })

        it('should not throw for safe inputs', () => {
            for (const input of SAFE_INPUTS) {
                expect(() => assertNoSqlInjection(input)).not.toThrow()
            }
        })
    })

    describe('assertNoPathTraversal', () => {
        it('should throw for path traversal attempts', () => {
            expect(() => assertNoPathTraversal('../secret')).toThrow(PathTraversalError)
            expect(() => assertNoPathTraversal('..\\secret')).toThrow(PathTraversalError)
            expect(() => assertNoPathTraversal('/etc/passwd')).toThrow(PathTraversalError)
            expect(() => assertNoPathTraversal('C:\\Windows')).toThrow(PathTraversalError)
        })

        it('should not throw for safe filenames', () => {
            expect(() => assertNoPathTraversal('backup.db')).not.toThrow()
            expect(() => assertNoPathTraversal('backup_2026-02-05.db')).not.toThrow()
        })
    })
})

// ============================================================================
// SqliteAdapter SQL Injection Tests
// ============================================================================

describe('SqliteAdapter SQL Injection Protection', () => {
    let db: SqliteAdapter
    const testDbPath = './test-security.db'

    beforeAll(async () => {
        // Use temp file database for testing (SqliteAdapter always saves to disk)
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        // Clean up test database
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath)
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    describe('createEntry - Parameterized Queries', () => {
        it('should safely handle content with SQL injection attempts', async () => {
            for (const payload of INJECTION_PAYLOADS) {
                // Should not throw - parameterized queries handle this
                const entry = db.createEntry({ content: payload })
                expect(entry.content).toBe(payload)

                // Verify the payload was stored literally, not executed
                const retrieved = db.getEntryById(entry.id)
                expect(retrieved?.content).toBe(payload)
            }
        })

        it('should safely handle tags with special characters', async () => {
            const entry = db.createEntry({
                content: 'Test entry',
                tags: ["tag'; DROP TABLE tags; --", 'normal-tag', "tag' OR '1'='1"],
            })

            const tags = entry.tags
            expect(tags).toContain("tag'; DROP TABLE tags; --")
            expect(tags).toContain('normal-tag')
            expect(tags).toContain("tag' OR '1'='1")
        })
    })

    describe('searchEntries - LIKE Injection', () => {
        it('should safely handle search queries with SQL injection attempts', async () => {
            // Create a known entry
            db.createEntry({ content: 'Known safe content' })

            for (const payload of INJECTION_PAYLOADS) {
                // Should not throw - parameterized queries handle this
                const results = db.searchEntries(payload)
                // Results should be based on LIKE matching, not SQL execution
                expect(Array.isArray(results)).toBe(true)
            }
        })

        it('should handle special LIKE characters in queries', async () => {
            // Create entries with special characters
            db.createEntry({ content: '50% discount on items' })
            db.createEntry({ content: 'user_name property' })

            // Search for literal special characters
            const percentResults = db.searchEntries('50%')
            const underscoreResults = db.searchEntries('user_name')

            expect(Array.isArray(percentResults)).toBe(true)
            expect(Array.isArray(underscoreResults)).toBe(true)
        })
    })

    describe('getStatistics - Date Format Validation', () => {
        it('should only accept valid groupBy values', async () => {
            // Valid values should work
            expect(() => db.getStatistics('day')).not.toThrow()
            expect(() => db.getStatistics('week')).not.toThrow()
            expect(() => db.getStatistics('month')).not.toThrow()
        })

        it('should reject invalid groupBy values', async () => {
            // Type system prevents this at compile time, but runtime validation
            // should also protect against invalid values
            expect(() => db.getStatistics("'; DROP TABLE memory_journal; --" as 'day')).toThrow()
        })
    })

    describe('updateEntry - Parameterized Updates', () => {
        it('should safely handle updates with injection attempts', async () => {
            const entry = db.createEntry({ content: 'Original content' })

            const updated = db.updateEntry(entry.id, {
                content: "'; DELETE FROM memory_journal; --",
            })

            expect(updated?.content).toBe("'; DELETE FROM memory_journal; --")
            // Database should still be intact
            const stats = db.getStatistics('day')
            expect(stats.totalEntries).toBeGreaterThan(0)
        })
    })

    describe('linkEntries - Relationship Injection', () => {
        it('should safely handle descriptions with injection attempts', async () => {
            const entry1 = db.createEntry({ content: 'Entry 1' })
            const entry2 = db.createEntry({ content: 'Entry 2' })

            const relationship = db.linkEntries(
                entry1.id,
                entry2.id,
                'references',
                "'; DROP TABLE relationships; --"
            )

            expect(relationship.description).toBe("'; DROP TABLE relationships; --")

            // Verify relationships table still exists
            const rels = db.getRelationships(entry1.id)
            expect(Array.isArray(rels)).toBe(true)
        })
    })

    describe('restoreFromFile - Path Traversal Protection', () => {
        it('should reject filenames with path traversal', async () => {
            await expect(db.restoreFromFile('../../../etc/passwd')).rejects.toThrow(
                'Invalid backup filename: path separators not allowed'
            )

            await expect(db.restoreFromFile('..\\..\\windows\\system32')).rejects.toThrow(
                'Invalid backup filename: path separators not allowed'
            )

            await expect(db.restoreFromFile('/etc/passwd')).rejects.toThrow(
                'Invalid backup filename: path separators not allowed'
            )
        })
    })

    describe('Database Integrity After Attacks', () => {
        it('should maintain database integrity after all injection attempts', async () => {
            // Verify core tables still exist
            const stats = db.getStatistics('day')
            expect(stats.totalEntries).toBeGreaterThan(0)

            // Verify we can still perform normal operations
            const newEntry = db.createEntry({ content: 'Integrity check entry' })
            expect(newEntry.id).toBeDefined()

            const retrieved = db.getEntryById(newEntry.id)
            expect(retrieved?.content).toBe('Integrity check entry')

            const tags = db.listTags()
            expect(Array.isArray(tags)).toBe(true)
        })
    })
})
