/**
 * Vector Tool Handler Tests
 *
 * Tests vector-dependent tools (semantic_search, rebuild_vector_index,
 * add_to_vector_index, get_vector_index_stats) using a mock VectorSearchManager.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager.js'

/**
 * Creates a mock VectorSearchManager.
 */
function createMockVector(overrides: Partial<Record<string, unknown>> = {}): VectorSearchManager {
    const defaults = {
        isInitialized: vi.fn().mockReturnValue(true),
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        addEntry: vi.fn().mockResolvedValue(true),
        removeEntry: vi.fn().mockResolvedValue(true),
        rebuildIndex: vi.fn().mockResolvedValue(5),
        getStats: vi.fn().mockResolvedValue({
            itemCount: 10,
            modelName: 'Xenova/all-MiniLM-L6-v2',
            dimensions: 384,
        }),
        generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0)),
    }
    return { ...defaults, ...overrides } as unknown as VectorSearchManager
}

describe('Vector Tool Handlers', () => {
    let db: SqliteAdapter
    const testDbPath = './test-vector-tools.db'
    let entryId: number

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
        // Create an entry for testing
        const entry = db.createEntry({
            content: 'Test entry for vector tools',
            entryType: 'personal_reflection',
            tags: ['test'],
        })
        entryId = entry.id
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

    // ========================================================================
    // semantic_search
    // ========================================================================

    describe('semantic_search', () => {
        it('should return results when vector manager has matches', async () => {
            const vectorManager = createMockVector({
                search: vi.fn().mockResolvedValue([{ entryId, score: 0.85 }]),
                getStats: vi.fn().mockResolvedValue({ itemCount: 10 }),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'test query' },
                db,
                vectorManager
            )) as { query: string; entries: unknown[]; count: number }

            expect(result.query).toBe('test query')
            expect(result.count).toBe(1)
            expect(result.entries).toHaveLength(1)
        })

        it('should return empty with hint when index is empty', async () => {
            const vectorManager = createMockVector({
                search: vi.fn().mockResolvedValue([]),
                getStats: vi.fn().mockResolvedValue({ itemCount: 0 }),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'anything' },
                db,
                vectorManager
            )) as { entries: unknown[]; count: number; hint: string }

            expect(result.count).toBe(0)
            expect(result.hint).toContain('rebuild_vector_index')
        })

        it('should return hint when no matches above threshold', async () => {
            const vectorManager = createMockVector({
                search: vi.fn().mockResolvedValue([]),
                getStats: vi.fn().mockResolvedValue({ itemCount: 10 }),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'nothing matches' },
                db,
                vectorManager
            )) as { count: number; hint: string }

            expect(result.count).toBe(0)
            expect(result.hint).toContain('similarity_threshold')
        })

        it('should suppress hint when hint_on_empty is false', async () => {
            const vectorManager = createMockVector({
                search: vi.fn().mockResolvedValue([]),
                getStats: vi.fn().mockResolvedValue({ itemCount: 0 }),
            })

            const result = (await callTool(
                'semantic_search',
                { query: 'query', hint_on_empty: false },
                db,
                vectorManager
            )) as { count: number; hint?: string }

            expect(result.count).toBe(0)
            expect(result.hint).toBeUndefined()
        })

        it('should return error when no vector manager', async () => {
            const result = (await callTool('semantic_search', { query: 'query' }, db)) as {
                error: string
            }

            expect(result.error).toContain('not initialized')
        })
    })

    // ========================================================================
    // rebuild_vector_index
    // ========================================================================

    describe('rebuild_vector_index', () => {
        it('should rebuild and return count', async () => {
            const vectorManager = createMockVector()

            const result = (await callTool('rebuild_vector_index', {}, db, vectorManager)) as {
                success: boolean
                entriesIndexed: number
            }

            expect(result.success).toBe(true)
            expect(result.entriesIndexed).toBe(5)
        })

        it('should return error when no vector manager', async () => {
            const result = (await callTool('rebuild_vector_index', {}, db)) as { error: string }

            expect(result.error).toContain('not available')
        })
    })

    // ========================================================================
    // add_to_vector_index
    // ========================================================================

    describe('add_to_vector_index', () => {
        it('should add entry to index', async () => {
            const vectorManager = createMockVector()

            const result = (await callTool(
                'add_to_vector_index',
                { entry_id: entryId },
                db,
                vectorManager
            )) as { success: boolean; entryId: number }

            expect(result.success).toBe(true)
            expect(result.entryId).toBe(entryId)
        })

        it('should return error for nonexistent entry', async () => {
            const vectorManager = createMockVector()

            const result = (await callTool(
                'add_to_vector_index',
                { entry_id: 99999 },
                db,
                vectorManager
            )) as { error: string }

            expect(result.error).toContain('not found')
        })

        it('should return error when no vector manager', async () => {
            const result = (await callTool('add_to_vector_index', { entry_id: 1 }, db)) as {
                error: string
            }

            expect(result.error).toContain('not available')
        })
    })

    // ========================================================================
    // get_vector_index_stats
    // ========================================================================

    describe('get_vector_index_stats', () => {
        it('should return stats', async () => {
            const vectorManager = createMockVector()

            const result = (await callTool('get_vector_index_stats', {}, db, vectorManager)) as {
                available: boolean
                itemCount: number
                modelName: string
            }

            expect(result.available).toBe(true)
            expect(result.itemCount).toBe(10)
            expect(result.modelName).toBe('Xenova/all-MiniLM-L6-v2')
        })

        it('should return unavailable when no vector manager', async () => {
            const result = (await callTool('get_vector_index_stats', {}, db)) as {
                available: boolean
                error: string
            }

            expect(result.available).toBe(false)
            expect(result.error).toContain('not available')
        })
    })
})
