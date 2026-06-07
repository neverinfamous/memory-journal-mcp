import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAutoPrune } from '../../src/server/auto-prune.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Auto Prune', () => {
    let mockDb: any

    beforeEach(() => {
        mockDb = {
            exportToFile: vi.fn().mockResolvedValue({ filename: 'test-backup.db', sizeBytes: 100 }),
            pruneByImportance: vi.fn().mockReturnValue({ prunedCount: 0 }),
            cleanupStaleVectors: vi.fn(),
        }
    })

    it('should create a backup and not prune if count is 0', async () => {
        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 30,
            importanceThreshold: 2,
        })

        expect(mockDb.exportToFile).toHaveBeenCalledWith('pre-prune-backup')
        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(30, 2, undefined, undefined)
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()

        expect(result.prunedCount).toBe(0)
        expect(result.backupFile).toBe('test-backup.db')
    })

    it('should clean up stale vectors if prunedCount > 0', async () => {
        mockDb.pruneByImportance.mockReturnValue({ prunedCount: 5 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 10,
            importanceThreshold: 1,
        })

        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(10, 1, undefined, undefined)
        expect(mockDb.cleanupStaleVectors).toHaveBeenCalled()
        expect(result.prunedCount).toBe(5)
    })

    it('should proceed even if backup fails', async () => {
        mockDb.exportToFile.mockRejectedValue(new Error('Backup failed'))
        mockDb.pruneByImportance.mockReturnValue({ prunedCount: 2 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 5,
            importanceThreshold: 1,
        })

        expect(result.backupFile).toBeNull()
        expect(mockDb.pruneByImportance).toHaveBeenCalled()
        expect(mockDb.cleanupStaleVectors).toHaveBeenCalled()
        expect(result.prunedCount).toBe(2)
    })

    it('should proceed even if cleanupStaleVectors fails', async () => {
        mockDb.pruneByImportance.mockReturnValue({ prunedCount: 2 })
        mockDb.cleanupStaleVectors.mockImplementation(() => {
            throw new Error('Cleanup failed')
        })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 5,
            importanceThreshold: 1,
        })

        expect(result.prunedCount).toBe(2)
        // Ensure no unhandled rejection occurred
    })

    it('should skip backup and cleanup on dryRun, and return candidates', async () => {
        mockDb.pruneByImportance.mockReturnValue({
            prunedCount: 0,
            candidates: [{ id: 1, importance_score: 0.1 }, { id: 2, importance_score: 0.05 }]
        })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 30,
            importanceThreshold: 2,
            dryRun: true
        })

        expect(mockDb.exportToFile).not.toHaveBeenCalled()
        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(30, 2, true, undefined)
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()

        expect(result.prunedCount).toBe(2)
        expect(result.backupFile).toBeNull()
    })

    it('should pass excludeTags to database adapter', async () => {
        mockDb.pruneByImportance.mockReturnValue({ prunedCount: 3 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 15,
            importanceThreshold: 1,
            excludeTags: ['architecture', 'planning']
        })

        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(15, 1, undefined, ['architecture', 'planning'])
        expect(result.prunedCount).toBe(3)
    })
})
