/**
 * memory-journal-mcp — Backup Tools Branch Coverage Tests
 *
 * Targeted tests for uncovered branches in restore_backup and cleanup_backups:
 * progress notifications, entry count change detection, error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/utils/error-helpers.js', () => ({
    formatHandlerErrorResponse: vi.fn().mockImplementation((err: Error) => ({
        success: false,
        error: err.message,
    })),
}))

vi.mock('../../src/utils/progress-utils.js', () => ({
    sendProgress: vi.fn().mockResolvedValue(undefined),
}))

import { getBackupTools } from '../../src/handlers/tools/backup.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        exportToFile: vi.fn().mockResolvedValue({
            filename: 'backup_2025-01-01.db',
            path: '/data/backups/backup_2025-01-01.db',
            sizeBytes: 1024,
        }),
        listBackups: vi.fn().mockReturnValue([
            { filename: 'backup_2025-01-01.db', path: '/data/backups/backup_2025-01-01.db', sizeBytes: 1024, createdAt: '2025-01-01' },
        ]),
        restoreFromFile: vi.fn().mockResolvedValue({
            restoredFrom: 'backup_2025-01-01.db',
            previousEntryCount: 100,
            newEntryCount: 95,
        }),
        deleteOldBackups: vi.fn().mockReturnValue({
            deleted: ['backup_old.db'],
            kept: 5,
        }),
        getBackupsDir: vi.fn().mockReturnValue('/data/backups'),
        ...overrides,
    }
}

function getHandler(db: ReturnType<typeof createMockDb>, name: string) {
    const tools = getBackupTools({ db, progress: null } as never)
    return tools.find((t) => t.name === name)!.handler
}

// ============================================================================
// Tests
// ============================================================================

describe('backup tools — branch coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ========================================================================
    // backup_journal
    // ========================================================================

    describe('backup_journal', () => {
        it('should create backup with custom name', async () => {
            const db = createMockDb()
            const handler = getHandler(db, 'backup_journal')

            const result = (await handler({ name: 'my-backup' })) as Record<string, unknown>
            expect(result['success']).toBe(true)
            expect(db.exportToFile).toHaveBeenCalledWith('my-backup')
        })

        it('should handle export error', async () => {
            const db = createMockDb({
                exportToFile: vi.fn().mockRejectedValue(new Error('disk full')),
            })
            const handler = getHandler(db, 'backup_journal')

            const result = (await handler({})) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })

    // ========================================================================
    // list_backups
    // ========================================================================

    describe('list_backups', () => {
        it('should show hint when no backups exist', () => {
            const db = createMockDb({ listBackups: vi.fn().mockReturnValue([]) })
            const handler = getHandler(db, 'list_backups')

            const result = handler({}) as Record<string, unknown>
            expect(result['total']).toBe(0)
            expect(result['hint']).toContain('No backups found')
        })

        it('should not show hint when backups exist', () => {
            const db = createMockDb()
            const handler = getHandler(db, 'list_backups')

            const result = handler({}) as Record<string, unknown>
            expect(result['total']).toBe(1)
            expect(result['hint']).toBeUndefined()
        })

        it('should handle error', () => {
            const db = createMockDb({
                listBackups: vi.fn().mockImplementation(() => { throw new Error('io') }),
            })
            const handler = getHandler(db, 'list_backups')

            const result = handler({}) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })

    // ========================================================================
    // restore_backup
    // ========================================================================

    describe('restore_backup', () => {
        it('should restore and report entry count change', async () => {
            const db = createMockDb()
            const handler = getHandler(db, 'restore_backup')

            const result = (await handler({ filename: 'backup_2025-01-01.db', confirm: true })) as Record<string, unknown>
            expect(result['success']).toBe(true)
            expect(result['previousEntryCount']).toBe(100)
            expect(result['newEntryCount']).toBe(95)

            // Entry count changed → revertedChanges.entries should include the diff message
            const reverted = result['revertedChanges'] as Record<string, unknown>
            expect(reverted['entries']).toContain('100')
            expect(reverted['entries']).toContain('95')
        })

        it('should not report entry diff when counts are equal', async () => {
            const db = createMockDb({
                restoreFromFile: vi.fn().mockResolvedValue({
                    restoredFrom: 'backup.db',
                    previousEntryCount: 100,
                    newEntryCount: 100,
                }),
            })
            const handler = getHandler(db, 'restore_backup')

            const result = (await handler({ filename: 'backup.db', confirm: true })) as Record<string, unknown>
            const reverted = result['revertedChanges'] as Record<string, unknown>
            expect(reverted['entries']).toBeUndefined()
        })

        it('should send progress notification when server/token are available', async () => {
            const mockNotification = vi.fn().mockResolvedValue(undefined)
            const progressCtx = {
                server: { notification: mockNotification },
                progressToken: 'tok-123',
            }

            const db = createMockDb()
            const tools = getBackupTools({ db, progress: progressCtx } as never)
            const handler = tools.find((t) => t.name === 'restore_backup')!.handler

            const result = (await handler({ filename: 'backup.db', confirm: true })) as Record<string, unknown>
            expect(result['success']).toBe(true)
            expect(mockNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'notifications/progress',
                    params: expect.objectContaining({ progress: 3, total: 3 }),
                })
            )
        })

        it('should handle progress notification failure gracefully', async () => {
            const progressCtx = {
                server: { notification: vi.fn().mockRejectedValue(new Error('notify failed')) },
                progressToken: 'tok-123',
            }

            const db = createMockDb()
            const tools = getBackupTools({ db, progress: progressCtx } as never)
            const handler = tools.find((t) => t.name === 'restore_backup')!.handler

            const result = (await handler({ filename: 'backup.db', confirm: true })) as Record<string, unknown>
            // Should still succeed even if notification fails
            expect(result['success']).toBe(true)
        })

        it('should handle restore error', async () => {
            const db = createMockDb({
                restoreFromFile: vi.fn().mockRejectedValue(new Error('corrupt backup')),
            })
            const handler = getHandler(db, 'restore_backup')

            const result = (await handler({ filename: 'bad.db', confirm: true })) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })

    // ========================================================================
    // cleanup_backups
    // ========================================================================

    describe('cleanup_backups', () => {
        it('should delete old backups and report counts', () => {
            const db = createMockDb()
            const handler = getHandler(db, 'cleanup_backups')

            const result = handler({ keep_count: 3 }) as Record<string, unknown>
            expect(result['success']).toBe(true)
            expect(result['deletedCount']).toBe(1)
            expect(result['message']).toContain('Deleted 1')
        })

        it('should show "no backups to delete" message when nothing deleted', () => {
            const db = createMockDb({
                deleteOldBackups: vi.fn().mockReturnValue({ deleted: [], kept: 3 }),
            })
            const handler = getHandler(db, 'cleanup_backups')

            const result = handler({ keep_count: 5 }) as Record<string, unknown>
            expect(result['deletedCount']).toBe(0)
            expect(result['message']).toContain('No backups to delete')
        })

        it('should handle error', () => {
            const db = createMockDb({
                deleteOldBackups: vi.fn().mockImplementation(() => { throw new Error('perm') }),
            })
            const handler = getHandler(db, 'cleanup_backups')

            const result = handler({ keep_count: 5 }) as Record<string, unknown>
            expect(result['success']).toBe(false)
        })
    })
})
