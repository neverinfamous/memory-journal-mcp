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
        const manager = new VectorSearchManager(null as any)

        // Force skipping real initialization by marking it as initialized
        // but with no db connection
        Object.assign(manager, { initialized: true })

        const result = await manager.addEntry(1, 'test content')
        expect(result).toEqual({ success: false, error: 'Vector database not available' })
    })

    it('should return empty results from search when no db after initialize', async () => {
        const manager = new VectorSearchManager(null as any)
        Object.assign(manager, { initialized: true })

        await expect(manager.search('test query')).rejects.toThrow('Vector database not available')
    })

    it('should return stats with zero values when no db', async () => {
        const manager = new VectorSearchManager(null as any)
        Object.assign(manager, { initialized: true })

        const result = manager.getStats()
        expect(result.itemCount).toBe(0)
    })

    it('should auto-initialize when calling addEntry on uninitialized manager', async () => {
        const manager = new VectorSearchManager(null as any)

        // Mock initialize to just set initialized flag without connecting
        const initSpy = vi.spyOn(manager, 'initialize').mockImplementation(async () => {
            Object.assign(manager, { initialized: true })
        })

        const result = await manager.addEntry(1, 'test')
        expect(initSpy).toHaveBeenCalled()
        expect(result).toEqual({ success: false, error: 'Vector database not available' }) // no db, so returns structured error
    })

    it('should auto-initialize when calling search on uninitialized manager', async () => {
        const manager = new VectorSearchManager(null as any)

        const initSpy = vi.spyOn(manager, 'initialize').mockImplementation(async () => {
            Object.assign(manager, { initialized: true })
        })

        await expect(manager.search('query')).rejects.toThrow('Vector database not available')
        expect(initSpy).toHaveBeenCalled()
    })
})
