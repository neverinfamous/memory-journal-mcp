/**
 * VectorSearchManager Tests
 *
 * Tests VectorSearchManager with mocked @huggingface/transformers pipeline
 * and vectra LocalIndex. No real model loading or file I/O needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mock functions (must be declared before vi.mock)
// ============================================================================

const {
    mockEmbedderFn,
    mockIsIndexCreated,
    mockCreateIndex,
    mockInsertItem,
    mockDeleteItem,
    mockUpsertItem,
    mockQueryItems,
    mockListItems,
    mockGetIndexStats,
} = vi.hoisted(() => ({
    mockEmbedderFn: vi.fn(),
    mockIsIndexCreated: vi.fn(),
    mockCreateIndex: vi.fn(),
    mockInsertItem: vi.fn(),
    mockDeleteItem: vi.fn(),
    mockUpsertItem: vi.fn(),
    mockQueryItems: vi.fn(),
    mockListItems: vi.fn(),
    mockGetIndexStats: vi.fn(),
}))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('vectra', () => ({
    LocalIndex: function () {
        return {
            isIndexCreated: mockIsIndexCreated,
            createIndex: mockCreateIndex,
            insertItem: mockInsertItem,
            deleteItem: mockDeleteItem,
            upsertItem: mockUpsertItem,
            queryItems: mockQueryItems,
            listItems: mockListItems,
            getIndexStats: mockGetIndexStats,
        }
    },
}))

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(mockEmbedderFn),
}))

vi.mock('node:fs', async (importOriginal) => {
    const real = (await importOriginal()) as Record<string, unknown>
    return {
        ...real,
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        promises: {
            ...(real['promises'] as Record<string, unknown>),
            rm: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    }
})

// Import AFTER mocks are set up
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import type { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

/**
 * Helper to make the VectorSearchManager think it's initialized
 */
async function initManager(vm: VectorSearchManager): Promise<void> {
    mockIsIndexCreated.mockResolvedValue(true)
    mockEmbedderFn.mockResolvedValue({ data: new Float32Array(384) })
    await vm.initialize()
}

/** Generate a fake embedding vector of length 384 */
function fakeEmbedding(seed = 0): Float32Array {
    const arr = new Float32Array(384)
    for (let i = 0; i < 384; i++) arr[i] = Math.sin(i + seed) * 0.1
    return arr
}

describe('VectorSearchManager', () => {
    let vm: VectorSearchManager

    beforeEach(() => {
        vi.clearAllMocks()
        vm = new VectorSearchManager('/tmp/test.db')
    })

    // ========================================================================
    // Initialization
    // ========================================================================

    describe('isInitialized', () => {
        it('should return false before initialize()', () => {
            expect(vm.isInitialized()).toBe(false)
        })

        it('should return true after initialize()', async () => {
            await initManager(vm)
            expect(vm.isInitialized()).toBe(true)
        })
    })

    describe('initialize', () => {
        it('should load pipeline and create index if needed', async () => {
            mockIsIndexCreated.mockResolvedValue(false)
            mockEmbedderFn.mockResolvedValue({ data: new Float32Array(384) })

            await vm.initialize()

            expect(mockCreateIndex).toHaveBeenCalled()
            expect(vm.isInitialized()).toBe(true)
        })

        it('should be idempotent', async () => {
            await initManager(vm)
            await vm.initialize()
            expect(vm.isInitialized()).toBe(true)
        })
    })

    // ========================================================================
    // Generate Embedding
    // ========================================================================

    describe('generateEmbedding', () => {
        it('should generate embedding array from text', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(42) })

            const embedding = await vm.generateEmbedding('test text')
            expect(embedding).toHaveLength(384)
            expect(typeof embedding[0]).toBe('number')
        })

        it('should throw if not initialized', async () => {
            await expect(vm.generateEmbedding('test')).rejects.toThrow('not initialized')
        })
    })

    // ========================================================================
    // Add Entry
    // ========================================================================

    describe('addEntry', () => {
        it('should upsert entry via upsertItem', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(1) })
            mockUpsertItem.mockResolvedValue(undefined)

            const result = await vm.addEntry(42, 'Some content')
            expect(result).toBe(true)

            expect(mockUpsertItem).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: '42',
                    metadata: expect.objectContaining({ entryId: 42 }),
                })
            )
        })

        it('should return false on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue(new Error('Embedding failed'))

            const result = await vm.addEntry(99, 'Content')
            expect(result).toBe(false)
        })
    })

    // ========================================================================
    // Search
    // ========================================================================

    describe('search', () => {
        it('should return filtered results above threshold', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockQueryItems.mockResolvedValue([
                { score: 0.9, item: { metadata: { entryId: 1 } } },
                { score: 0.5, item: { metadata: { entryId: 2 } } },
                { score: 0.1, item: { metadata: { entryId: 3 } } },
            ])

            const results = await vm.search('query text', 10, 0.3)
            expect(results).toHaveLength(2)
            expect(results[0]!.entryId).toBe(1)
            expect(results[0]!.score).toBe(0.9)
        })

        it('should limit results to limit param', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockQueryItems.mockResolvedValue([
                { score: 0.9, item: { metadata: { entryId: 1 } } },
                { score: 0.8, item: { metadata: { entryId: 2 } } },
                { score: 0.7, item: { metadata: { entryId: 3 } } },
            ])

            const results = await vm.search('query', 2, 0.3)
            expect(results).toHaveLength(2)
        })

        it('should return empty on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue(new Error('Embed fail'))

            const results = await vm.search('query')
            expect(results).toEqual([])
        })
    })

    // ========================================================================
    // Remove Entry
    // ========================================================================

    describe('removeEntry', () => {
        it('should delete entry from index', async () => {
            await initManager(vm)
            mockDeleteItem.mockResolvedValue(undefined)

            const result = await vm.removeEntry(42)
            expect(result).toBe(true)
            expect(mockDeleteItem).toHaveBeenCalledWith('42')
        })

        it('should return false if index not available', async () => {
            const result = await vm.removeEntry(42)
            expect(result).toBe(false)
        })

        it('should return false on delete error', async () => {
            await initManager(vm)
            mockDeleteItem.mockRejectedValue(new Error('Not found'))

            const result = await vm.removeEntry(999)
            expect(result).toBe(false)
        })
    })

    // ========================================================================
    // Get Stats
    // ========================================================================

    describe('getStats', () => {
        it('should return stats from index', async () => {
            await initManager(vm)
            mockGetIndexStats.mockResolvedValue({ items: 100 })

            const stats = await vm.getStats()
            expect(stats.itemCount).toBe(100)
            expect(stats.modelName).toBe('Xenova/all-MiniLM-L6-v2')
            expect(stats.dimensions).toBe(384)
        })

        it('should return zero count when no index', async () => {
            const stats = await vm.getStats()
            expect(stats.itemCount).toBe(0)
        })

        it('should return zero count on error', async () => {
            await initManager(vm)
            mockGetIndexStats.mockRejectedValue(new Error('Corrupted'))

            const stats = await vm.getStats()
            expect(stats.itemCount).toBe(0)
        })
    })

    // ========================================================================
    // Rebuild Index
    // ========================================================================

    describe('rebuildIndex', () => {
        it('should rebuild from database entries', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockListItems.mockResolvedValue([])
            mockInsertItem.mockResolvedValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(2),
                getEntriesPage: vi.fn().mockReturnValue([
                    { id: 1, content: 'Entry one' },
                    { id: 2, content: 'Entry two' },
                ]),
            }

            const indexed = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(indexed).toBe(2)
            expect(mockInsertItem).toHaveBeenCalledTimes(2)
        })

        it('should wipe and recreate index directory instead of per-item deletion', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockListItems.mockResolvedValue([])
            mockInsertItem.mockResolvedValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(1),
                getEntriesPage: vi.fn().mockReturnValue([{ id: 1, content: 'Active entry' }]),
            }

            const indexed = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(indexed).toBe(1)
            // Should NOT call deleteItem (old per-item approach)
            expect(mockDeleteItem).not.toHaveBeenCalled()
            // Should recreate the index via createIndex
            // (called once during init + once during rebuild)
            expect(mockCreateIndex).toHaveBeenCalled()
        })

        it('should return 0 when index not available', async () => {
            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(0),
                getEntriesPage: vi.fn().mockReturnValue([]),
            }

            const indexed = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(indexed).toBe(0)
        })

        it('should still rebuild successfully after directory wipe', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockListItems.mockResolvedValue([])
            mockInsertItem.mockResolvedValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(1),
                getEntriesPage: vi.fn().mockReturnValue([{ id: 1, content: 'Entry' }]),
            }

            const indexed = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(indexed).toBe(1)
        })

        it('should skip entries with embedding failures', async () => {
            await initManager(vm)
            // First call succeeds, second fails
            mockEmbedderFn
                .mockResolvedValueOnce({ data: fakeEmbedding(1) })
                .mockRejectedValueOnce(new Error('Embedding failed'))
            mockListItems.mockResolvedValue([])
            mockInsertItem.mockResolvedValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(2),
                getEntriesPage: vi.fn().mockReturnValue([
                    { id: 1, content: 'Good entry' },
                    { id: 2, content: 'Will fail embedding' },
                ]),
            }

            const indexed = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            // Only 1 should be indexed (the other failed)
            expect(indexed).toBe(1)
        })
    })

    // ========================================================================
    // Initialize Error
    // ========================================================================

    describe('initialize error', () => {
        it('should rethrow pipeline errors', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('Model not found')
            )

            const vm2 = new VectorSearchManager('/tmp/test-error.db')
            await expect(vm2.initialize()).rejects.toThrow('Model not found')
            expect(vm2.isInitialized()).toBe(false)
        })
    })
})
