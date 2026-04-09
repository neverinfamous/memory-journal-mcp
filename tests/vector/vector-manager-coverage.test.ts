import { describe, it, expect, vi } from 'vitest'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('VectorSearchManager - error coverage', () => {
    it('covers initError path in addEntry', async () => {
        const mockDb = { getRawDb: vi.fn() } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        // Force initialization to fail by mocking initialize
        vi.spyOn(manager, 'initialize').mockRejectedValue(new Error('init err'))
        const res = await manager.addEntry(1, 'content')
        expect(res.success).toBe(false)
        expect(res.error).toContain('init err')
    })

    it('covers DB insertion error in addEntry', async () => {
        const mockDb = {
            getRawDb: vi.fn().mockReturnValue({
                prepare: vi.fn().mockReturnValue({
                    run: vi.fn().mockImplementation(() => {
                        throw new Error('db error')
                    }),
                }),
            }),
        } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        vi.spyOn(manager, 'initialize').mockResolvedValue()
        vi.spyOn(manager, 'generateEmbedding').mockResolvedValue([0.1])
        ;(manager as any).initialized = true

        const res = await manager.addEntry(1, 'content')
        expect(res.success).toBe(false)
        expect(res.error).toContain('db error')
    })

    it('covers error path in search', async () => {
        const mockDb = {
            getRawDb: vi.fn().mockReturnValue({
                prepare: vi.fn().mockReturnValue({
                    all: vi.fn().mockImplementation(() => {
                        throw new Error('db search err')
                    }),
                }),
            }),
        } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        vi.spyOn(manager, 'initialize').mockResolvedValue()
        vi.spyOn(manager, 'generateEmbedding').mockResolvedValue([0.1])
        ;(manager as any).initialized = true

        const res = await manager.search('query')
        expect(res).toEqual([])
    })

    it('covers error path in searchByEntryId', async () => {
        const mockDb = {
            getRawDb: vi.fn().mockReturnValue({
                prepare: vi.fn().mockImplementation(() => {
                    throw new Error('db search id err')
                }),
            }),
        } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        vi.spyOn(manager, 'initialize').mockResolvedValue()
        ;(manager as any).initialized = true

        const res = await manager.searchByEntryId(1)
        expect(res).toEqual([])
    })

    it('covers initError in rebuildIndex', async () => {
        const mockDb = { getRawDb: vi.fn() } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        vi.spyOn(manager, 'initialize').mockRejectedValue(new Error('init reb err'))
        const res = await manager.rebuildIndex(mockDb)
        expect(res.failed).toBe(0)
        expect(res.firstError).toContain('init reb err')
    })

    it('covers insertion and embedding errors in rebuildIndex', async () => {
        let calls = 0
        const mockDb = {
            getRawDb: vi.fn().mockReturnValue({
                prepare: vi.fn().mockImplementation((query: string) => ({
                    run: vi.fn().mockImplementation(() => {
                        if (query.includes('INSERT') && calls++ === 0) {
                            throw new Error('insert err first')
                        }
                    }),
                })),
            }),
            getActiveEntryCount: vi.fn().mockReturnValue(2),
            getEntriesPage: vi.fn().mockReturnValue([
                { id: 1, content: 'fail db' },
                { id: 2, content: 'fail embed' },
            ]),
        } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        vi.spyOn(manager, 'initialize').mockResolvedValue()
        vi.spyOn(manager, 'generateEmbedding').mockImplementation(async (content) => {
            if (content === 'fail embed') throw new Error('embed err')
            return [0.1]
        })
        ;(manager as any).initialized = true

        const res = await manager.rebuildIndex(mockDb)
        expect(res.failed).toBe(2) // 1 failed insert, 1 failed embed
        expect(res.firstError).toContain('insert err first') // whichever came first
    })

    it('covers error path in getStats', async () => {
        const mockDb = {
            getRawDb: vi.fn().mockReturnValue({
                prepare: vi.fn().mockImplementation(() => {
                    throw new Error('stats err')
                }),
            }),
        } as unknown as IDatabaseAdapter
        const manager = new VectorSearchManager(mockDb)
        const stats = manager.getStats()
        expect(stats.itemCount).toBe(0)
    })
})
