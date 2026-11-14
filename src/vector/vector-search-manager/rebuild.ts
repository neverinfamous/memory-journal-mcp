import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'
import { REBUILD_BATCH_SIZE, REBUILD_PAGE_SIZE } from './types.js'
import type { VectorSearchManager } from './manager.js'

// Allow mocking in tests
export const setTimeoutFn = globalThis.setTimeout

interface RebuildStats {
    indexed: number
    skipped: number
    errorsCount: number
    firstError: string | null
}

/** Returns true when the entry should be skipped (filtered out or already indexed). */
function shouldSkipEntry(
    dbAdapter: IDatabaseAdapter,
    entry: JournalEntry,
    force: boolean,
    projectNumber: number | undefined
): boolean {
    if (projectNumber !== undefined && entry.projectNumber !== projectNumber) {
        return true
    }
    if (force) return false

    // Check if already indexed unless forced
    try {
        return Boolean(dbAdapter.getVector(entry.id))
    } catch (err) {
        // Ignore check error and try to index anyway
        logger.debug('Vector existence check failed; indexing entry anyway', {
            entryId: entry.id,
            error: err instanceof Error ? err.message : String(err),
        })
        return false
    }
}

/** Embed one entry; returns null (and records the error) on failure. */
async function embedEntry(
    manager: VectorSearchManager,
    entry: JournalEntry,
    stats: RebuildStats
): Promise<{ entryId: number; embedding: Float32Array } | null> {
    try {
        const tagsText =
            entry.tags !== undefined && entry.tags !== null && entry.tags.length > 0
                ? ` [Tags: ${entry.tags.join(', ')}]`
                : ''
        const text = `[${entry.entryType}]${tagsText} ${entry.content}`
        const embedding = await manager.generateEmbedding(text)
        return { entryId: entry.id, embedding }
    } catch (err) {
        stats.errorsCount++
        const errorMessage = err instanceof Error ? err.message : String(err)
        stats.firstError ??= errorMessage
        logger.error(`Failed to generate embedding for entry ${entry.id}`, {
            error: errorMessage,
        })
        return null
    }
}

/** Embed and upsert one batch of entries, updating `stats`. */
async function processBatch(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    batch: JournalEntry[],
    force: boolean,
    projectNumber: number | undefined,
    stats: RebuildStats
): Promise<void> {
    const vectorsToUpsert: { entryId: number; embedding: Float32Array }[] = []

    for (const entry of batch) {
        if (shouldSkipEntry(dbAdapter, entry, force, projectNumber)) {
            stats.skipped++
            continue
        }
        const vector = await embedEntry(manager, entry, stats)
        if (vector !== null) vectorsToUpsert.push(vector)
    }

    // Upsert the batch into the database
    if (vectorsToUpsert.length === 0) return
    try {
        dbAdapter.upsertVectors(vectorsToUpsert)
        stats.indexed += vectorsToUpsert.length
    } catch (err) {
        stats.errorsCount += vectorsToUpsert.length
        const errorMessage = err instanceof Error ? err.message : String(err)
        stats.firstError ??= errorMessage
        logger.error('Failed to upsert vector batch', {
            error: errorMessage,
            batchSize: vectorsToUpsert.length,
        })
    }
}

/**
 * Rebuild the vector index incrementally to avoid blocking the event loop or database.
 * This function handles the orchestration, while relying on the manager instance for
 * generating embeddings and upserting into the database.
 */
export async function rebuildIndex(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    progress?: ProgressContext,
    options?: {
        force?: boolean
        batchSize?: number
        pageSize?: number
        projectNumber?: number
        workspaceId?: string
    }
): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null; warning?: string }> {
    const force = options?.force ?? false
    const batchSize = options?.batchSize ?? REBUILD_BATCH_SIZE
    const pageSize = options?.pageSize ?? REBUILD_PAGE_SIZE
    const wsScope = options?.workspaceId ?? '*'

    const stats: RebuildStats = { indexed: 0, skipped: 0, errorsCount: 0, firstError: null }

    let totalEntries: number
    try {
        totalEntries = dbAdapter.getActiveEntryCount(wsScope)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger.error('Failed to count entries for vector indexing', { error: err })
        return { success: false, indexed: 0, failed: 1, firstError: errorMessage }
    }

    if (totalEntries === 0) {
        let cleanupError: string | undefined
        try {
            dbAdapter.cleanupStaleVectors()
        } catch (err) {
            cleanupError = err instanceof Error ? err.message : String(err)
            logger.warning('Failed to cleanup stale vectors after rebuild', { error: err })
        }
        return {
            success: cleanupError === undefined,
            indexed: 0,
            failed: cleanupError === undefined ? 0 : 1,
            firstError: cleanupError ?? null,
            ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
        }
    }

    await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild')

    let offset = 0
    while (offset < totalEntries) {
        const result = dbAdapter.getEntriesPage(offset, pageSize, wsScope, options?.projectNumber)
        const entries = result.entries
        if (entries.length === 0) break

        // Process a page in smaller batches
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize)
            await processBatch(manager, dbAdapter, batch, force, options?.projectNumber, stats)

            // Yield to event loop
            await new Promise((resolve) => setTimeoutFn(resolve, 0))
            await sendProgress(
                progress,
                offset + i + batch.length,
                totalEntries,
                `Indexing... (${stats.indexed} indexed, ${stats.skipped} skipped)`
            )
        }

        offset += pageSize
    }

    let cleanupError: string | undefined
    if (stats.errorsCount === 0) {
        try {
            dbAdapter.cleanupStaleVectors()
        } catch (err) {
            cleanupError = err instanceof Error ? err.message : String(err)
            logger.warning('Failed to cleanup stale vectors after rebuild', { error: err })
        }
    }

    return {
        success: stats.errorsCount === 0 && cleanupError === undefined,
        indexed: stats.indexed,
        failed: stats.errorsCount,
        firstError: stats.firstError,
        ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
    }
}
