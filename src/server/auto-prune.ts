/**
 * Memory Journal MCP Server - Auto-Prune
 *
 * Importance-based garbage collector that soft-deletes old, low-importance
 * journal entries on server startup. Configurable via CLI flags / env vars.
 *
 * Algorithm:
 *   1. Create a safety backup before any mutations.
 *   2. Use the adapter's executeDataLifecycle() to identify and transition
 *      candidate entries older than `olderThanDays` with an importance
 *      score below `importanceThreshold` (computed entirely in SQL).
 *   3. Clean up stale vector embeddings.
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { logger } from '../utils/logger.js'

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
}

// ============================================================================
// Core
// ============================================================================

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
    const { archiveOlderThanDays, pruneOlderThanDays, hardDeleteOlderThanDays, importanceThreshold, dryRun, excludeTags } = options

    // ── Step 1: Safety backup ───────────────────────────────────────────
    let backupFile: string | null = null
    if (!dryRun) {
        try {
            const backup = await db.exportToFile('pre-prune-backup')
            backupFile = backup.filename
            logger.info('Pre-prune backup created', {
                module: 'AutoPrune',
                context: { filename: backup.filename, sizeBytes: backup.sizeBytes },
            })
        } catch (backupError) {
            logger.warning('Failed to create pre-prune backup — proceeding anyway', {
                module: 'AutoPrune',
                error: backupError instanceof Error ? backupError.message : String(backupError),
            })
        }
    }

    // ── Step 2: Prune via adapter ───────────────────────────────────────
    const result = db.executeDataLifecycle({
        archiveOlderThanDays,
        pruneOlderThanDays,
        hardDeleteOlderThanDays,
        importanceThreshold,
        dryRun,
        excludeTags
    })
    
    const archivedCount = result.archivedCount
    const prunedCount = result.prunedCount
    const hardDeletedCount = result.hardDeletedCount

    if (dryRun) {
        const cArchived = result.candidates?.archived.length ?? 0
        const cPruned = result.candidates?.pruned.length ?? 0
        const cHard = result.candidates?.hardDeleted.length ?? 0
        
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
                    archived: result.candidates?.archived,
                    pruned: result.candidates?.pruned,
                    hardDeleted: result.candidates?.hardDeleted
                }
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
        return { archivedCount: cArchived, prunedCount: cPruned, hardDeletedCount: cHard, backupFile, archiveOlderThanDays, pruneOlderThanDays, hardDeleteOlderThanDays, importanceThreshold }
    }

    if (archivedCount === 0 && prunedCount === 0 && hardDeletedCount === 0) {
        logger.info('Auto-prune: no candidates found', {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
        })
    } else {
        logger.info(`Auto-prune: processed entries (Archived: ${archivedCount}, Soft-deleted: ${prunedCount}, Hard-deleted: ${hardDeletedCount})`, {
            module: 'AutoPrune',
            archiveOlderThanDays,
            pruneOlderThanDays,
            hardDeleteOlderThanDays,
            importanceThreshold,
        })
    }

    // ── Step 3: Clean up stale vector embeddings ────────────────────────
    if (archivedCount > 0 || prunedCount > 0 || hardDeletedCount > 0) {
        try {
            db.cleanupStaleVectors()
            logger.info('Auto-prune: cleaned up stale vector embeddings', {
                module: 'AutoPrune',
            })
        } catch (cleanupError) {
            logger.warning('Auto-prune: failed to clean stale vectors (non-critical)', {
                module: 'AutoPrune',
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            })
        }
    }

    return { archivedCount, prunedCount, hardDeletedCount, backupFile, archiveOlderThanDays, pruneOlderThanDays, hardDeleteOlderThanDays, importanceThreshold }
}
