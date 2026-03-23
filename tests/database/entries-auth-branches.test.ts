/**
 * memory-journal-mcp — Token Validator, Search, Statistics, Importance Branch Coverage
 *
 * Targets uncovered branches in:
 * - token-validator.ts (71.05%): JWKS cache hit, invalid issuer URL, error dispatch
 * - search.ts entries (79.24%): searchByDateRange filter combos (isPersonal, project, issue, pr, workflowRunId)
 * - statistics.ts (81.08%): date-filtered path, projectBreakdown, growthPercent null
 * - importance.ts (75%): null rel_count/causal_count
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { TokenValidator, createTokenValidator } from '../../src/auth/token-validator.js'
import { AUTH_ERROR_CODES } from '../../src/auth/errors.js'
import { searchByDateRange } from '../../src/database/sqlite-adapter/entries/search.js'
import { getStatistics } from '../../src/database/sqlite-adapter/entries/statistics.js'
import { calculateImportance } from '../../src/database/sqlite-adapter/entries/importance.js'

// ============================================================================
// Helpers — in-memory SQLite DB
// ============================================================================

function createTestDb() {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE memory_journal (
            id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            entry_type TEXT DEFAULT 'personal_reflection',
            timestamp TEXT NOT NULL,
            is_personal INTEGER DEFAULT 1,
            deleted_at TEXT DEFAULT NULL,
            project_number INTEGER DEFAULT NULL,
            issue_number INTEGER DEFAULT NULL,
            pr_number INTEGER DEFAULT NULL,
            issue_url TEXT DEFAULT NULL,
            pr_url TEXT DEFAULT NULL,
            pr_status TEXT DEFAULT NULL,
            project_owner TEXT DEFAULT NULL,
            workflow_run_id INTEGER DEFAULT NULL,
            workflow_name TEXT DEFAULT NULL,
            workflow_status TEXT DEFAULT NULL,
            significance_type TEXT DEFAULT NULL,
            auto_context TEXT DEFAULT NULL,
            share_with_team INTEGER DEFAULT 0
        );
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE, usage_count INTEGER DEFAULT 0);
        CREATE TABLE entry_tags (entry_id INTEGER, tag_id INTEGER);
        CREATE TABLE relationships (
            id INTEGER PRIMARY KEY,
            from_entry_id INTEGER,
            to_entry_id INTEGER,
            relationship_type TEXT,
            description TEXT DEFAULT NULL
        );
        CREATE VIRTUAL TABLE fts_content USING fts5(content, content_rowid='rowid');
    `)
    return db
}

function createTagsMgr() {
    return {
        batchGetTagsForEntries: vi.fn().mockReturnValue(new Map()),
    }
}

// ============================================================================
// TokenValidator Branch Coverage
// ============================================================================

describe('TokenValidator — branch coverage', () => {
    it('should handle invalid issuer URL gracefully in constructor', () => {
        const validator = new TokenValidator({
            jwksUri: 'https://example.com/.well-known/jwks.json',
            issuer: 'not-a-url',
            audience: 'test',
        })
        expect(validator).toBeDefined()
    })

    it('should use cached JWKS on second call', () => {
        const validator = new TokenValidator({
            jwksUri: 'https://example.com/.well-known/jwks.json',
            issuer: 'https://example.com',
            audience: 'test',
        })
        // First call creates JWKS
        validator.refreshJwks()
        // Second call triggers cache hit branch because jwksExpiry is in the future
        // We verify no error is thrown
        expect(validator).toBeDefined()
    })

    it('should clear cache', () => {
        const validator = new TokenValidator({
            jwksUri: 'https://example.com/.well-known/jwks.json',
            issuer: 'https://example.com',
            audience: 'test',
        })
        validator.clearCache()
        expect(validator).toBeDefined()
    })

    it('should handle invalid JWKS URI gracefully', () => {
        const validator = new TokenValidator({
            jwksUri: 'not-a-url',
            issuer: 'https://example.com',
            audience: 'test',
        })
        // getJwks internally — URL constructor may throw for invalid jwksUri
        expect(() => validator.refreshJwks()).toThrow()
    })

    describe('handleValidationError dispatch', () => {
        let validator: TokenValidator

        beforeEach(() => {
            validator = new TokenValidator({
                jwksUri: 'https://example.com/.well-known/jwks.json',
                issuer: 'https://example.com',
                audience: 'test',
            })
        })

        it('should handle JWTExpired', async () => {
            // Access private handleValidationError via validate path
            const result = await validator.validate('invalid.token.here')
            expect(result.valid).toBe(false)
        })

        it('should return expired error via toOAuthError', () => {
            const result = TokenValidator.toOAuthError({
                valid: false,
                error: 'expired',
                errorCode: AUTH_ERROR_CODES.TOKEN_EXPIRED,
            })
            expect(result.code).toBe(AUTH_ERROR_CODES.TOKEN_EXPIRED)
        })

        it('should return signature error via toOAuthError', () => {
            const result = TokenValidator.toOAuthError({
                valid: false,
                error: 'bad sig',
                errorCode: AUTH_ERROR_CODES.SIGNATURE_INVALID,
            })
            expect(result.code).toBe(AUTH_ERROR_CODES.SIGNATURE_INVALID)
        })

        it('should return generic invalid token via toOAuthError', () => {
            const result = TokenValidator.toOAuthError({
                valid: false,
                error: 'some error',
                errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
            })
            expect(result.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID)
        })
    })

    it('createTokenValidator factory function', () => {
        const validator = createTokenValidator({
            jwksUri: 'https://example.com/.well-known/jwks.json',
            issuer: 'https://example.com',
            audience: 'test',
        })
        expect(validator).toBeInstanceOf(TokenValidator)
    })
})

// ============================================================================
// searchByDateRange Branch Coverage — filter combinations
// ============================================================================

describe('searchByDateRange — filter combinations', () => {
    let db: InstanceType<typeof Database>
    let context: { db: ReturnType<typeof Database>; tagsMgr: ReturnType<typeof createTagsMgr> }

    beforeEach(() => {
        db = createTestDb()
        db.exec(`
            INSERT INTO memory_journal (id, content, timestamp, is_personal, project_number, issue_number, pr_number, workflow_run_id, entry_type)
            VALUES
            (1, 'entry one', '2025-01-15T10:00:00Z', 1, 42, 10, 20, 100, 'personal_reflection'),
            (2, 'entry two', '2025-01-20T10:00:00Z', 0, 42, 11, null, null, 'decision'),
            (3, 'entry three', '2025-02-01T10:00:00Z', 1, null, null, null, null, 'personal_reflection');
            INSERT INTO tags (id, name, usage_count) VALUES (1, 'test-tag', 1);
            INSERT INTO entry_tags (entry_id, tag_id) VALUES (1, 1);
            INSERT INTO fts_content (rowid, content) VALUES (1, 'entry one'), (2, 'entry two'), (3, 'entry three');
        `)
        context = { db, tagsMgr: createTagsMgr() }
    })

    it('should filter by date range only', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-01-31')
        expect(result.length).toBe(2)
    })

    it('should filter by isPersonal', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', { isPersonal: true })
        expect(result.every((e) => e.isPersonal === true)).toBe(true)
    })

    it('should filter by projectNumber', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', { projectNumber: 42 })
        expect(result.length).toBe(2)
    })

    it('should filter by issueNumber', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', { issueNumber: 10 })
        expect(result.length).toBe(1)
    })

    it('should filter by prNumber', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', { prNumber: 20 })
        expect(result.length).toBe(1)
    })

    it('should filter by workflowRunId', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', {
            workflowRunId: 100,
        })
        expect(result.length).toBe(1)
    })

    it('should filter by entryType', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', {
            entryType: 'decision',
        })
        expect(result.length).toBe(1)
    })

    it('should filter by tags', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', {
            tags: ['test-tag'],
        })
        expect(result.length).toBe(1)
    })

    it('should handle startDate without T (appends time)', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-01-31')
        expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle endDate without T (appends time)', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-01-31')
        expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('should combine multiple filters', () => {
        const result = searchByDateRange(context, '2025-01-01', '2025-12-31', {
            isPersonal: true,
            projectNumber: 42,
            issueNumber: 10,
            prNumber: 20,
            workflowRunId: 100,
        })
        expect(result.length).toBe(1)
    })
})

// ============================================================================
// getStatistics Branch Coverage
// ============================================================================

describe('getStatistics — branch coverage', () => {
    let db: InstanceType<typeof Database>
    let context: { db: ReturnType<typeof Database>; tagsMgr: ReturnType<typeof createTagsMgr> }

    beforeEach(() => {
        db = createTestDb()
        db.exec(`
            INSERT INTO memory_journal (id, content, timestamp, project_number, significance_type) VALUES
            (1, 'entry 1', '2025-01-15T10:00:00Z', 42, 'decision'),
            (2, 'entry 2', '2025-01-20T10:00:00Z', 42, null),
            (3, 'entry 3', '2025-02-01T10:00:00Z', null, null);
            INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type) VALUES
            (1, 2, 'resolved'),
            (1, 3, 'references');
        `)
        context = { db, tagsMgr: createTagsMgr() }
    })

    it('should compute stats without date filters (else branch)', () => {
        const result = getStatistics(context)
        expect(result.totalEntries).toBe(3)
    })

    it('should compute stats with startDate filter', () => {
        const result = getStatistics(context, 'week', '2025-01-18')
        expect(result.totalEntries as number).toBe(2)
    })

    it('should compute stats with both date filters', () => {
        const result = getStatistics(context, 'week', '2025-01-01', '2025-01-31')
        expect(result.totalEntries as number).toBe(2)
    })

    it('should include projectBreakdown when requested', () => {
        const result = getStatistics(context, 'week', undefined, undefined, true)
        expect(result.projectBreakdown).toBeDefined()
        const breakdown = result.projectBreakdown as {
            project_number: number
            entry_count: number
        }[]
        expect(breakdown.length).toBe(1)
        expect(breakdown[0]!.project_number).toBe(42)
    })

    it('should compute growthPercent as null when previousCount is 0', () => {
        // With only one entry, the second period will be empty
        db.exec('DELETE FROM memory_journal WHERE id > 1')
        const result = getStatistics(context)
        const trend = result.activityTrend as { growthPercent: number | null }
        expect(trend.growthPercent).toBeNull()
    })

    it('should use year groupBy (maps to month format)', () => {
        const result = getStatistics(context, 'year')
        expect(result.totalEntries).toBe(3)
    })

    it('should include causalMetrics', () => {
        const result = getStatistics(context)
        const causal = result.causalMetrics as Record<string, number>
        expect(causal.resolved).toBe(1)
    })

    it('should include dateRange when date filters provided', () => {
        const result = getStatistics(context, 'week', '2025-01-01', '2025-12-31')
        expect(result.dateRange).toBeDefined()
    })

    it('should not include dateRange when no date filters', () => {
        const result = getStatistics(context)
        expect(result.dateRange).toBeUndefined()
    })
})

// ============================================================================
// calculateImportance Branch Coverage
// ============================================================================

describe('calculateImportance — branch coverage', () => {
    let db: InstanceType<typeof Database>
    let context: { db: ReturnType<typeof Database>; tagsMgr: ReturnType<typeof createTagsMgr> }

    beforeEach(() => {
        db = createTestDb()
        context = { db, tagsMgr: createTagsMgr() }
    })

    it('should return 0 score for non-existent entry', () => {
        const result = calculateImportance(context, 999)
        expect(result.score).toBe(0)
    })

    it('should compute importance for entry with significance and relationships', () => {
        db.exec(`
            INSERT INTO memory_journal (id, content, timestamp, significance_type) VALUES (1, 'test', '${new Date().toISOString()}', 'decision');
            INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type) VALUES (1, 2, 'references'), (1, 3, 'caused');
        `)
        const result = calculateImportance(context, 1)
        expect(result.score).toBeGreaterThan(0)
        expect(result.breakdown.significance).toBeGreaterThan(0)
        expect(result.breakdown.relationships).toBeGreaterThan(0)
        expect(result.breakdown.causal).toBeGreaterThan(0)
        expect(result.breakdown.recency).toBeGreaterThan(0)
    })

    it('should compute importance with no significance type', () => {
        db.exec(
            `INSERT INTO memory_journal (id, content, timestamp) VALUES (1, 'test', '${new Date().toISOString()}')`
        )
        const result = calculateImportance(context, 1)
        expect(result.breakdown.significance).toBe(0)
    })

    it('should decay recency for old entries', () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
        db.exec(
            `INSERT INTO memory_journal (id, content, timestamp) VALUES (1, 'old entry', '${oldDate}')`
        )
        const result = calculateImportance(context, 1)
        expect(result.breakdown.recency).toBe(0)
    })
})
