import { describe, it, expect, vi } from 'vitest'
import { computeRRFScores, hybridSearch } from '../../src/handlers/tools/search/hybrid.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import type { JournalEntry } from '../../src/types/index.js'

describe('Hybrid Search', () => {
    describe('computeRRFScores', () => {
        it('computes correct reciprocal rank fusion scores', () => {
            const list1 = [1, 2, 3] // Ranks 0, 1, 2 = 1/61, 1/62, 1/63
            const list2 = [2, 3, 4] // Ranks 0, 1, 2 = 1/61, 1/62, 1/63

            const scores = computeRRFScores([list1, list2])
            
            // Expected RRF constants with K=60
            // 1: 1/61
            // 2: 1/62 + 1/61
            // 3: 1/63 + 1/62
            // 4: 1/63
            expect(scores.get(1)).toBeCloseTo(1/61)
            expect(scores.get(2)).toBeCloseTo(1/62 + 1/61)
            expect(scores.get(3)).toBeCloseTo(1/63 + 1/62)
            expect(scores.get(4)).toBeCloseTo(1/63)
        })

        it('handles undefined rankings safely', () => {
            // Emulating sparse/gappy arrays if they ever happen
            const list1 = [1]
            list1[2] = 3
            const scores = computeRRFScores([list1])
            
            expect(scores.has(1)).toBe(true)
            expect(scores.has(3)).toBe(true)
            // score for 3 is at index 2 (rank 2 -> 1/(60+3)=1/63)
            expect(scores.get(3)).toBeCloseTo(1/63)
        })
    })

    describe('hybridSearch', () => {
        const mockEntries: Record<number, JournalEntry> = {
            1: { id: 1, isPersonal: true } as JournalEntry,
            2: { id: 2, isPersonal: true } as JournalEntry,
            3: { id: 3, isPersonal: false } as JournalEntry, // Team entry
        }

        const mockDb = {
            searchEntries: vi.fn(),
            getEntriesByIds: vi.fn().mockImplementation((ids: number[]) => {
                const map = new Map<number, JournalEntry>()
                for (const id of ids) {
                    if (mockEntries[id]) map.set(id, mockEntries[id])
                }
                return map
            })
        } as unknown as IDatabaseAdapter

        const mockVectorManager = {
            search: vi.fn()
        } as unknown as VectorSearchManager

        it('combines FTS5 and vector results successfully', async () => {
            vi.mocked(mockDb.searchEntries).mockResolvedValueOnce([
                { id: 1 }, { id: 2 }
            ] as JournalEntry[])
            
            vi.mocked(mockVectorManager.search).mockResolvedValueOnce([
                { entryId: 2, similarity: 0.9 },
                { entryId: 3, similarity: 0.8 }
            ] as any[])

            const result = await hybridSearch('test query', mockDb, mockVectorManager, { limit: 10 })
            
            const entries = result.entries
            // 2 is ranked #2 in FTS and #1 in Semantic, highest combined score
            // 1 is ranked #1 in FTS, 3 is ranked #2 in Semantic
            expect(entries.length).toBe(3)
            expect(entries[0]!.id).toBe(2)
            
            // All get personal source badge appended in this code path
            expect(entries[0]!.source).toBe('personal')
        })

        it('filters correctly by isPersonal', async () => {
            vi.mocked(mockDb.searchEntries).mockResolvedValueOnce([
                { id: 1 }, { id: 2 }, { id: 3 }
            ] as JournalEntry[])

            vi.mocked(mockVectorManager.search).mockResolvedValueOnce([])

            // Limit to personal (isPersonal = true)
            const result = await hybridSearch('test', mockDb, mockVectorManager, { 
                limit: 10,
                isPersonal: true 
            })
            
            // Filter should drop id 3
            expect(result.entries.length).toBe(2)
            expect(result.entries.map(e => e.id)).toEqual(expect.arrayContaining([1, 2]))
        })

        it('works safely without vectorManager', async () => {
            vi.mocked(mockDb.searchEntries).mockResolvedValueOnce([
                { id: 1 }
            ] as JournalEntry[])

            const result = await hybridSearch('test', mockDb, undefined, { limit: 10 })
            
            expect(result.entries.length).toBe(1)
            expect(result.entries[0]!.id).toBe(1)
        })

        it('respects limit constraints', async () => {
            vi.mocked(mockDb.searchEntries).mockResolvedValueOnce([
                { id: 1 }, { id: 2 }, { id: 3 }
            ] as JournalEntry[])

            vi.mocked(mockVectorManager.search).mockResolvedValueOnce([])

            const result = await hybridSearch('test', mockDb, undefined, { limit: 2 })
            
            // Only top 2 entries are fetched and returned
            expect(result.entries.length).toBe(2)
        })
    })
})
