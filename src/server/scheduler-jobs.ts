import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import { logger } from '../utils/logger.js'
import { deliverReport, formatDigestReport } from './digest-reporter.js'
import { runAutoPrune } from './auto-prune.js'
import {
    resolveSchedulerDefaultWorkspace,
    resolveSchedulerPruneScope,
} from './scheduler-scope.js'
import type { SchedulerOptions } from './scheduler.js'
import { VERSION } from '../version.js'

/** Backup job: export database to file, then cleanup old backups. */
export async function runScheduledBackup(
    db: IDatabaseAdapter,
    keepBackups: number
): Promise<void> {
    const result = await db.exportToFile()
    logger.info('Scheduled backup created', {
        module: 'Scheduler',
        operation: 'backup',
        context: { filename: result.filename, sizeBytes: result.sizeBytes },
    })

    const cleanup = db.deleteOldBackups(keepBackups)
    if (cleanup.deleted.length > 0) {
        logger.info(
            `Backup cleanup: deleted ${String(cleanup.deleted.length)}, kept ${String(cleanup.kept)}`,
            {
                module: 'Scheduler',
                operation: 'backup-cleanup',
            }
        )
    }

    // The adapter may report per-file deletion failures (not part of the declared interface)
    if ('failed' in cleanup) {
        const failedFiles: unknown = cleanup.failed
        const failedCount = Array.isArray(failedFiles)
            ? failedFiles.length
            : typeof failedFiles === 'number'
              ? failedFiles
              : 0
        if (failedCount > 0) {
            logger.error(`Backup cleanup failed to delete ${String(failedCount)} file(s)`, {
                module: 'Scheduler',
                operation: 'backup-cleanup',
                context: { failed: failedFiles },
            })
            throw new Error(
                `Backup cleanup failed to delete ${String(failedCount)} old backup(s)`
            )
        }
    }
}

/** Vacuum/optimize job: run PRAGMA optimize and flush to disk. */
export function runScheduledVacuumOptimize(db: IDatabaseAdapter): void {
    db.pragma('optimize')
    db.flushSave()
    logger.info('Scheduled database optimize completed', {
        module: 'Scheduler',
        operation: 'vacuum',
    })
}

/** Rebuild index job: full vector index rebuild from database entries. */
export async function runScheduledRebuildIndex(
    vectorManager: VectorSearchManager | null
): Promise<void> {
    if (!vectorManager) {
        return
    }

    const result = await vectorManager.rebuildIndex()
    if (!result.success) {
        throw new Error(
            `Vector index rebuild failed: ${String(result.failed)} entries could not be indexed${result.firstError !== null ? ` (${result.firstError})` : ''}`
        )
    }
    const count = result.indexed
    logger.info(`Scheduled vector index rebuild: ${String(count)} entries indexed`, {
        module: 'Scheduler',
        operation: 'rebuild-index',
        context: { entriesIndexed: count },
    })
}

/** Prune job: auto-prune low-importance old entries. */
export async function runScheduledPrune(
    db: IDatabaseAdapter,
    options: SchedulerOptions
): Promise<void> {
    const pruneScope = resolveSchedulerPruneScope(options)
    const pruneResult = await runAutoPrune(db, {
        archiveOlderThanDays: options.archiveOlderThanDays ?? 0,
        pruneOlderThanDays: options.pruneOlderThanDays ?? 0,
        hardDeleteOlderThanDays: options.hardDeleteOlderThanDays ?? 0,
        importanceThreshold: options.pruneImportanceThreshold ?? 0.15,
        dryRun: options.pruneDryRun,
        excludeTags: options.pruneExcludeTags,
        workspaceId: pruneScope.workspaceId,
        ...(pruneScope.projectNumber !== undefined
            ? { projectNumber: pruneScope.projectNumber }
            : {}),
    })
    if (pruneResult.aborted === true) {
        throw new Error('Scheduled auto-prune aborted because the pre-prune backup failed')
    }
    logger.info('Scheduled auto-prune completed', {
        module: 'Scheduler',
        operation: 'prune',
        archivedCount: pruneResult.archivedCount,
        prunedCount: pruneResult.prunedCount,
        hardDeletedCount: pruneResult.hardDeletedCount,
    })
}

/** Digest job: compute analytics snapshot and persist to database. */
export function runScheduledDigest(
    db: IDatabaseAdapter,
    options: SchedulerOptions
): void {
    const wsId = resolveSchedulerDefaultWorkspace(options)
    const snapshot = db.computeDigest(wsId)
    db.saveAnalyticsSnapshot('digest', snapshot, wsId)
    logger.info('Scheduled analytics digest computed', {
        module: 'Scheduler',
        operation: 'digest',
        context: {
            currentPeriodEntries: snapshot.currentPeriodEntries,
            activityGrowthPercent: snapshot.activityGrowthPercent,
            topImportanceCount: snapshot.topImportanceEntries.length,
        },
    })
}

/** Report job: compute analytics snapshot, persist, and deliver via webhook. */
export async function runScheduledReport(
    db: IDatabaseAdapter,
    options: SchedulerOptions
): Promise<void> {
    const wsId = resolveSchedulerDefaultWorkspace(options)
    const snapshot = db.computeDigest(wsId)
    db.saveAnalyticsSnapshot('report', snapshot, wsId)
    logger.info('Scheduled analytics report computed', {
        module: 'Scheduler',
        operation: 'report',
        context: { currentPeriodEntries: snapshot.currentPeriodEntries },
    })

    if (options.reportDeliveryOptions?.webhookUrl) {
        const report = formatDigestReport(snapshot, VERSION)
        const delivered = await deliverReport(report, snapshot, options.reportDeliveryOptions)
        if (!delivered) throw new Error('Scheduled analytics report delivery failed')
    }
}
