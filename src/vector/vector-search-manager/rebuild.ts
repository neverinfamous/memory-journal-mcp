import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'
import { REBUILD_BATCH_SIZE, REBUILD_PAGE_SIZE } from './types.js'
import type { VectorSearchManager } from './manager.js'

// Allow mocking in tests
export const setTimeoutFn = globalThis.setTimeout

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
    }
): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null }> {
    const force = options?.force ?? false
    const batchSize = options?.batchSize ?? REBUILD_BATCH_SIZE
    const pageSize = options?.pageSize ?? REBUILD_PAGE_SIZE

    let indexed = 0
    let skipped = 0
    let errorsCount = 0
    let firstError: string | null = null

    let totalEntries: number
    try {
        totalEntries = dbAdapter.getActiveEntryCount()
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger.error('Failed to count entries for vector indexing', { error: err })
        return { success: false, indexed: 0, failed: 1, firstError: errorMessage }
    }

    if (totalEntries === 0) {
        return { success: true, indexed: 0, failed: 0, firstError: null }
    }

    await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild')

    let offset = 0
    while (offset < totalEntries) {
        const result = dbAdapter.getEntriesPage(offset, pageSize)
        const entries = result.entries
        if (entries.length === 0) break

        // Process a page in smaller batches
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize)
            const vectorsToUpsert: { entryId: number; embedding: Float32Array }[] = []

            for (const entry of batch) {
                // Check if already indexed unless forced
                if (!force) {
                    try {
                        const exists = dbAdapter.getVector(entry.id)
                        if (exists) {
                            skipped++
                            continue
                        }
                    } catch {
                        // Ignore check error and try to index anyway
                    }
                }

                try {
                    const text = `[${entry.entryType}] ${entry.content}`
                    const embedding = await manager.generateEmbedding(text)
                    vectorsToUpsert.push({ entryId: entry.id, embedding })
                } catch (err) {
                    errorsCount++
                    const errorMessage = err instanceof Error ? err.message : String(err)
                    firstError ??= errorMessage
                    logger.error(`Failed to generate embedding for entry ${entry.id}`, {
                        error: errorMessage,
                    })
                }
            }

            // Upsert the batch into the database
            if (vectorsToUpsert.length > 0) {
                try {
                    dbAdapter.upsertVectors(vectorsToUpsert)
                    indexed += vectorsToUpsert.length
                } catch (err) {
                    errorsCount += vectorsToUpsert.length
                    const errorMessage = err instanceof Error ? err.message : String(err)
                    firstError ??= errorMessage
                    logger.error('Failed to upsert vector batch', {
                        error: errorMessage,
                        batchSize: vectorsToUpsert.length
                    })
                }
            }

            // Yield to event loop
            await new Promise((resolve) => setTimeoutFn(resolve, 0))
            await sendProgress(
                progress,
                offset + i + batch.length,
                totalEntries,
                `Indexing... (${indexed} indexed, ${skipped} skipped)`
            )
        }

        offset += pageSize
    }
    
    if (errorsCount === 0) {
        try {
            dbAdapter.cleanupStaleVectors()
        } catch (err) {
            logger.warning('Failed to cleanup stale vectors after rebuild', { error: err })
        }
    }

    return {
        success: errorsCount === 0,
        indexed,
        failed: errorsCount,
        firstError,
    }
}
