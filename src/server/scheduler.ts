/**
 * Memory Journal MCP Server - Scheduler
 *
 * Lightweight in-process scheduler for periodic maintenance jobs.
 * Only meaningful for HTTP/SSE transport (long-lived server processes).
 * Uses setInterval for simplicity — no external dependencies.
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { ToolHandlerConfig } from '../types/index.js'
import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import { logger } from '../utils/logger.js'
import { parseDigestSnapshot, type DigestSnapshot } from '../database/sqlite-adapter/entries/digest.js'
import type { ServerRuntime } from '../utils/maintenance-lock.js'
import { type ReportDeliveryOptions } from './digest-reporter.js'
import {
    applySchedulerWorkspaceUpdates,
    resolveSchedulerDefaultWorkspace,
    type SchedulerWorkspaceScope,
} from './scheduler-scope.js'
import {
    runScheduledBackup,
    runScheduledDigest,
    runScheduledPrune,
    runScheduledRebuildIndex,
    runScheduledReport,
    runScheduledVacuumOptimize,
} from './scheduler-jobs.js'

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
    /** Analytics digest interval in minutes (0 = disabled; recommended: 1440 for daily) */
    digestIntervalMinutes: number
    /** Scheduled report generation interval in minutes (0 = disabled; recommended: 10080 for weekly) */
    reportIntervalMinutes: number
    /** Webhook options for report delivery */
    reportDeliveryOptions?: ReportDeliveryOptions
    /** Automated pruning interval in minutes (0 = disabled; recommended: 1440 for daily) */
    pruneIntervalMinutes: number

    // Auto-prune configuration
    archiveOlderThanDays?: number
    pruneOlderThanDays?: number
    hardDeleteOlderThanDays?: number
    pruneImportanceThreshold?: number
    pruneDryRun?: boolean
    pruneExcludeTags?: string[]
    /** Workspace used by digest and report jobs. Omitted means `default`. */
    defaultWorkspaceId?: string
    /** Default project number used to resolve workspace when `defaultWorkspaceId` is unset. */
    defaultProjectNumber?: number
    /** Project registry used to resolve workspace when `defaultWorkspaceId` is unset. */
    projectRegistry?: ToolHandlerConfig['projectRegistry']
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
    isRunning?: boolean
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
 * - **digest**: Computes and persists an analytics snapshot for proactive insights.
 * - **prune**: Cleans up old, low-importance entries based on configuration.
 */
export class Scheduler {
    private readonly options: SchedulerOptions
    private readonly db: IDatabaseAdapter
    private readonly vectorManager: VectorSearchManager | null
    private readonly timers: JobTimer[] = []
    private started = false
    private sigtermHandler: (() => void) | null = null
    private readonly runtime?: ServerRuntime

    constructor(
        options: SchedulerOptions,
        db: IDatabaseAdapter,
        vectorManager?: VectorSearchManager,
        runtime?: ServerRuntime
    ) {
        this.options = options
        this.db = db
        this.vectorManager = vectorManager ?? null
        this.runtime = runtime
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

        // Prevent timer leaks on graceful shutdown
        this.sigtermHandler = (): void => {
            this.stop()
        }
        process.on('SIGTERM', this.sigtermHandler)

        const { backupIntervalMinutes, vacuumIntervalMinutes, rebuildIndexIntervalMinutes } =
            this.options

        if (backupIntervalMinutes > 0) {
            this.scheduleJob('backup', backupIntervalMinutes, () => this.runBackup())
        }

        if (vacuumIntervalMinutes > 0) {
            this.scheduleJob('vacuum', vacuumIntervalMinutes, () => {
                this.runVacuumOptimize()
                return Promise.resolve()
            })
        }

        if (this.options.pruneIntervalMinutes > 0) {
            this.scheduleJob('prune', this.options.pruneIntervalMinutes, () => this.runPrune())
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

        if (this.options.digestIntervalMinutes > 0) {
            this.scheduleJob('digest', this.options.digestIntervalMinutes, () => {
                this.runDigest()
                return Promise.resolve()
            })
        }

        if (this.options.reportIntervalMinutes > 0) {
            this.scheduleJob('report', this.options.reportIntervalMinutes, () => this.runReport())
        }

        if (this.timers.length > 0) {
            const summary = this.timers.map(
                (t: JobTimer) => `${t.name} (${String(t.intervalMinutes)}min)`
            )
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
        if (this.sigtermHandler !== null) {
            process.off('SIGTERM', this.sigtermHandler)
            this.sigtermHandler = null
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

        jobTimer.timer.unref()
        this.timers.push(jobTimer)
    }

    /**
     * Execute a job with error isolation and status tracking.
     */
    private async executeJob(job: JobTimer, fn: () => Promise<void>): Promise<void> {
        if (job.isRunning) {
            return
        }

        let inMaintenance = false
        if (!this.runtime) {
            logger.error(
                'ServerRuntime is required to schedule jobs safely. Bypassing maintenance check.',
                { module: 'Scheduler' }
            )
        } else {
            inMaintenance = this.runtime.maintenanceManager.isMaintenanceModeActive()
        }

        if (inMaintenance) {
            logger.info(`Skipping scheduled job '${job.name}' due to active maintenance mode`, {
                module: 'Scheduler',
                operation: job.name,
            })
            return
        }

        job.isRunning = true
        const startTime = Date.now()
        try {
            if (this.runtime) {
                await this.runtime.maintenanceManager.withActiveJob(fn)
            } else {
                await fn()
            }
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
        } finally {
            job.isRunning = false
        }
    }

    // ========================================================================
    // Private — Job implementations
    // ========================================================================

    private async runBackup(): Promise<void> {
        await runScheduledBackup(this.db, this.options.keepBackups)
    }

    private runVacuumOptimize(): void {
        runScheduledVacuumOptimize(this.db)
    }

    private async runRebuildIndex(): Promise<void> {
        await runScheduledRebuildIndex(this.vectorManager)
    }

    private resolveDefaultWorkspace(): string {
        // [INVARIANT] Background jobs never inherit sticky per-session context (C3): no runtime.
        return resolveSchedulerDefaultWorkspace(this.options)
    }

    /** Replace workspace context on hot reload. [INVARIANT] Absent fields are cleared. */
    updateWorkspaceContext(updates: SchedulerWorkspaceScope): void {
        applySchedulerWorkspaceUpdates(this.options, updates)
    }

    private async runPrune(): Promise<void> {
        await runScheduledPrune(this.db, this.options)
    }

    private runDigest(): void {
        runScheduledDigest(this.db, this.options)
    }

    private async runReport(): Promise<void> {
        await runScheduledReport(this.db, this.options)
    }

    /** Get the latest digest snapshot from the database, or null if none exists. */
    getLatestDigest(workspaceId?: string): DigestSnapshot | null {
        const snapshot = this.db.getLatestAnalyticsSnapshot(
            'digest',
            workspaceId ?? this.resolveDefaultWorkspace()
        )
        if (!snapshot) return null
        return parseDigestSnapshot(snapshot.data)
    }
}
