import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAutoPrune } from '../../src/server/auto-prune.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Auto Prune', () => {
    let mockDb: any

    beforeEach(() => {
        mockDb = {
            exportToFile: vi.fn().mockResolvedValue({ filename: 'test-backup.db', sizeBytes: 100 }),
            executeDataLifecycle: vi.fn().mockReturnValue({ archivedCount: 0, prunedCount: 0, hardDeletedCount: 0 }),
            cleanupStaleVectors: vi.fn(),
        }
    })

    it('should create a backup and not prune if count is 0', async () => {
        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 60,
            pruneOlderThanDays: 30,
            hardDeleteOlderThanDays: 90,
            importanceThreshold: 2,
        })

        expect(mockDb.exportToFile).toHaveBeenCalledWith('pre-prune-backup')
        expect(mockDb.executeDataLifecycle).toHaveBeenCalledWith({
            archiveOlderThanDays: 60,
            pruneOlderThanDays: 30,
            hardDeleteOlderThanDays: 90,
            importanceThreshold: 2,
            dryRun: undefined,
            excludeTags: undefined,
        })
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()

        expect(result.prunedCount).toBe(0)
        expect(result.backupFile).toBe('test-backup.db')
    })

    it('should clean up stale vectors if prunedCount > 0', async () => {
        mockDb.executeDataLifecycle.mockReturnValue({ archivedCount: 0, prunedCount: 5, hardDeletedCount: 0 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 20,
            pruneOlderThanDays: 10,
            hardDeleteOlderThanDays: 30,
            importanceThreshold: 1,
        })

        expect(mockDb.executeDataLifecycle).toHaveBeenCalledWith({
            archiveOlderThanDays: 20,
            pruneOlderThanDays: 10,
            hardDeleteOlderThanDays: 30,
            importanceThreshold: 1,
            dryRun: undefined,
            excludeTags: undefined,
        })
        expect(mockDb.cleanupStaleVectors).toHaveBeenCalled()
        expect(result.prunedCount).toBe(5)
    })

    it('should proceed even if backup fails', async () => {
        mockDb.exportToFile.mockRejectedValue(new Error('Backup failed'))
        mockDb.executeDataLifecycle.mockReturnValue({ archivedCount: 0, prunedCount: 2, hardDeletedCount: 0 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 10,
            pruneOlderThanDays: 5,
            hardDeleteOlderThanDays: 15,
            importanceThreshold: 1,
        })

        expect(result.backupFile).toBeNull()
        expect(mockDb.executeDataLifecycle).toHaveBeenCalled()
        expect(mockDb.cleanupStaleVectors).toHaveBeenCalled()
        expect(result.prunedCount).toBe(2)
    })

    it('should proceed even if cleanupStaleVectors fails', async () => {
        mockDb.executeDataLifecycle.mockReturnValue({ archivedCount: 0, prunedCount: 2, hardDeletedCount: 0 })
        mockDb.cleanupStaleVectors.mockImplementation(() => {
            throw new Error('Cleanup failed')
        })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 10,
            pruneOlderThanDays: 5,
            hardDeleteOlderThanDays: 15,
            importanceThreshold: 1,
        })

        expect(result.prunedCount).toBe(2)
        // Ensure no unhandled rejection occurred
    })

    it('should skip backup and cleanup on dryRun, and return candidates', async () => {
        mockDb.executeDataLifecycle.mockReturnValue({
            archivedCount: 0,
            prunedCount: 0,
            hardDeletedCount: 0,
            candidates: {
                archived: [{ id: 1, importance_score: 0.1 }],
                pruned: [{ id: 2, importance_score: 0.05 }],
                hardDeleted: []
            }
        })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 60,
            pruneOlderThanDays: 30,
            hardDeleteOlderThanDays: 90,
            importanceThreshold: 2,
            dryRun: true
        })

        expect(mockDb.exportToFile).not.toHaveBeenCalled()
        expect(mockDb.executeDataLifecycle).toHaveBeenCalledWith({
            archiveOlderThanDays: 60,
            pruneOlderThanDays: 30,
            hardDeleteOlderThanDays: 90,
            importanceThreshold: 2,
            dryRun: true,
            excludeTags: undefined,
        })
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()

        expect(result.archivedCount).toBe(1)
        expect(result.prunedCount).toBe(1)
        expect(result.backupFile).toBeNull()
    })

    it('should pass excludeTags to database adapter', async () => {
        mockDb.executeDataLifecycle.mockReturnValue({ archivedCount: 0, prunedCount: 3, hardDeletedCount: 0 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 30,
            pruneOlderThanDays: 15,
            hardDeleteOlderThanDays: 45,
            importanceThreshold: 1,
            excludeTags: ['architecture', 'planning']
        })

        expect(mockDb.executeDataLifecycle).toHaveBeenCalledWith({
            archiveOlderThanDays: 30,
            pruneOlderThanDays: 15,
            hardDeleteOlderThanDays: 45,
            importanceThreshold: 1,
            dryRun: undefined,
            excludeTags: ['architecture', 'planning'],
        })
        expect(result.prunedCount).toBe(3)
    })
})
