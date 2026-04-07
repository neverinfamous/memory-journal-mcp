/**
 * VectorSearchManager Tests
 *
 * Tests VectorSearchManager with mocked @huggingface/transformers pipeline
 * and mocked better-sqlite3 database. No real model loading or extension I/O needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mock functions (must be declared before vi.mock)
// ============================================================================

const { mockEmbedderFn, mockPrepare, mockRun, mockAll, mockGet } = vi.hoisted(() => ({
    mockEmbedderFn: vi.fn(),
    mockPrepare: vi.fn(),
    mockRun: vi.fn(),
    mockAll: vi.fn(),
    mockGet: vi.fn(),
}))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(mockEmbedderFn),
}))

// Import AFTER mocks are set up
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

/**
 * Creates a mock IDatabaseAdapter whose getRawDb() returns a mock better-sqlite3 Database.
 */
function createMockDbAdapter() {
    // Mock the prepare().run() / prepare().all() / prepare().get() chain
    mockPrepare.mockReturnValue({
        run: mockRun,
        all: mockAll,
        get: mockGet,
    })

    const mockDb = {
        prepare: mockPrepare,
        exec: vi.fn(),
    }

    const adapter = {
        getRawDb: vi.fn().mockReturnValue(mockDb),
        getActiveEntryCount: vi.fn().mockReturnValue(0),
        getEntriesPage: vi.fn().mockReturnValue([]),
    } as unknown as IDatabaseAdapter

    return { adapter, mockDb }
}

/**
 * Helper to make the VectorSearchManager think it's initialized
 */
async function initManager(vm: VectorSearchManager): Promise<void> {
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
    let adapter: IDatabaseAdapter

    beforeEach(() => {
        vi.clearAllMocks()
        const mocks = createMockDbAdapter()
        adapter = mocks.adapter
        vm = new VectorSearchManager(adapter)
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
        it('should load pipeline', async () => {
            mockEmbedderFn.mockResolvedValue({ data: new Float32Array(384) })
            await vm.initialize()

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
        it('should insert entry via SQL prepared statement', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(1) })
            mockRun.mockReturnValue(undefined)

            const result = await vm.addEntry(42, 'Some content')
            expect(result.success).toBe(true)

            // Should prepare DELETE then INSERT statements
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM vec_embeddings WHERE entry_id = ?'
            )
            expect(mockPrepare).toHaveBeenCalledWith(
                'INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)'
            )
            // Should call run with BigInt entryId for DELETE, and BigInt + Float32Array for INSERT
            expect(mockRun).toHaveBeenCalledWith(BigInt(42))
            expect(mockRun).toHaveBeenCalledWith(BigInt(42), expect.any(Float32Array))
        })

        it('should return false on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue(new Error('Embedding failed'))

            const result = await vm.addEntry(99, 'Content')
            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('should return initialization error if not initialized', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('Init failed during add')
            )
            const vm2 = new VectorSearchManager(adapter)
            const result = await vm2.addEntry(99, 'Content')
            expect(result.success).toBe(false)
            expect(result.error).toContain(
                'Vector search initialization failed: Init failed during add'
            )
        })
    })

    // ========================================================================
    // Search
    // ========================================================================

    describe('search', () => {
        it('should return filtered results above threshold', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })

            // sqlite-vec returns distance (lower = more similar)
            // score = 1 / (1 + distance)
            // distance=0.1 -> score≈0.91, distance=1.0 -> score=0.5, distance=9.0 -> score=0.1
            mockAll.mockReturnValue([
                { entry_id: 1, distance: 0.1 },
                { entry_id: 2, distance: 1.0 },
                { entry_id: 3, distance: 9.0 },
            ])

            const results = await vm.search('query text', 10, 0.3)
            expect(results).toHaveLength(2)
            expect(results[0]!.entryId).toBe(1)
            expect(results[0]!.score).toBeCloseTo(1 / 1.1, 2)
        })

        it('should limit results to limit param', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockAll.mockReturnValue([
                { entry_id: 1, distance: 0.1 },
                { entry_id: 2, distance: 0.2 },
                { entry_id: 3, distance: 0.3 },
            ])

            const results = await vm.search('query', 2, 0.3)
            expect(results).toHaveLength(2)
        })

        it('should return empty on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue('Embed fail string error')

            const results = await vm.search('query')
            expect(results).toEqual([])
        })

        it('should return empty if initialization fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Init failed during search string error'
            )
            const vm2 = new VectorSearchManager(adapter)
            const results = await vm2.search('query')
            expect(results).toEqual([])
        })
    })

    // ========================================================================
    // Search By Entry ID
    // ========================================================================

    describe('searchByEntryId', () => {
        it('should return filtered results based on existing embedding', async () => {
            await initManager(vm)
            mockGet.mockReturnValue({ embedding: Buffer.from(fakeEmbedding(0).buffer) })

            mockAll.mockReturnValue([
                { entry_id: 1, distance: 0.1 },
                { entry_id: 2, distance: 1.0 },
                { entry_id: 3, distance: 9.0 },
            ])

            // Excludes entryId 1 from the results
            const results = await vm.searchByEntryId(1, 10, 0.3)
            expect(results).toHaveLength(1)
            expect(results[0]!.entryId).toBe(2)
            expect(results[0]!.score).toBeCloseTo(0.5, 2)
        })

        it('should return empty if embedding not found', async () => {
            await initManager(vm)
            mockGet.mockReturnValue(undefined)

            const results = await vm.searchByEntryId(99, 10, 0.3)
            expect(results).toEqual([])
        })

        it('should return empty on SQL error', async () => {
            await initManager(vm)
            mockGet.mockImplementation(() => {
                throw 'SQL error string'
            })

            const results = await vm.searchByEntryId(1)
            expect(results).toEqual([])
        })

        it('should return empty if initialization fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Init fail string error'
            )
            const vm2 = new VectorSearchManager(adapter)
            const results = await vm2.searchByEntryId(1)
            expect(results).toEqual([])
        })

        it('should return empty if db not available', async () => {
            await initManager(vm)
            ;(adapter.getRawDb as any).mockReturnValue(null) // Or throw error, testing db check
            const vm3 = new VectorSearchManager(adapter)
            await initManager(vm3)
            ;(adapter.getRawDb as any).mockImplementation(() => {
                throw new Error('No db')
            })
            const results = await vm3.searchByEntryId(1)
            expect(results).toEqual([])
        })
    })

    // ========================================================================
    // Remove Entry
    // ========================================================================

    describe('removeEntry', () => {
        it('should delete entry via SQL', async () => {
            await initManager(vm)
            mockRun.mockReturnValue(undefined)

            const result = await vm.removeEntry(42)
            expect(result).toBe(true)
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM vec_embeddings WHERE entry_id = ?'
            )
            expect(mockRun).toHaveBeenCalledWith(BigInt(42))
        })

        it('should return false if db not available', async () => {
            ;(adapter.getRawDb as any).mockImplementation(() => {
                throw new Error('No db')
            })
            const result = await vm.removeEntry(42)
            expect(result).toBe(false)
        })

        it('should return false on delete error', async () => {
            await initManager(vm)
            mockRun.mockImplementation(() => {
                throw new Error('SQL error')
            })

            const result = await vm.removeEntry(999)
            expect(result).toBe(false)
        })
    })

    // ========================================================================
    // Get Stats
    // ========================================================================

    describe('getStats', () => {
        it('should return count from SQL', async () => {
            await initManager(vm)
            mockGet.mockReturnValue({ count: 100 })

            const stats = await vm.getStats()
            expect(stats.itemCount).toBe(100)
            expect(stats.modelName).toBe('Xenova/all-MiniLM-L6-v2')
            expect(stats.dimensions).toBe(384)
        })

        it('should return zero count when no db', async () => {
            ;(adapter.getRawDb as any).mockImplementation(() => {
                throw new Error('No db')
            })
            const stats = await vm.getStats()
            expect(stats.itemCount).toBe(0)
        })

        it('should return zero count on error', async () => {
            await initManager(vm)
            mockGet.mockImplementation(() => {
                throw new Error('SQL error')
            })

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
            mockRun.mockReturnValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(2),
                getEntriesPage: vi.fn().mockReturnValue([
                    { id: 1, content: 'Entry one' },
                    { id: 2, content: 'Entry two' },
                ]),
            }

            const result = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(result.indexed).toBe(2)
            expect(result.failed).toBe(0)
            expect(result.firstError).toBeNull()
            // DELETE to clear + 2 INSERTs
            expect(mockRun).toHaveBeenCalledTimes(3)
        })

        it('should clear existing embeddings before rebuild', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockRun.mockReturnValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(1),
                getEntriesPage: vi.fn().mockReturnValue([{ id: 1, content: 'Active entry' }]),
            }

            const result = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(result.indexed).toBe(1)

            // First call should be DELETE FROM vec_embeddings
            expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM vec_embeddings')
        })

        it('should return 0 when db not available', async () => {
            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(0),
                getEntriesPage: vi.fn().mockReturnValue([]),
            }

            const result = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(result.indexed).toBe(0)
            expect(result.failed).toBe(0)
        })

        it('should skip entries with embedding failures', async () => {
            await initManager(vm)
            // First call succeeds, second fails
            mockEmbedderFn
                .mockResolvedValueOnce({ data: fakeEmbedding(1) })
                .mockRejectedValueOnce(new Error('Embedding failed'))
            mockRun.mockReturnValue(undefined)

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(2),
                getEntriesPage: vi.fn().mockReturnValue([
                    { id: 1, content: 'Good entry' },
                    { id: 2, content: 'Will fail embedding' },
                ]),
            }

            const result = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            // Only 1 should be indexed (the other failed)
            expect(result.indexed).toBe(1)
            expect(result.failed).toBe(1)
            expect(result.firstError).toBe('Embedding failed')
        })

        it('should return initialization error if initialize fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Pipeline broke string error'
            )
            const result = await vm.rebuildIndex({} as any)
            expect(result.firstError).toContain(
                'Vector search initialization failed: Pipeline broke'
            )
        })

        it('should handle insert statement failure during rebuild', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })

            // Mock run to throw ONLY on the second insert (after DELETE)
            mockRun
                .mockImplementationOnce(() => undefined) // DELETE
                .mockImplementationOnce(() => undefined) // 1st INSERT
                .mockImplementationOnce(() => {
                    throw new Error('Insert failed!!')
                }) // 2nd INSERT

            const mockDb = {
                getActiveEntryCount: vi.fn().mockReturnValue(2),
                getEntriesPage: vi.fn().mockReturnValue([
                    { id: 1, content: 'Good entry' },
                    { id: 2, content: 'Will fail insert' },
                ]),
            }

            const result = await vm.rebuildIndex(mockDb as unknown as DatabaseAdapter)
            expect(result.indexed).toBe(1)
            expect(result.failed).toBe(1)
            expect(result.firstError).toBe('Insert failed!!')
        })
    })

    // ========================================================================
    // Initialize Error
    // ========================================================================

    describe('initialize error', () => {
        it('should rethrow pipeline errors', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Model not found string'
            )

            const vm2 = new VectorSearchManager(adapter)
            await expect(vm2.initialize()).rejects.toEqual('Model not found string')
            expect(vm2.isInitialized()).toBe(false)
        })
    })

    describe('removeEntry', () => {
        it('should return false if db not available', () => {
            const fakeAdapter = {
                getRawDb: () => {
                    throw new Error()
                },
            } as any
            const freshVm = new VectorSearchManager(fakeAdapter)
            const result = freshVm.removeEntry(1)
            expect(result).toBe(false)
        })

        it('should remove entry and return true', async () => {
            await initManager(vm)
            mockRun.mockReturnValue(undefined)
            const result = vm.removeEntry(1)
            expect(result).toBe(true)
            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM vec_embeddings WHERE entry_id = ?'
            )
        })

        it('should handle SQLite errors', async () => {
            await initManager(vm)
            mockRun.mockImplementation(() => {
                throw 'remove fail string error'
            })
            const result = vm.removeEntry(1)
            expect(result).toBe(false)
        })
    })

    describe('getStats', () => {
        it('should return default stats if db not available', () => {
            const fakeAdapter = {
                getRawDb: () => {
                    throw new Error()
                },
            } as any
            const freshVm = new VectorSearchManager(fakeAdapter)
            const stats = freshVm.getStats()
            expect(stats.itemCount).toBe(0)
            expect(stats.dimensions).toBe(384)
        })

        it('should return item count', async () => {
            await initManager(vm)
            mockGet.mockReturnValue({ count: 42 })
            const stats = vm.getStats()
            expect(stats.itemCount).toBe(42)
        })

        it('should handle SQLite errors', async () => {
            await initManager(vm)
            mockGet.mockImplementation(() => {
                throw 'stats fail string error'
            })
            const stats = vm.getStats()
            expect(stats.itemCount).toBe(0)
        })
    })
})
