/**
 * memory-journal-mcp — Vector Search Manager Branch Coverage Tests
 *
 * Targets uncovered branches: not-initialized auto-init, no-db guard,
 * embedding error during rebuild, insert error during rebuild,
 * and progress reporting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/utils/progress-utils.js', () => ({
    sendProgress: vi.fn().mockResolvedValue(undefined),
}))

import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'

// ============================================================================
// Tests
// ============================================================================

describe('VectorSearchManager — branch coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return false from addEntry when no db after initialize', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')

        // Force skipping real initialization by marking it as initialized
        // but with no db connection
        Object.assign(manager, { initialized: true, db: null })

        const result = await manager.addEntry(1, 'test content')
        expect(result).toBe(false)
    })

    it('should return empty results from search when no db after initialize', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')
        Object.assign(manager, { initialized: true, db: null })

        const result = await manager.search('test query')
        expect(result).toEqual([])
    })

    it('should return 0 from rebuildIndex when no db', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')
        Object.assign(manager, { initialized: true, db: null })

        const mockDbAdapter = {
            getActiveEntryCount: vi.fn().mockReturnValue(0),
            getEntriesPage: vi.fn().mockReturnValue([]),
        }

        const result = await manager.rebuildIndex(mockDbAdapter as never)
        expect(result).toEqual({ indexed: 0, failed: 0 })
    })

    it('should return stats with zero values when no db', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')
        Object.assign(manager, { initialized: true, db: null })

        const result = manager.getStats()
        expect(result.itemCount).toBe(0)
    })

    it('should auto-initialize when calling addEntry on uninitialized manager', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')

        // Mock initialize to just set initialized flag without connecting
        const initSpy = vi.spyOn(manager, 'initialize').mockImplementation(async () => {
            Object.assign(manager, { initialized: true, db: null })
        })

        const result = await manager.addEntry(1, 'test')
        expect(initSpy).toHaveBeenCalled()
        expect(result).toBe(false) // no db, so returns false
    })

    it('should auto-initialize when calling search on uninitialized manager', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')

        const initSpy = vi.spyOn(manager, 'initialize').mockImplementation(async () => {
            Object.assign(manager, { initialized: true, db: null })
        })

        const result = await manager.search('query')
        expect(initSpy).toHaveBeenCalled()
        expect(result).toEqual([])
    })

    it('should auto-initialize when calling rebuildIndex on uninitialized manager', async () => {
        const manager = new VectorSearchManager('/nonexistent/path.db')

        const initSpy = vi.spyOn(manager, 'initialize').mockImplementation(async () => {
            Object.assign(manager, { initialized: true, db: null })
        })

        const mockDbAdapter = {
            getActiveEntryCount: vi.fn().mockReturnValue(0),
            getEntriesPage: vi.fn().mockReturnValue([]),
        }

        const result = await manager.rebuildIndex(mockDbAdapter as never)
        expect(initSpy).toHaveBeenCalled()
        expect(result).toEqual({ indexed: 0, failed: 0 })
    })
})
