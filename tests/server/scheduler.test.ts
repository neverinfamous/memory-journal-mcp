/**
 * Tests for Scheduler module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler, type SchedulerOptions } from '../../src/server/scheduler.js'

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

/**
 * Creates a mock DatabaseAdapter with the methods used by Scheduler.
 */
function createMockDb() {
    return {
        exportToFile: vi.fn().mockReturnValue({
            filename: 'backup_2026-03-01.db',
            path: '/data/backups/backup_2026-03-01.db',
            sizeBytes: 4096,
        }),
        deleteOldBackups: vi.fn().mockReturnValue({
            deleted: ['old_backup.db'],
            kept: 5,
        }),
        getRawDb: vi.fn().mockReturnValue({
            run: vi.fn(),
        }),
        pragma: vi.fn(),
        flushSave: vi.fn(),
    }
}

/**
 * Creates a mock VectorSearchManager with rebuildIndex.
 */
function createMockVectorManager() {
    return {
        rebuildIndex: vi.fn().mockResolvedValue(42),
    }
}

function defaultOptions(overrides: Partial<SchedulerOptions> = {}): SchedulerOptions {
    return {
        backupIntervalMinutes: 0,
        keepBackups: 5,
        vacuumIntervalMinutes: 0,
        rebuildIndexIntervalMinutes: 0,
        ...overrides,
    }
}

describe('Scheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ========================================================================
    // Construction & start/stop
    // ========================================================================

    describe('start and stop', () => {
        it('should start with no jobs when all intervals are 0', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(defaultOptions(), db as never)
            scheduler.start()

            const status = scheduler.getStatus()
            expect(status.active).toBe(true)
            expect(status.jobs).toHaveLength(0)

            scheduler.stop()
        })

        it('should create timers for enabled jobs', () => {
            const db = createMockDb()
            const vectorManager = createMockVectorManager()
            const scheduler = new Scheduler(
                defaultOptions({
                    backupIntervalMinutes: 60,
                    vacuumIntervalMinutes: 120,
                    rebuildIndexIntervalMinutes: 180,
                }),
                db as never,
                vectorManager as never
            )
            scheduler.start()

            const status = scheduler.getStatus()
            expect(status.active).toBe(true)
            expect(status.jobs).toHaveLength(3)
            expect(status.jobs.map((j) => j.name)).toEqual(['backup', 'vacuum', 'rebuild-index'])

            scheduler.stop()
        })

        it('should ignore duplicate start calls', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 60 }),
                db as never
            )
            scheduler.start()
            scheduler.start() // duplicate — should be ignored

            const status = scheduler.getStatus()
            expect(status.jobs).toHaveLength(1) // still just 1

            scheduler.stop()
        })

        it('should clear all timers on stop', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 30, vacuumIntervalMinutes: 60 }),
                db as never
            )
            scheduler.start()
            expect(scheduler.getStatus().jobs).toHaveLength(2)

            scheduler.stop()
            expect(scheduler.getStatus().active).toBe(false)
            expect(scheduler.getStatus().jobs).toHaveLength(0)
        })

        it('should be safe to stop multiple times', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 30 }),
                db as never
            )
            scheduler.start()
            scheduler.stop()
            scheduler.stop() // should not throw

            expect(scheduler.getStatus().active).toBe(false)
        })

        it('should skip rebuild-index when vectorManager is not provided', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ rebuildIndexIntervalMinutes: 60 }),
                db as never
                // no vectorManager
            )
            scheduler.start()

            const status = scheduler.getStatus()
            expect(status.jobs).toHaveLength(0) // skipped

            scheduler.stop()
        })
    })

    // ========================================================================
    // Job execution
    // ========================================================================

    describe('backup job', () => {
        it('should call exportToFile and deleteOldBackups on interval', async () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 1, keepBackups: 3 }),
                db as never
            )
            scheduler.start()

            // Advance by 1 minute
            await vi.advanceTimersByTimeAsync(60_000)

            expect(db.exportToFile).toHaveBeenCalledOnce()
            expect(db.deleteOldBackups).toHaveBeenCalledWith(3)

            // Advance another minute
            await vi.advanceTimersByTimeAsync(60_000)

            expect(db.exportToFile).toHaveBeenCalledTimes(2)
            expect(db.deleteOldBackups).toHaveBeenCalledTimes(2)

            scheduler.stop()
        })

        it('should track job status after successful run', async () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 1 }),
                db as never
            )
            scheduler.start()

            await vi.advanceTimersByTimeAsync(60_000)

            const status = scheduler.getStatus()
            const backupJob = status.jobs.find((j) => j.name === 'backup')
            expect(backupJob).toBeDefined()
            expect(backupJob!.lastResult).toBe('success')
            expect(backupJob!.lastError).toBeNull()
            expect(backupJob!.runCount).toBe(1)
            expect(backupJob!.lastRun).toBeTruthy()

            scheduler.stop()
        })

        it('should track error status when backup fails', async () => {
            const db = createMockDb()
            db.exportToFile.mockImplementation(() => {
                throw new Error('Disk full')
            })

            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 1 }),
                db as never
            )
            scheduler.start()

            await vi.advanceTimersByTimeAsync(60_000)

            const status = scheduler.getStatus()
            const backupJob = status.jobs.find((j) => j.name === 'backup')
            expect(backupJob!.lastResult).toBe('error')
            expect(backupJob!.lastError).toBe('Disk full')
            expect(backupJob!.runCount).toBe(1)

            scheduler.stop()
        })

        it('should continue running after a failure', async () => {
            const db = createMockDb()
            db.exportToFile
                .mockImplementationOnce(() => {
                    throw new Error('Disk full')
                })
                .mockReturnValue({
                    filename: 'backup.db',
                    path: '/data/backups/backup.db',
                    sizeBytes: 4096,
                })

            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 1 }),
                db as never
            )
            scheduler.start()

            // First run — fails
            await vi.advanceTimersByTimeAsync(60_000)
            expect(scheduler.getStatus().jobs[0].lastResult).toBe('error')

            // Second run — succeeds
            await vi.advanceTimersByTimeAsync(60_000)
            expect(scheduler.getStatus().jobs[0].lastResult).toBe('success')
            expect(scheduler.getStatus().jobs[0].runCount).toBe(2)

            scheduler.stop()
        })
    })

    describe('vacuum job', () => {
        it('should call pragma optimize and flushSave on interval', async () => {
            const db = createMockDb()

            const scheduler = new Scheduler(
                defaultOptions({ vacuumIntervalMinutes: 1 }),
                db as never
            )
            scheduler.start()

            await vi.advanceTimersByTimeAsync(60_000)

            expect(db.pragma).toHaveBeenCalledWith('optimize')
            expect(db.flushSave).toHaveBeenCalledOnce()

            scheduler.stop()
        })
    })

    describe('rebuild-index job', () => {
        it('should call vectorManager.rebuildIndex on interval', async () => {
            const db = createMockDb()
            const vectorManager = createMockVectorManager()

            const scheduler = new Scheduler(
                defaultOptions({ rebuildIndexIntervalMinutes: 1 }),
                db as never,
                vectorManager as never
            )
            scheduler.start()

            await vi.advanceTimersByTimeAsync(60_000)

            expect(vectorManager.rebuildIndex).toHaveBeenCalledWith(db)

            const status = scheduler.getStatus()
            const job = status.jobs.find((j) => j.name === 'rebuild-index')
            expect(job!.lastResult).toBe('success')

            scheduler.stop()
        })
    })

    // ========================================================================
    // getStatus
    // ========================================================================

    describe('getStatus', () => {
        it('should return inactive status before start', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 60 }),
                db as never
            )

            const status = scheduler.getStatus()
            expect(status.active).toBe(false)
            expect(status.jobs).toHaveLength(0)
        })

        it('should include nextRun for jobs that have not run yet', () => {
            const db = createMockDb()
            const scheduler = new Scheduler(
                defaultOptions({ backupIntervalMinutes: 60 }),
                db as never
            )
            scheduler.start()

            const status = scheduler.getStatus()
            const job = status.jobs[0]
            expect(job.lastRun).toBeNull()
            expect(job.nextRun).toBeTruthy()

            scheduler.stop()
        })

        it('should correctly report interval for each job', () => {
            const db = createMockDb()
            const vectorManager = createMockVectorManager()
            const scheduler = new Scheduler(
                defaultOptions({
                    backupIntervalMinutes: 10,
                    vacuumIntervalMinutes: 20,
                    rebuildIndexIntervalMinutes: 30,
                }),
                db as never,
                vectorManager as never
            )
            scheduler.start()

            const status = scheduler.getStatus()
            expect(status.jobs[0].intervalMinutes).toBe(10)
            expect(status.jobs[1].intervalMinutes).toBe(20)
            expect(status.jobs[2].intervalMinutes).toBe(30)

            scheduler.stop()
        })
    })

    // ========================================================================
    // Error isolation
    // ========================================================================

    describe('error isolation', () => {
        it('should not stop other jobs when one fails', async () => {
            const db = createMockDb()
            db.exportToFile.mockImplementation(() => {
                throw new Error('Backup failed')
            })

            const scheduler = new Scheduler(
                defaultOptions({
                    backupIntervalMinutes: 1,
                    vacuumIntervalMinutes: 1,
                }),
                db as never
            )
            scheduler.start()

            await vi.advanceTimersByTimeAsync(60_000)

            // Backup failed but vacuum should still have run
            const status = scheduler.getStatus()
            const backupJob = status.jobs.find((j) => j.name === 'backup')
            const vacuumJob = status.jobs.find((j) => j.name === 'vacuum')
            expect(backupJob!.lastResult).toBe('error')
            expect(vacuumJob!.lastResult).toBe('success')

            scheduler.stop()
        })
    })
})
