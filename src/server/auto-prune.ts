/**
 * Memory Journal MCP Server - Auto-Prune
 *
 * Importance-based garbage collector that soft-deletes old, low-importance
 * journal entries on server startup. Configurable via CLI flags / env vars.
 *
 * Algorithm:
 *   1. Create a safety backup before any mutations.
 *   2. Use the adapter's pruneByImportance() to identify and soft-delete
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
    /** Soft-delete entries older than this many days */
    olderThanDays: number
    /** Importance score threshold — entries scoring below this are pruned */
    importanceThreshold: number
}

export interface AutoPruneResult {
    prunedCount: number
    backupFile: string | null
    olderThanDays: number
    importanceThreshold: number
}

// ============================================================================
// Core
// ============================================================================

/**
 * Run the auto-prune sweep against the database.
 *
 * Delegates the importance-based candidate selection and soft-delete to the
 * adapter's `pruneByImportance()` method, which uses the same SQL CTE and
 * expression as `calculateImportance()`. This avoids per-entry round-trips
 * and keeps all raw SQL inside the adapter layer.
 */
export async function runAutoPrune(
    db: IDatabaseAdapter,
    options: AutoPruneOptions
): Promise<AutoPruneResult> {
    const { olderThanDays, importanceThreshold } = options

    // ── Step 1: Safety backup ───────────────────────────────────────────
    let backupFile: string | null = null
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

    // ── Step 2: Prune via adapter ───────────────────────────────────────
    const prunedCount = db.pruneByImportance(olderThanDays, importanceThreshold)

    if (prunedCount === 0) {
        logger.info('Auto-prune: no candidates found', {
            module: 'AutoPrune',
            olderThanDays,
            importanceThreshold,
        })
    } else {
        logger.info(`Auto-prune: soft-deleted ${String(prunedCount)} entries`, {
            module: 'AutoPrune',
            olderThanDays,
            importanceThreshold,
        })
    }

    // ── Step 3: Clean up stale vector embeddings ────────────────────────
    if (prunedCount > 0) {
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

    return { prunedCount, backupFile, olderThanDays, importanceThreshold }
}
