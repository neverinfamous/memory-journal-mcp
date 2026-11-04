import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prePruneBackupPathsToDelete, runAutoPrune } from '../../src/server/auto-prune.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Auto Prune', () => {
    let mockDb: any

    beforeEach(() => {
        mockDb = {
            exportToFile: vi.fn().mockResolvedValue({ filename: 'test-backup.db', sizeBytes: 100 }),
            listBackups: vi.fn().mockReturnValue([]),
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

        expect(mockDb.exportToFile).toHaveBeenCalledTimes(1)
        const backupName = mockDb.exportToFile.mock.calls[0][0] as string
        expect(backupName.startsWith('pre-prune-')).toBe(true)
        expect(backupName.includes(':')).toBe(false)
        expect(backupName.length).toBeLessThanOrEqual(50)
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

    it('aborts the prune when the safety backup fails', async () => {
        mockDb.exportToFile.mockRejectedValue(new Error('Backup failed'))
        mockDb.executeDataLifecycle.mockReturnValue({ archivedCount: 0, prunedCount: 2, hardDeletedCount: 0 })

        const result = await runAutoPrune(mockDb as unknown as IDatabaseAdapter, {
            archiveOlderThanDays: 10,
            pruneOlderThanDays: 5,
            hardDeleteOlderThanDays: 15,
            importanceThreshold: 1,
        })

        expect(result.backupFile).toBeNull()
        expect(mockDb.executeDataLifecycle).not.toHaveBeenCalled()
        expect(mockDb.cleanupStaleVectors).not.toHaveBeenCalled()
        expect(result.prunedCount).toBe(0)
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

    it('selects pre-prune backups beyond the newest five and leaves other backups', () => {
        const backups = [
            ...Array.from({ length: 6 }, (_, index) => ({
                filename: `pre-prune-${index}.db`,
                path: `/tmp/pre-prune-${index}.db`,
            })),
            { filename: 'backup_user.db', path: '/tmp/backup_user.db' },
        ]
        expect(prePruneBackupPathsToDelete(backups).map((backup) => backup.path)).toEqual([
            '/tmp/pre-prune-5.db',
        ])
    })
})
