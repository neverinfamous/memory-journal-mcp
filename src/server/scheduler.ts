/**
 * Memory Journal MCP Server - Scheduler
 *
 * Lightweight in-process scheduler for periodic maintenance jobs.
 * Only meaningful for HTTP/SSE transport (long-lived server processes).
 * Uses setInterval for simplicity — no external dependencies.
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

/** Scheduler configuration options */
export interface SchedulerOptions {
    /** Automated backup interval in minutes (0 = disabled) */
    backupIntervalMinutes: number
    /** Max backups to retain during automated cleanup */
    keepBackups: number
    /** Database optimize interval in minutes (0 = disabled) */
    vacuumIntervalMinutes: number
    /** Vector index rebuild interval in minutes (0 = disabled) */
    rebuildIndexIntervalMinutes: number
}

/** Status of a single scheduled job */
export interface JobStatus {
    name: string
    enabled: boolean
    intervalMinutes: number
    lastRun: string | null
    lastResult: 'success' | 'error' | null
    lastError: string | null
    nextRun: string | null
    runCount: number
}

/** Overall scheduler status */
export interface SchedulerStatus {
    active: boolean
    jobs: JobStatus[]
}

/** Internal timer tracking for a job */
interface JobTimer {
    name: string
    intervalMinutes: number
    timer: ReturnType<typeof setInterval>
    lastRun: Date | null
    lastResult: 'success' | 'error' | null
    lastError: string | null
    runCount: number
}

// ============================================================================
// Scheduler
// ============================================================================

/**
 * Scheduler — runs periodic maintenance jobs for long-lived server processes.
 *
 * Jobs:
 * - **backup**: Exports database to timestamped file, then prunes old backups.
 * - **vacuum**: Runs `PRAGMA optimize` and flushes database to disk.
 * - **rebuild-index**: Rebuilds vector search index from all entries.
 */
export class Scheduler {
    private readonly options: SchedulerOptions
    private readonly db: IDatabaseAdapter
    private readonly vectorManager: VectorSearchManager | null
    private readonly timers: JobTimer[] = []
    private started = false

    constructor(options: SchedulerOptions, db: IDatabaseAdapter, vectorManager?: VectorSearchManager) {
        this.options = options
        this.db = db
        this.vectorManager = vectorManager ?? null
    }

    /**
     * Start all enabled scheduled jobs.
     * Each job runs on its own interval and failures are isolated.
     */
    start(): void {
        if (this.started) {
            logger.warning('Scheduler already started, ignoring duplicate start()', {
                module: 'Scheduler',
            })
            return
        }
        this.started = true

        const { backupIntervalMinutes, vacuumIntervalMinutes, rebuildIndexIntervalMinutes } =
            this.options

        if (backupIntervalMinutes > 0) {
            this.scheduleJob('backup', backupIntervalMinutes, () => this.runBackup())
        }

        if (vacuumIntervalMinutes > 0) {
            this.scheduleJob('vacuum', vacuumIntervalMinutes, () => this.runVacuumOptimize())
        }

        if (rebuildIndexIntervalMinutes > 0) {
            if (this.vectorManager) {
                this.scheduleJob('rebuild-index', rebuildIndexIntervalMinutes, () =>
                    this.runRebuildIndex()
                )
            } else {
                logger.warning(
                    'rebuild-index-interval specified but vector manager not available, skipping',
                    { module: 'Scheduler' }
                )
            }
        }

        if (this.timers.length > 0) {
            const summary = this.timers.map((t: JobTimer) => `${t.name} (${String(t.intervalMinutes)}min)`)
            logger.info(`Scheduler started: ${summary.join(', ')}`, { module: 'Scheduler' })
        } else {
            logger.info('Scheduler started with no jobs enabled', { module: 'Scheduler' })
        }
    }

    /**
     * Stop all scheduled jobs and clear timers.
     * Safe to call multiple times.
     */
    stop(): void {
        for (const job of this.timers) {
            clearInterval(job.timer)
        }
        if (this.timers.length > 0) {
            logger.info(`Scheduler stopped, cleared ${String(this.timers.length)} job(s)`, {
                module: 'Scheduler',
            })
        }
        this.timers.length = 0
        this.started = false
    }

    /**
     * Get the current status of all scheduled jobs.
     */
    getStatus(): SchedulerStatus {
        return {
            active: this.started,
            jobs: this.timers.map((t: JobTimer) => ({
                name: t.name,
                enabled: true,
                intervalMinutes: t.intervalMinutes,
                lastRun: t.lastRun?.toISOString() ?? null,
                lastResult: t.lastResult,
                lastError: t.lastError,
                nextRun: t.lastRun
                    ? new Date(t.lastRun.getTime() + t.intervalMinutes * 60_000).toISOString()
                    : new Date(Date.now() + t.intervalMinutes * 60_000).toISOString(),
                runCount: t.runCount,
            })),
        }
    }

    // ========================================================================
    // Private — Job scheduling
    // ========================================================================

    /**
     * Schedule a recurring job.
     */
    private scheduleJob(name: string, intervalMinutes: number, fn: () => Promise<void>): void {
        const intervalMs = intervalMinutes * 60_000

        const jobTimer: JobTimer = {
            name,
            intervalMinutes,
            timer: setInterval(() => {
                void this.executeJob(jobTimer, fn)
            }, intervalMs),
            lastRun: null,
            lastResult: null,
            lastError: null,
            runCount: 0,
        }

        this.timers.push(jobTimer)
    }

    /**
     * Execute a job with error isolation and status tracking.
     */
    private async executeJob(job: JobTimer, fn: () => Promise<void>): Promise<void> {
        const startTime = Date.now()
        try {
            await fn()
            job.lastRun = new Date(startTime)
            job.lastResult = 'success'
            job.lastError = null
            job.runCount++
        } catch (error) {
            job.lastRun = new Date(startTime)
            job.lastResult = 'error'
            job.lastError = error instanceof Error ? error.message : String(error)
            job.runCount++
            logger.error(`Scheduled job '${job.name}' failed`, {
                module: 'Scheduler',
                operation: job.name,
                error: job.lastError,
            })
        }
    }

    // ========================================================================
    // Private — Job implementations
    // ========================================================================

    /**
     * Backup job: export database to file, then cleanup old backups.
     */
    private async runBackup(): Promise<void> {
        const result = await this.db.exportToFile()
        logger.info('Scheduled backup created', {
            module: 'Scheduler',
            operation: 'backup',
            context: { filename: result.filename, sizeBytes: result.sizeBytes },
        })

        const cleanup = this.db.deleteOldBackups(this.options.keepBackups)
        if (cleanup.deleted.length > 0) {
            logger.info(
                `Backup cleanup: deleted ${String(cleanup.deleted.length)}, kept ${String(cleanup.kept)}`,
                {
                    module: 'Scheduler',
                    operation: 'backup-cleanup',
                }
            )
        }

        await Promise.resolve()
    }

    /**
     * Vacuum/optimize job: run PRAGMA optimize and flush to disk.
     *
     * Note: sql.js uses an in-memory database. PRAGMA optimize updates
     * internal statistics, and flushSave() ensures the disk file is current.
     * A full VACUUM on sql.js only compacts the in-memory representation.
     */
    private async runVacuumOptimize(): Promise<void> {
        const rawDb = this.db.getRawDb() as { run: (sql: string, params?: unknown[]) => void }
        rawDb.run('PRAGMA optimize')
        this.db.flushSave()
        logger.info('Scheduled database optimize completed', {
            module: 'Scheduler',
            operation: 'vacuum',
        })

        await Promise.resolve()
    }

    /**
     * Rebuild index job: full vector index rebuild from database entries.
     */
    private async runRebuildIndex(): Promise<void> {
        if (!this.vectorManager) {
            return
        }

        const count = await this.vectorManager.rebuildIndex(this.db)
        logger.info(`Scheduled vector index rebuild: ${String(count)} entries indexed`, {
            module: 'Scheduler',
            operation: 'rebuild-index',
            context: { entriesIndexed: count },
        })
    }
}
