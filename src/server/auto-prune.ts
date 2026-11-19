/**
 * Memory Journal MCP Server - Auto-Prune
 *
 * Importance-based garbage collector that archives, soft-deletes, or hard-deletes
 * old, low-importance journal entries. Runs on startup, via CLI (`admin prune`),
 * or via MCP (`run_auto_prune`, e.g. nightly CMS-02 maintenance).
 *
 * Algorithm:
 *   1. Probe lifecycle candidates first via dry-run; skip backup creation if 0 candidates match.
 *   2. When candidates exist, create a safety backup before any mutations.
 *   3. Execute `executeDataLifecycle()` to transition eligible entries (computed in SQL).
 *   4. Refresh SQLite query planner statistics (`PRAGMA optimize`) and clean stale vectors.
 */

import * as fs from 'node:fs'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { logger } from '../utils/logger.js'

const PRE_PRUNE_KEEP = 5

export function prePruneBackupName(now: Date): string {
    return `pre-prune-${now.toISOString().replace(/[:.]/g, '-')}`
}

export function prePruneBackupPathsToDelete(
    backups: { filename: string; path: string }[],
    keepCount = PRE_PRUNE_KEEP
): { filename: string; path: string }[] {
    return backups.filter((backup) => backup.filename.startsWith('pre-prune-')).slice(keepCount)
}

function rotatePrePruneBackups(db: IDatabaseAdapter): void {
    for (const backup of prePruneBackupPathsToDelete(db.listBackups())) {
        try {
            fs.unlinkSync(backup.path)
        } catch (error: unknown) {
            logger.warning('Failed to delete old pre-prune backup', {
                filename: backup.filename,
                error: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    }
}

// ============================================================================
// Types
// ============================================================================

export interface AutoPruneOptions {
    /** Archive active entries older than this many days */
    archiveOlderThanDays: number
    /** Soft-delete entries older than this many days */
    pruneOlderThanDays: number
    /** Hard-delete soft-deleted entries older than this many days */
    hardDeleteOlderThanDays: number
    /** Importance score threshold — entries scoring below this are archived/pruned */
    importanceThreshold: number
    /** If true, return candidates but do not soft-delete or create backups */
    dryRun?: boolean
    /** Tags to exclude from auto-prune */
    excludeTags?: string[]
    /** Optional workspace ID to scope auto-prune when configured */
    workspaceId?: string
    /** When set, only rows with this project number are eligible. */
    projectNumber?: number
}

export interface AutoPruneResult {
    archivedCount: number
    prunedCount: number
    hardDeletedCount: number
    backupFile: string | null
    archiveOlderThanDays: number
    pruneOlderThanDays: number
    hardDeleteOlderThanDays: number
    importanceThreshold: number
    /** True when the pre-prune backup failed and no rows were changed. */
    aborted?: boolean
}

// ============================================================================
// Core
// ============================================================================

async function createPrePruneSafetyBackup(db: IDatabaseAdapter): Promise<{ backupFile: string | null; aborted: boolean }> {
    try {
        const backup = await db.exportToFile(prePruneBackupName(new Date()))
        rotatePrePruneBackups(db)
        logger.info('Pre-prune backup created', {
            module: 'AutoPrune',
            context: { filename: backup.filename, sizeBytes: backup.sizeBytes },
        })
        return { backupFile: backup.filename, aborted: false }
    } catch (backupError) {
        logger.error('Failed to create pre-prune backup — aborting prune', {
            module: 'AutoPrune',
            error: backupError instanceof Error ? backupError.message : String(backupError),
        })
        return { backupFile: null, aborted: true }
    }
}

function logDryRunCandidates(
    options: AutoPruneOptions,
    candidates: ReturnType<IDatabaseAdapter['executeDataLifecycle']>['candidates']
): { cArchived: number; cPruned: number; cHard: number } {
    const { archiveOlderThanDays, pruneOlderThanDays, hardDeleteOlderThanDays, importanceThreshold } = options
    const cArchived = candidates?.archived.length ?? 0
    const cPruned = candidates?.pruned.length ?? 0
    const cHard = candidates?.hardDeleted.length ?? 0

    if (cArchived > 0 || cPruned > 0 || cHard > 0) {
        logger.info(`Auto-prune dry-run: found candidates`, {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
            candidates: {
                archivedCount: cArchived,
                prunedCount: cPruned,
                hardDeletedCount: cHard,
                archived: candidates?.archived,
                pruned: candidates?.pruned,
                hardDeleted: candidates?.hardDeleted,
            },
        })
    } else {
        logger.info('Auto-prune dry-run: no candidates found', {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
        })
    }
    return { cArchived, cPruned, cHard }
}

function buildAutoPruneResult(
    options: AutoPruneOptions,
    counts: { archivedCount: number; prunedCount: number; hardDeletedCount: number },
    backupFile: string | null,
    aborted?: boolean
): AutoPruneResult {
    return {
        archivedCount: counts.archivedCount,
        prunedCount: counts.prunedCount,
        hardDeletedCount: counts.hardDeletedCount,
        backupFile,
        archiveOlderThanDays: options.archiveOlderThanDays,
        pruneOlderThanDays: options.pruneOlderThanDays,
        hardDeleteOlderThanDays: options.hardDeleteOlderThanDays,
        importanceThreshold: options.importanceThreshold,
        ...(aborted === true ? { aborted: true } : {}),
    }
}

function tryOptimizePlanner(db: IDatabaseAdapter): void {
    if (typeof db.pragma !== 'function') {
        return
    }
    try {
        db.pragma('optimize')
    } catch (optError) {
        logger.debug('Auto-prune: PRAGMA optimize skipped', {
            module: 'AutoPrune',
            error: optError instanceof Error ? optError.message : String(optError),
        })
    }
}

function finalizeLivePrune(
    db: IDatabaseAdapter,
    options: AutoPruneOptions,
    counts: { archivedCount: number; prunedCount: number; hardDeletedCount: number }
): void {
    tryOptimizePlanner(db)

    const { archiveOlderThanDays, pruneOlderThanDays, hardDeleteOlderThanDays, importanceThreshold } =
        options
    const { archivedCount, prunedCount, hardDeletedCount } = counts
    if (archivedCount === 0 && prunedCount === 0 && hardDeletedCount === 0) {
        logger.info('Auto-prune: no candidates found', {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
        })
        return
    }
    logger.info(
        `Auto-prune: processed entries (Archived: ${String(archivedCount)}, Soft-deleted: ${String(prunedCount)}, Hard-deleted: ${String(hardDeletedCount)})`,
        {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
        }
    )
    try {
        db.cleanupStaleVectors()
        logger.info('Auto-prune: cleaned up stale vector embeddings', { module: 'AutoPrune' })
    } catch (cleanupError) {
        logger.warning('Auto-prune: failed to clean stale vectors (non-critical)', {
            module: 'AutoPrune',
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
    }
}

/**
 * Run the auto-prune sweep against the database.
 *
 * Delegates the importance-based candidate selection and soft-delete to the
 * adapter's `executeDataLifecycle()` method, which uses the same SQL CTE and
 * expression as `calculateImportance()`. This avoids per-entry round-trips
 * and keeps all raw SQL inside the adapter layer.
 */
export async function runAutoPrune(
    db: IDatabaseAdapter,
    options: AutoPruneOptions
): Promise<AutoPruneResult> {
    const {
        archiveOlderThanDays,
        pruneOlderThanDays,
        hardDeleteOlderThanDays,
        importanceThreshold,
        dryRun,
        excludeTags,
        workspaceId,
        projectNumber,
    } = options

    if (dryRun) {
        const result = db.executeDataLifecycle({
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
            dryRun: true,
            excludeTags,
            workspaceId,
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })
        const { cArchived, cPruned, cHard } = logDryRunCandidates(options, result.candidates)
        return buildAutoPruneResult(
            options,
            { archivedCount: cArchived, prunedCount: cPruned, hardDeletedCount: cHard },
            null
        )
    }

    // ── Step 1: Dry-run probe before safety backup ──────────────────────
    const probe = db.executeDataLifecycle({
        archiveOlderThanDays,
        pruneOlderThanDays,
        hardDeleteOlderThanDays,
        importanceThreshold,
        dryRun: true,
        excludeTags,
        workspaceId,
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    })
    const hasCandidates =
        probe.candidates !== undefined
            ? probe.candidates.archived.length +
                  probe.candidates.pruned.length +
                  probe.candidates.hardDeleted.length >
              0
            : probe.archivedCount + probe.prunedCount + probe.hardDeletedCount > 0

    if (!hasCandidates) {
        const zeroCounts = { archivedCount: 0, prunedCount: 0, hardDeletedCount: 0 }
        finalizeLivePrune(db, options, zeroCounts)
        return buildAutoPruneResult(options, zeroCounts, null)
    }

    // ── Step 2: Safety backup (only when >= 1 candidate will mutate) ────
    const safety = await createPrePruneSafetyBackup(db)
    if (safety.aborted) {
        return buildAutoPruneResult(
            options,
            { archivedCount: 0, prunedCount: 0, hardDeletedCount: 0 },
            null,
            true
        )
    }
    const backupFile = safety.backupFile

    // ── Step 3: Live prune via adapter ──────────────────────────────────
    const result = db.executeDataLifecycle({
        archiveOlderThanDays,
        pruneOlderThanDays,
        hardDeleteOlderThanDays,
        importanceThreshold,
        dryRun,
        excludeTags,
        workspaceId,
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    })

    finalizeLivePrune(db, options, result)
    return buildAutoPruneResult(options, result, backupFile)
}
