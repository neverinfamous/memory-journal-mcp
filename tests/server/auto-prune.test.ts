import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAutoPrune } from '../../src/server/auto-prune.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Auto Prune', () => {
    let mockDb: any

    beforeEach(() => {
        mockDb = {
            exportToFile: vi.fn().mockResolvedValue({ filename: 'test-backup.db', sizeBytes: 100 }),
            pruneByImportance: vi.fn().mockReturnValue(0),
            cleanupStaleVectors: vi.fn(),
        }
    })

    it('should create a backup and not prune if count is 0', async () => {
        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 30,
            importanceThreshold: 2,
        })

        expect(mockDb.exportToFile).toHaveBeenCalledWith('pre-prune-backup')
        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(30, 2)
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()

        expect(result.prunedCount).toBe(0)
        expect(result.backupFile).toBe('test-backup.db')
    })

    it('should clean up stale vectors if prunedCount > 0', async () => {
        mockDb.pruneByImportance.mockReturnValue(5)

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            olderThanDays: 10,
            importanceThreshold: 1,
        })

        expect(mockDb.pruneByImportance).toHaveBeenCalledWith(10, 1)
        expect(mockDb.cleanupStaleVectors).toHaveBeenCalled()
        expect(result.prunedCount).toBe(5)
    })

    it('should proceed even if backup fails', async () => {
        mockDb.exportToFile.mockRejectedValue(new Error('Backup failed'))
        mockDb.pruneByImportance.mockReturnValue(2)

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
        mockDb.pruneByImportance.mockReturnValue(2)
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
})
