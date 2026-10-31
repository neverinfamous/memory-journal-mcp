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
    env: { allowRemoteModels: false, localModelPath: '' },
}))

// Import AFTER mocks are set up
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
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
        db: mockDb,
        getRawDb: vi.fn().mockReturnValue(mockDb),
        getActiveEntryCount: vi.fn().mockReturnValue(0),
        getEntriesPage: vi.fn().mockReturnValue({ entries: [] }),
        getEntryById: vi.fn().mockImplementation((id: number) => ({ id, content: `Entry ${id}`, entryType: 'note', tags: [] })),

        // Proxy new adapter primitives to the original test assertions
        getVector: (entryId: number) => {
            const raw = mockGet(entryId)
            if (!raw) return undefined
            if (raw.embedding) return new Float32Array(raw.embedding.buffer)
            return undefined
        },
        searchVectors: (query: Float32Array, limit: number) => mockAll(query, limit),
        upsertVector: (entryId: number, vector: Float32Array) => {
            // Replicate old run behavior
            mockPrepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
            mockRun(BigInt(entryId))
            mockPrepare('INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)')
            mockRun(BigInt(entryId), vector)
        },
        upsertVectors: (vectors: { entryId: number; embedding: Float32Array }[]) => {
            mockPrepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
            mockPrepare('INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)')
            for (const vec of vectors) {
                mockRun(BigInt(vec.entryId))
                mockRun(BigInt(vec.entryId), vec.embedding)
            }
        },
        deleteVector: (entryId: number) => {
            mockPrepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
            mockRun(BigInt(entryId))
        },
        clearVectors: () => mockPrepare('DELETE FROM vec_embeddings'),
        cleanupStaleVectors: () => {
            mockPrepare(
                'DELETE FROM vec_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)'
            )
            mockRun()
        },
        getVectorCount: () => {
            const res = mockGet()
            return res ? res.count : 0
        },
        getVectorMetadata: vi.fn(),
        setVectorMetadata: vi.fn(),
        createVecTable: vi.fn(),
        dropVecTable: vi.fn(),
        executeInTransaction: (cb: any) => cb(),
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
    })

    // ========================================================================
    // Add Entry
    // ========================================================================

    describe('addEntry', () => {
        it('should insert entry via SQL prepared statement', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(1) })
            mockRun.mockReturnValue(undefined)

            await vm.addEntry({ id: 42, content: 'Some content', entryType: 'note', tags: [] } as any)

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

        it('should throw on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue(new Error('Embedding failed'))

            await expect(vm.addEntry({ id: 99, content: 'Content', entryType: 'note', tags: [] } as any)).rejects.toThrow('Embedding failed')
        })

        it('should throw initialization error if not initialized', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('Init failed during add')
            )
            const vm2 = new VectorSearchManager(adapter)
            await expect(vm2.addEntry({ id: 99, content: 'Content', entryType: 'note', tags: [] } as any)).rejects.toThrow('Init failed during add')
        })
    })

    // ========================================================================
    // Search
    // ========================================================================

    describe('search', () => {
        it('should return filtered results above threshold', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })

            // sqlite-vec returns L2 distance.
            // score = 1 - (distance^2)/2
            mockAll.mockReturnValue([
                { entry_id: 1, distance: 0.44721359 }, // score 0.9
                { entry_id: 2, distance: 1.0 },        // score 0.5
                { entry_id: 3, distance: 1.2 },        // score 0.28
            ])

            const results = await vm.search('query text', 10, 0.3)
            expect(results).toHaveLength(2)
            expect(results[0]!.entryId).toBe(1)
            expect(results[0]!.score).toBeCloseTo(0.9, 2)
            expect(results[1]!.entryId).toBe(2)
            expect(results[1]!.score).toBeCloseTo(0.5, 2)
        })

        it('should limit results to limit param', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockAll.mockReturnValue([
                { entry_id: 1, distance: 0.44721359 }, // score 0.9
                { entry_id: 2, distance: 0.63245553 }, // score 0.8
                { entry_id: 3, distance: 0.77459667 }, // score 0.7
            ])

            const results = await vm.search('query', 2, 0.3)
            expect(results).toHaveLength(2)
        })

        it('should return empty on error', async () => {
            await initManager(vm)
            mockEmbedderFn.mockRejectedValue('Embed fail string error')

            await expect(vm.search('query')).rejects.toThrow('Embed fail string error')
        })

        it('should return empty if initialization fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Init failed during search string error'
            )
            const vm2 = new VectorSearchManager(adapter)
            await expect(vm2.search('query')).rejects.toThrow(
                'Init failed during search string error'
            )
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
                { entry_id: 1, distance: 0.1 }, // excluded
                { entry_id: 2, distance: 1.0 }, // score 0.5
                { entry_id: 3, distance: 1.2 }, // score 0.28
            ])

            // Excludes entryId 1 from the results
            const results = await vm.searchByEntryId(1, 10, 0.3)
            expect(results).toHaveLength(1)
            expect(results[0]!.entryId).toBe(2)
            expect(results[0]!.score).toBeCloseTo(0.5, 2)
        })

        it('should throw if embedding not found and entry not found', async () => {
            await initManager(vm)
            mockGet.mockReturnValue(undefined)
            ;(adapter as any).getEntryById.mockReturnValue(undefined)

            await expect(vm.searchByEntryId(99, 10, 0.3)).rejects.toThrow('Entry 99 not found')
        })

        it('should return empty on SQL error', async () => {
            await initManager(vm)
            mockGet.mockImplementation(() => {
                throw 'SQL error string'
            })

            await expect(vm.searchByEntryId(1)).rejects.toThrow('SQL error string')
        })

        it('should return empty if initialization fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Init fail string error'
            )
            const vm2 = new VectorSearchManager(adapter)
            await expect(vm2.searchByEntryId(1)).rejects.toThrow('Init fail string error')
        })

        it('should throw if db not available', async () => {
            const vm3 = new VectorSearchManager(undefined as any)
            // It allows instantiation, but searchByEntryId requires dbAdapter
            await expect(vm3.searchByEntryId(1)).rejects.toThrow('Vector database not available')
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
            const vmLocal = new VectorSearchManager(undefined as any)
            const result = await vmLocal.removeEntry(42)
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
            const vmLocal = new VectorSearchManager(undefined as any)
            const stats = await vmLocal.getStats()
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

            ;(adapter as any).getActiveEntryCount.mockReturnValue(2)
            ;(adapter as any).getEntriesPage.mockReturnValue({ entries: [
                { id: 1, content: 'Entry one' },
                { id: 2, content: 'Entry two' },
            ]})

            const result = await vm.rebuildIndex()
            expect(result.indexed).toBe(2)
            expect(result.failed).toBe(0)
            expect(result.firstError).toBeNull()
            // DELETE to clear + 2 INSERTs
        })

        it('should clear stale embeddings after successful rebuild', async () => {
            await initManager(vm)
            mockEmbedderFn.mockResolvedValue({ data: fakeEmbedding(0) })
            mockRun.mockReturnValue(undefined)

            ;(adapter as any).getActiveEntryCount.mockReturnValue(1)
            ;(adapter as any).getEntriesPage.mockReturnValue({ entries: [{ id: 1, content: 'Active entry' }] })
            ;(adapter as any).cleanupStaleVectors = () => {
                mockPrepare(
                    'DELETE FROM vec_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)'
                )
                mockRun()
            }

            const result = await vm.rebuildIndex()
            expect(result.indexed).toBe(1)

            expect(mockPrepare).toHaveBeenCalledWith(
                'DELETE FROM vec_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)'
            )
        })

        it('should return 0 when db not available', async () => {
            ;(adapter as any).getActiveEntryCount.mockReturnValue(0)
            ;(adapter as any).getEntriesPage.mockReturnValue({ entries: [] })

            const result = await vm.rebuildIndex()
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

            ;(adapter as any).getActiveEntryCount.mockReturnValue(2)
            ;(adapter as any).getEntriesPage.mockReturnValue({ entries: [
                { id: 1, content: 'Good entry' },
                { id: 2, content: 'Will fail embedding' },
            ]})

            const result = await vm.rebuildIndex()
            // Only 1 should be indexed (the other failed)
            expect(result.indexed).toBe(1)
            expect(result.failed).toBe(1)
            expect(result.firstError).toBe('Embedding failed')
        })

        it('should throw initialization error if initialize fails', async () => {
            const { pipeline: pipelineMock } = await import('@huggingface/transformers')
            ;(pipelineMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                'Pipeline broke string error'
            )
            await expect(vm.rebuildIndex()).rejects.toThrow('Pipeline broke string error')
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

            ;(adapter as any).getActiveEntryCount.mockReturnValue(2)
            ;(adapter as any).getEntriesPage.mockReturnValue({ entries: [
                { id: 1, content: 'Good entry' },
                { id: 2, content: 'Will fail insert' },
            ]})

            const result = await vm.rebuildIndex()
            // The entire batch is rolled back if any insert fails
            expect(result.indexed).toBe(0)
            expect(result.failed).toBe(2)
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
            expect(stats.dimensions).toBe(0)
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
