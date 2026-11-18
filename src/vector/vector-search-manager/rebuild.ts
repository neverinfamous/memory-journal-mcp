import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'
import { REBUILD_BATCH_SIZE, REBUILD_PAGE_SIZE } from './types.js'
import type { VectorSearchManager } from './manager.js'
import { formatEntryForEmbedding } from './candidate-search.js'
import { effectiveWorkspace } from '../../database/workspace-scope.js'
import { isMissingTableError } from '../../database/sqlite-adapter/schema-errors.js'

// Allow mocking in tests
export const setTimeoutFn = globalThis.setTimeout

interface RebuildStats {
    indexed: number
    skipped: number
    errorsCount: number
    firstError: string | null
}

/**
 * Verify `vec_journal_entries` exists and matches model dimensions; recreate on mismatch.
 */
export function verifyVecTableSchema(
    dbAdapter: IDatabaseAdapter,
    modelName: string,
    dimensions: number
): void {
    let needsRecreation = false
    try {
        const existingDimStr = dbAdapter.getVectorMetadata('dimensions')
        const existingModel = dbAdapter.getVectorMetadata('model_name')
        if (existingDimStr) {
            const existingDim = parseInt(existingDimStr, 10)
            if (
                existingDim !== dimensions ||
                (existingModel !== null &&
                    existingModel !== undefined &&
                    existingModel !== '' &&
                    existingModel !== modelName)
            ) {
                needsRecreation = true
                logger.info('Vector model or dimensions changed, dropping old index', {
                    oldModel: existingModel || 'unknown',
                    newModel: modelName,
                    oldDimensions: existingDim,
                    newDimensions: dimensions,
                })
            }
        } else {
            needsRecreation = true
        }
    } catch (err) {
        if (isMissingTableError(err)) {
            needsRecreation = true
            logger.warning('Vector metadata table not found, recreating vector index', { error: err })
        } else {
            logger.error('Failed to verify vector table dimensions due to database error', { error: err })
            throw err
        }
    }

    if (needsRecreation) {
        try {
            dbAdapter.executeInTransaction(() => {
                dbAdapter.dropVecTable()
                dbAdapter.createVecTable(dimensions)
                dbAdapter.setVectorMetadata('model_name', modelName)
                dbAdapter.setVectorMetadata('dimensions', dimensions.toString())
            })
            logger.info(`Created new vec_journal_entries table with ${dimensions} dimensions`)
        } catch (err) {
            logger.error('Failed to recreate vector table', { error: err })
            throw err
        }
    } else {
        dbAdapter.createVecTable(dimensions)
    }
}

/** Returns true when the entry should be skipped (filtered out or already indexed). */
function shouldSkipEntry(
    dbAdapter: IDatabaseAdapter,
    entry: JournalEntry,
    force: boolean,
    skipExistenceCheck: boolean,
    projectNumber: number | undefined,
    existingVectorIds?: ReadonlySet<number>
): boolean {
    if (projectNumber !== undefined && entry.projectNumber !== projectNumber) {
        return true
    }
    if (force || skipExistenceCheck) return false
    if (existingVectorIds !== undefined) {
        return existingVectorIds.has(entry.id)
    }

    // Check if already indexed unless forced or vector table is known empty
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

function recordEmbedError(entryId: number, err: unknown, stats: RebuildStats): void {
    stats.errorsCount++
    const errorMessage = err instanceof Error ? err.message : String(err)
    stats.firstError ??= errorMessage
    logger.error(`Failed to generate embedding for entry ${entryId}`, {
        error: errorMessage,
    })
}

/** Embed one entry; returns null (and records the error) on failure. */
async function embedEntry(
    manager: VectorSearchManager,
    entry: JournalEntry,
    stats: RebuildStats
): Promise<{ entryId: number; embedding: Float32Array } | null> {
    try {
        const embedding = await manager.generateEmbedding(formatEntryForEmbedding(entry))
        return { entryId: entry.id, embedding }
    } catch (err) {
        recordEmbedError(entry.id, err, stats)
        return null
    }
}

function lookupExistingBatchVectorIds(
    dbAdapter: IDatabaseAdapter,
    batch: JournalEntry[],
    force: boolean,
    skipExistenceCheck: boolean,
    projectNumber: number | undefined
): ReadonlySet<number> | undefined {
    if (force || skipExistenceCheck) return undefined
    const adapterWithBatch = dbAdapter as IDatabaseAdapter & {
        getExistingVectorIds?: (entryIds: number[]) => Set<number>
    }
    if (typeof adapterWithBatch.getExistingVectorIds !== 'function') return undefined

    const candidateIds: number[] = []
    for (const entry of batch) {
        if (projectNumber === undefined || entry.projectNumber === projectNumber) {
            candidateIds.push(entry.id)
        }
    }
    if (candidateIds.length === 0) return undefined
    try {
        return adapterWithBatch.getExistingVectorIds(candidateIds)
    } catch (err) {
        logger.debug('Batch vector existence check failed; falling back to per-entry lookup', {
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

/** Embed and upsert one batch of entries, updating `stats`. */
async function processBatch(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    batch: JournalEntry[],
    force: boolean,
    skipExistenceCheck: boolean,
    projectNumber: number | undefined,
    stats: RebuildStats
): Promise<void> {
    const existingVectorIds = lookupExistingBatchVectorIds(
        dbAdapter,
        batch,
        force,
        skipExistenceCheck,
        projectNumber
    )
    const toEmbed: JournalEntry[] = []
    for (const entry of batch) {
        if (
            shouldSkipEntry(
                dbAdapter,
                entry,
                force,
                skipExistenceCheck,
                projectNumber,
                existingVectorIds
            )
        ) {
            stats.skipped++
            continue
        }
        toEmbed.push(entry)
    }
    if (toEmbed.length === 0) return

    const vectorsToUpsert: { entryId: number; embedding: Float32Array }[] = []
    const canBatchPipeline =
        toEmbed.length > 1 &&
        typeof manager.generateEmbeddingsSettled === 'function' &&
        typeof manager.hasCustomEmbeddingGenerator === 'function' &&
        !manager.hasCustomEmbeddingGenerator()

    if (canBatchPipeline) {
        const settled = await manager.generateEmbeddingsSettled(toEmbed.map(formatEntryForEmbedding))
        for (let idx = 0; idx < toEmbed.length; idx++) {
            const entry = toEmbed[idx]
            const outcome = settled[idx]
            if (!entry || !outcome) continue
            if (outcome.status === 'fulfilled') {
                vectorsToUpsert.push({ entryId: entry.id, embedding: outcome.value })
            } else {
                recordEmbedError(entry.id, outcome.reason, stats)
            }
        }
    } else {
        for (const entry of toEmbed) {
            const vector = await embedEntry(manager, entry, stats)
            if (vector !== null) vectorsToUpsert.push(vector)
        }
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

function cleanupStaleVectorsSafely(dbAdapter: IDatabaseAdapter): string | undefined {
    try {
        dbAdapter.cleanupStaleVectors()
        return undefined
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warning('Failed to cleanup stale vectors after rebuild', { error: err })
        return message
    }
}

async function runRebuildLoop(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    totalEntries: number,
    pageSize: number,
    batchSize: number,
    force: boolean,
    skipExistenceCheck: boolean,
    wsScope: string,
    projectNumber: number | undefined,
    progress: ProgressContext | undefined,
    stats: RebuildStats
): Promise<void> {
    let offset = 0
    while (offset < totalEntries) {
        const result = dbAdapter.getEntriesPage(offset, pageSize, wsScope, projectNumber)
        const entries = result.entries
        if (entries.length === 0) break

        // Process a page in smaller batches
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize)
            await processBatch(
                manager,
                dbAdapter,
                batch,
                force,
                skipExistenceCheck,
                projectNumber,
                stats
            )

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
    const wsScope = options?.workspaceId !== undefined ? effectiveWorkspace(options.workspaceId) : '*'

    const stats: RebuildStats = { indexed: 0, skipped: 0, errorsCount: 0, firstError: null }

    let totalEntries: number
    try {
        totalEntries = dbAdapter.getActiveEntryCount(wsScope, options?.projectNumber)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger.error('Failed to count entries for vector indexing', { error: err })
        return { success: false, indexed: 0, failed: 1, firstError: errorMessage }
    }

    if (totalEntries === 0) {
        const cleanupError = cleanupStaleVectorsSafely(dbAdapter)
        return {
            success: cleanupError === undefined,
            indexed: 0,
            failed: cleanupError === undefined ? 0 : 1,
            firstError: cleanupError ?? null,
            ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
        }
    }

    const skipExistenceCheck =
        !force && typeof dbAdapter.hasVectors === 'function' && !dbAdapter.hasVectors()

    await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild')
    await runRebuildLoop(
        manager,
        dbAdapter,
        totalEntries,
        pageSize,
        batchSize,
        force,
        skipExistenceCheck,
        wsScope,
        options?.projectNumber,
        progress,
        stats
    )

    const cleanupError = stats.errorsCount === 0 ? cleanupStaleVectorsSafely(dbAdapter) : undefined

    return {
        success: stats.errorsCount === 0 && cleanupError === undefined,
        indexed: stats.indexed,
        failed: stats.errorsCount + (cleanupError !== undefined ? 1 : 0),
        firstError: stats.firstError ?? cleanupError ?? null,
        ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
    }
}
