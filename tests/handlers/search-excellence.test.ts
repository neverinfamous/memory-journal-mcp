/**
 * Search Excellence Tests — Phase 1 (Hush Protocol)
 *
 * Unit tests for:
 * - Auto-mode query classifier (classifyQuery, resolveSearchMode)
 * - RRF scoring (computeRRFScores)
 * - Hybrid search integration (via callTool)
 * - Metadata filters on semantic_search
 * - Find-related-by-ID (entry_id param)
 * - searchMode field in output
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { classifyQuery, resolveSearchMode } from '../../src/handlers/tools/search/auto.js'
import { computeRRFScores } from '../../src/handlers/tools/search/hybrid.js'
import { calcPerDbLimit, mergeAndDedup } from '../../src/handlers/tools/search/helpers.js'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any,
    teamDb?: any,
    teamVector?: any
) =>
    _callTool(
        name,
        params,
        db,
        vectorManager,
        github,
        config ??
            ({
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            } as any),
        progress,
        teamDb,
        teamVector
    )

// ============================================================================
// Auto-Mode Classifier
// ============================================================================

describe('Auto-Mode Query Classifier', () => {
    describe('classifyQuery', () => {
        it('should classify empty query as fts', () => {
            expect(classifyQuery('')).toBe('fts')
            expect(classifyQuery('   ')).toBe('fts')
        })

        it('should classify 1-word queries as fts', () => {
            expect(classifyQuery('performance')).toBe('fts')
            expect(classifyQuery('deploy')).toBe('fts')
        })

        it('should classify 2-word queries as fts', () => {
            expect(classifyQuery('error handling')).toBe('fts')
            expect(classifyQuery('bug fix')).toBe('fts')
        })

        it('should classify quoted phrases as fts', () => {
            expect(classifyQuery('"exact match"')).toBe('fts')
            expect(classifyQuery('"error handling" patterns')).toBe('fts')
        })

        it('should classify questions as semantic', () => {
            expect(classifyQuery('how did we handle authentication')).toBe('semantic')
            expect(classifyQuery('what was the decision about caching')).toBe('semantic')
            expect(classifyQuery('why did the deploy fail last week')).toBe('semantic')
            expect(classifyQuery('when did we implement the new API')).toBe('semantic')
            expect(classifyQuery('who worked on the database migration')).toBe('semantic')
            expect(classifyQuery('which approach did we choose for state management')).toBe(
                'semantic'
            )
        })

        it('should classify trailing question marks as semantic', () => {
            expect(classifyQuery('best practices for error handling?')).toBe('semantic')
        })

        it('should classify 3+ word non-questions as hybrid', () => {
            expect(classifyQuery('database migration patterns')).toBe('hybrid')
            expect(classifyQuery('implemented new authentication flow')).toBe('hybrid')
            expect(classifyQuery('refactored search module split')).toBe('hybrid')
        })
    })

    describe('resolveSearchMode', () => {
        it('should pass through explicit modes', () => {
            expect(resolveSearchMode('fts', 'anything')).toEqual({
                resolvedMode: 'fts',
                isAuto: false,
            })
            expect(resolveSearchMode('semantic', 'anything')).toEqual({
                resolvedMode: 'semantic',
                isAuto: false,
            })
            expect(resolveSearchMode('hybrid', 'anything')).toEqual({
                resolvedMode: 'hybrid',
                isAuto: false,
            })
        })

        it('should classify with auto mode', () => {
            const result = resolveSearchMode('auto', 'performance')
            expect(result.resolvedMode).toBe('fts')
            expect(result.isAuto).toBe(true)
        })

        it('should classify question as semantic in auto mode', () => {
            const result = resolveSearchMode('auto', 'how did we handle authentication')
            expect(result.resolvedMode).toBe('semantic')
            expect(result.isAuto).toBe(true)
        })

        it('should classify multi-word as hybrid in auto mode', () => {
            const result = resolveSearchMode('auto', 'database migration patterns')
            expect(result.resolvedMode).toBe('hybrid')
            expect(result.isAuto).toBe(true)
        })
    })
})

// ============================================================================
// RRF Scoring
// ============================================================================

describe('Reciprocal Rank Fusion', () => {
    describe('computeRRFScores', () => {
        it('should compute RRF scores for a single ranked list', () => {
            const scores = computeRRFScores([[1, 2, 3]])
            // RRF formula: score(d) = 1 / (k + rank), k=60, rank is 1-indexed
            expect(scores.get(1)).toBeCloseTo(1 / 61, 10)
            expect(scores.get(2)).toBeCloseTo(1 / 62, 10)
            expect(scores.get(3)).toBeCloseTo(1 / 63, 10)
        })

        it('should fuse scores from multiple lists', () => {
            // Entry 1 appears in both lists (rank 1 in both)
            // Entry 2 appears only in list 1 (rank 2)
            // Entry 3 appears only in list 2 (rank 2)
            const scores = computeRRFScores([
                [1, 2],
                [1, 3],
            ])

            // Entry 1: 1/61 + 1/61 = 2/61
            expect(scores.get(1)).toBeCloseTo(2 / 61, 10)
            // Entry 2: 1/62
            expect(scores.get(2)).toBeCloseTo(1 / 62, 10)
            // Entry 3: 1/62
            expect(scores.get(3)).toBeCloseTo(1 / 62, 10)
        })

        it('should rank entries appearing in multiple lists higher', () => {
            const scores = computeRRFScores([
                [1, 2, 3],
                [3, 1, 4],
            ])

            // Entry 1: 1/61 + 1/62
            // Entry 3: 1/63 + 1/61
            // Both appear in both lists but at different ranks
            const score1 = scores.get(1)!
            const score3 = scores.get(3)!
            const score2 = scores.get(2)! // Only in list 1
            const score4 = scores.get(4)! // Only in list 2

            // Entries in both lists should score higher than those in one
            expect(score1).toBeGreaterThan(score2)
            expect(score3).toBeGreaterThan(score4)
        })

        it('should handle empty lists', () => {
            const scores = computeRRFScores([])
            expect(scores.size).toBe(0)
        })

        it('should handle list with empty sublists', () => {
            const scores = computeRRFScores([[], [1, 2]])
            expect(scores.get(1)).toBeCloseTo(1 / 61, 10)
            expect(scores.get(2)).toBeCloseTo(1 / 62, 10)
        })
    })
})

// ============================================================================
// Helpers
// ============================================================================

describe('Search Helpers', () => {
    it('should double per-db limit when team DB is present', () => {
        expect(calcPerDbLimit(10, true)).toBe(20)
        expect(calcPerDbLimit(10, false)).toBe(10)
    })

    it('should cap per-db limit at MAX_QUERY_LIMIT', () => {
        expect(calcPerDbLimit(300, true)).toBe(500)
        expect(calcPerDbLimit(500, true)).toBe(500)
    })

    it('should merge and deduplicate entries by source and id', () => {
        const personal = [
            {
                id: 1,
                content: 'Entry A content',
                timestamp: '2026-03-31T10:00:00Z',
                source: 'personal' as const,
            },
            {
                id: 2,
                content: 'Entry B content',
                timestamp: '2026-03-31T09:00:00Z',
                source: 'personal' as const,
            },
        ]
        const team = [
            {
                id: 1,
                content: 'Entry A content',
                timestamp: '2026-03-31T10:00:00Z',
                source: 'personal' as const, // Duplicate entry, same source and ID
            },
            {
                id: 1,
                content: 'Entry A content (Team)',
                timestamp: '2026-03-31T10:00:00Z',
                source: 'team' as const, // Different source, should not deduplicate even with same ID
            },
            {
                id: 3,
                content: 'Entry C content',
                timestamp: '2026-03-31T11:00:00Z',
                source: 'team' as const,
            },
        ]
        const merged = mergeAndDedup(personal, team, 10)
        expect(merged.length).toBe(4) // 2 personal, 2 team (1 duplicate was removed)
        // Sorted by timestamp descending
        expect(merged[0]!.content).toBe('Entry C content')
    })
})

// ============================================================================
// Integration: search_entries with mode param
// ============================================================================

describe('search_entries with mode param', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-search-mode.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        // Seed test entries
        db.createEntry({
            content: 'Implemented the new authentication flow with JWT tokens',
            entryType: 'feature_implementation',
            tags: ['auth', 'jwt'],
        })
        db.createEntry({
            content: 'Fixed critical bug in deployment pipeline for staging',
            entryType: 'bug_fix',
            tags: ['deploy', 'ci'],
        })
        db.createEntry({
            content: 'Performance optimization for database queries using connection pooling',
            entryType: 'technical_achievement',
            tags: ['performance', 'database'],
        })
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    it('should include searchMode in output with default auto mode', async () => {
        const result = (await callTool('search_entries', { query: 'auth', limit: 5 }, db)) as {
            searchMode: string
            count: number
        }
        expect(result.searchMode).toBeDefined()
        expect(result.searchMode).toContain('fts') // 1-word query → FTS in auto mode
    })

    it('should respect explicit fts mode', async () => {
        const result = (await callTool(
            'search_entries',
            { query: 'auth', mode: 'fts', limit: 5 },
            db
        )) as { searchMode: string }
        expect(result.searchMode).toBe('fts')
    })

    it('should fallback to fts when semantic requested without vectorManager', async () => {
        const result = (await callTool(
            'search_entries',
            { query: 'authentication flow', mode: 'semantic', limit: 5 },
            db
        )) as { searchMode: string }
        expect(result.searchMode).toBe('fts (fallback)')
    })

    it('should execute semantic mode when vectorManager is available', async () => {
        const mockVectorManager = {
            search: async () => [{ entryId: 1, score: 0.9 }],
            getStats: () => ({ itemCount: 1 }),
        } as any

        const result = (await callTool(
            'search_entries',
            { query: 'authentication flow', mode: 'semantic', limit: 5 },
            db,
            mockVectorManager
        )) as { searchMode: string; count: number }
        expect(result.searchMode).toBe('semantic')
        // entry 1 is seeded in beforeAll
        expect(result.count).toBe(1)
    })

    it('should execute hybrid mode when vectorManager is available', async () => {
        const mockVectorManager = {
            search: async () => [{ entryId: 1, score: 0.9 }],
            getStats: () => ({ itemCount: 1 }),
        } as any

        const result = (await callTool(
            'search_entries',
            { query: 'database migration patterns', mode: 'hybrid', limit: 5 },
            db,
            mockVectorManager
        )) as { searchMode: string; count: number }
        expect(result.searchMode).toBe('hybrid')
    })

    it('should auto-resolve to semantic mode for questions when vectorManager is available', async () => {
        const mockVectorManager = {
            search: async () => [{ entryId: 1, score: 0.9 }],
            getStats: () => ({ itemCount: 1 }),
        } as any

        const result = (await callTool(
            'search_entries',
            { query: 'how did we handle authentication', mode: 'auto', limit: 5 },
            db,
            mockVectorManager
        )) as { searchMode: string }
        expect(result.searchMode).toBe('semantic (auto)')
    })

    it('should auto-resolve to hybrid mode for complex queries when vectorManager is available', async () => {
        const mockVectorManager = {
            search: async () => [{ entryId: 1, score: 0.9 }],
            getStats: () => ({ itemCount: 1 }),
        } as any

        const result = (await callTool(
            'search_entries',
            { query: 'database migration patterns', mode: 'auto', limit: 5 },
            db,
            mockVectorManager
        )) as { searchMode: string }
        expect(result.searchMode).toBe('hybrid (auto)')
    })

    it('should filter by is_personal in semantic mode', async () => {
        const mockVectorManager = {
            search: async () => [{ entryId: 1, score: 0.9 }],
            getStats: () => ({ itemCount: 1 }),
        } as any

        const result = (await callTool(
            'search_entries',
            { query: 'authentication flow', mode: 'semantic', is_personal: false, limit: 5 },
            db,
            mockVectorManager
        )) as { count: number }

        // Entry 1 is personal so it should be filtered out
        expect(result.count).toBe(0)
    })

    it('should return error for invalid mode', async () => {
        const result = (await callTool(
            'search_entries',
            { query: 'test', mode: 'invalid_mode', limit: 5 },
            db
        )) as { error: string }
        expect(result.error).toBeDefined()
    })

    it('should return validation error for empty query (no filters)', async () => {
        const result = (await callTool('search_entries', { limit: 5 }, db)) as {
            success: boolean
            code: string
            error: string
        }
        // Empty query without filters → strict validation error
        expect(result.success).toBe(false)
        expect(result.code).toBe('VALIDATION_ERROR')
        expect(result.error).toContain('query string or at least one filter')
    })
})

// ============================================================================
// Integration: semantic_search enhancements
// ============================================================================

describe('semantic_search enhancements', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-semantic-enhance.db'
    let mockVectorManager: any
    let entry1Id: number
    let entry2Id: number

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        const entry1 = db.createEntry({
            content: 'Authentication system design with OAuth2',
            entryType: 'project_decision',
            tags: ['auth', 'oauth', 'security'],
            timestamp: '2026-03-01T12:00:00Z',
            isPersonal: true,
        })
        entry1Id = entry1.id

        const entry2 = db.createEntry({
            content: 'Login page implementation using React',
            entryType: 'feature_implementation',
            tags: ['frontend', 'react', 'auth'],
            timestamp: '2026-03-15T12:00:00Z',
            isPersonal: false,
        })
        entry2Id = entry2.id

        mockVectorManager = {
            search: async () => [
                { entryId: entry1Id, score: 0.9 },
                { entryId: entry2Id, score: 0.8 },
                { entryId: 999, score: 0.7 }, // Missing entry
            ],
            searchByEntryId: async () => [
                { entryId: entry2Id, score: 0.8 }, // Related to 1
            ],
            getStats: () => ({ itemCount: 2 }),
        }
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    it('should require either query or entry_id', async () => {
        const result = (await callTool('semantic_search', { limit: 5 }, db)) as {
            error: string
            code: string
        }
        expect(result.error).toBe('Either query or entry_id must be provided')
        expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('should filter by tags', async () => {
        const result = (await callTool(
            'semantic_search',
            { query: 'auth', tags: ['oauth'] },
            db,
            mockVectorManager
        )) as { count: number; entries: any[] }
        expect(result.count).toBe(1)
        expect(result.entries[0].id).toBe(entry1Id)
    })

    it('should filter by entry_type', async () => {
        const result = (await callTool(
            'semantic_search',
            { query: 'auth', entry_type: 'feature_implementation' },
            db,
            mockVectorManager
        )) as { count: number; entries: any[] }
        expect(result.count).toBe(1)
        expect(result.entries[0].id).toBe(entry2Id)
    })

    it('should filter by start_date', async () => {
        const result = (await callTool(
            'semantic_search',
            { query: 'auth', start_date: '2026-03-10' },
            db,
            mockVectorManager
        )) as { count: number; entries: any[] }
        expect(result.count).toBe(1)
        expect(result.entries[0].id).toBe(entry2Id)
    })

    it('should filter by end_date', async () => {
        const result = (await callTool(
            'semantic_search',
            { query: 'auth', end_date: '2026-03-10' },
            db,
            mockVectorManager
        )) as { count: number; entries: any[] }
        expect(result.count).toBe(1)
        expect(result.entries[0].id).toBe(entry1Id)
    })

    it('should exclude source entry when searching by entry_id', async () => {
        const mockVM = {
            ...mockVectorManager,
            searchByEntryId: async () => [
                { entryId: entry1Id, score: 1.0 }, // The source entry
                { entryId: entry2Id, score: 0.8 }, // Related entry
            ],
        }
        const result = (await callTool('semantic_search', { entry_id: entry1Id }, db, mockVM)) as {
            count: number
            entries: any[]
        }
        expect(result.count).toBe(1)
        expect(result.entries[0].id).toBe(entry2Id)
    })

    it('should generate noise hint for low quality results', async () => {
        const mockVM = {
            ...mockVectorManager,
            search: async () => [{ entryId: entry1Id, score: 0.3 }],
        }
        const result = (await callTool('semantic_search', { query: 'noise' }, db, mockVM)) as {
            hint: string
        }
        expect(result.hint).toContain('noise')
    })

    it('should return configuration error when vectorManager unavailable', async () => {
        const result = (await callTool('semantic_search', { query: 'test', limit: 5 }, db)) as {
            error: string
            code: string
        }
        expect(result.code).toBe('CONFIGURATION_ERROR')
    })

    it('should return configuration error for entry_id when vectorManager unavailable', async () => {
        const result = (await callTool('semantic_search', { entry_id: 1, limit: 5 }, db)) as {
            error: string
            code: string
        }
        expect(result.code).toBe('CONFIGURATION_ERROR')
    })
})
