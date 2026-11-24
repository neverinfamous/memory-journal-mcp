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
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'

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
    let missingModelMetadata = false
    try {
        const existingDimStr = dbAdapter.getVectorMetadata('dimensions')
        const existingModel = dbAdapter.getVectorMetadata('model_name')
        if (existingDimStr) {
            const existingDim = parseCanonicalPositiveInt(existingDimStr)
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
            } else if (!existingModel || existingModel.trim() === '') {
                missingModelMetadata = true
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
        if (missingModelMetadata) {
            dbAdapter.setVectorMetadata('model_name', modelName)
        }
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
        const embedding = await manager.generateEmbedding(formatEntryForEmbedding(entry), {
            bypassQueryCache: true,
        })
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

/** Embed and upsert one batch of entries, updating `stats`. Returns true when embedding work ran. */
async function processBatch(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    batch: JournalEntry[],
    force: boolean,
    skipExistenceCheck: boolean,
    projectNumber: number | undefined,
    existingVectorIds: ReadonlySet<number> | undefined,
    stats: RebuildStats
): Promise<boolean> {
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
    if (toEmbed.length === 0) return false

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
        const vectors = await toEmbed.reduce<Promise<{ entryId: number; embedding: Float32Array }[]>>(
            async (accPromise, entry) => {
                const acc = await accPromise
                const vector = await embedEntry(manager, entry, stats)
                if (vector !== null) acc.push(vector)
                return acc
            },
            Promise.resolve([])
        )
        vectorsToUpsert.push(...vectors)
    }

    // Upsert the batch into the database, skipping entries deleted while embedding
    if (manager.isDisposed()) return false
    const liveVectors = manager.filterLiveVectors(vectorsToUpsert)
    if (liveVectors.length === 0) return true
    try {
        dbAdapter.upsertVectors(liveVectors)
        stats.indexed += liveVectors.length
    } catch (err) {
        stats.errorsCount += liveVectors.length
        const errorMessage = err instanceof Error ? err.message : String(err)
        stats.firstError ??= errorMessage
        logger.error('Failed to upsert vector batch', {
            error: errorMessage,
            batchSize: liveVectors.length,
        })
    }
    return true
}

function cleanupStaleVectorsSafely(dbAdapter: IDatabaseAdapter): string | undefined {
    if (typeof dbAdapter.cleanupStaleVectors !== 'function') return undefined
    try {
        dbAdapter.cleanupStaleVectors()
        return undefined
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warning('Failed to cleanup stale vectors after rebuild', { error: err })
        return message
    }
}

interface RebuildLoopContext {
    manager: VectorSearchManager
    dbAdapter: IDatabaseAdapter
    totalEntries: number
    pageSize: number
    batchSize: number
    force: boolean
    skipExistenceCheck: boolean
    wsScope: string
    projectNumber: number | undefined
    progress: ProgressContext | undefined
    stats: RebuildStats
    useKeyset: boolean
}

async function processPageBatchesSequentially(
    ctx: RebuildLoopContext,
    entries: JournalEntry[],
    pageExistingVectorIds: ReadonlySet<number> | undefined,
    offset: number,
    batchOffset: number,
    anyEmbedded = false
): Promise<boolean> {
    if (batchOffset >= entries.length) return anyEmbedded
    const batch = entries.slice(batchOffset, batchOffset + ctx.batchSize)
    const didEmbed = await processBatch(
        ctx.manager,
        ctx.dbAdapter,
        batch,
        ctx.force,
        ctx.skipExistenceCheck,
        ctx.projectNumber,
        pageExistingVectorIds,
        ctx.stats
    )
    if (didEmbed) {
        await new Promise((resolve) => setTimeoutFn(resolve, 0))
    }
    await sendProgress(
        ctx.progress,
        offset + batchOffset + batch.length,
        ctx.totalEntries,
        `Indexing... (${ctx.stats.indexed} indexed, ${ctx.stats.skipped} skipped)`
    )
    return processPageBatchesSequentially(
        ctx,
        entries,
        pageExistingVectorIds,
        offset,
        batchOffset + ctx.batchSize,
        anyEmbedded || didEmbed
    )
}

async function runRebuildPagesSequentially(
    ctx: RebuildLoopContext,
    offset: number,
    cursor: { timestamp: string; id: number } | undefined
): Promise<void> {
    if (offset >= ctx.totalEntries) return
    const entries = ctx.useKeyset
        ? ctx.dbAdapter.getEntriesAfter?.(ctx.pageSize, ctx.wsScope, ctx.projectNumber, cursor) ?? []
        : ctx.dbAdapter.getEntriesPage(offset, ctx.pageSize, ctx.wsScope, ctx.projectNumber).entries
    if (entries.length === 0) return

    const pageExistingVectorIds = lookupExistingBatchVectorIds(
        ctx.dbAdapter,
        entries,
        ctx.force,
        ctx.skipExistenceCheck,
        ctx.projectNumber
    )
    const pageEmbedded = await processPageBatchesSequentially(
        ctx,
        entries,
        pageExistingVectorIds,
        offset,
        0
    )
    if (!pageEmbedded) {
        await new Promise((resolve) => setTimeoutFn(resolve, 0))
    }

    let nextCursor = cursor
    if (ctx.useKeyset) {
        if (entries.length < ctx.pageSize) return
        const last = entries[entries.length - 1]
        if (last === undefined) return
        nextCursor = { timestamp: last.timestamp, id: last.id }
    }
    return runRebuildPagesSequentially(ctx, offset + ctx.pageSize, nextCursor)
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
    await runRebuildPagesSequentially(
        {
            manager,
            dbAdapter,
            totalEntries,
            pageSize,
            batchSize,
            force,
            skipExistenceCheck,
            wsScope,
            projectNumber,
            progress,
            stats,
            useKeyset: typeof dbAdapter.getEntriesAfter === 'function',
        },
        0,
        undefined
    )
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
    const rawBatch = options?.batchSize
    const batchSize =
        typeof rawBatch === 'number' && Number.isFinite(rawBatch) && rawBatch >= 1
            ? Math.floor(rawBatch)
            : REBUILD_BATCH_SIZE
    const rawPage = options?.pageSize
    const pageSize =
        typeof rawPage === 'number' && Number.isFinite(rawPage) && rawPage >= 1
            ? Math.floor(rawPage)
            : REBUILD_PAGE_SIZE
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

    const cleanupError = !manager.isDisposed() ? cleanupStaleVectorsSafely(dbAdapter) : undefined

    return {
        success: stats.errorsCount === 0 && cleanupError === undefined,
        indexed: stats.indexed,
        failed: stats.errorsCount + (cleanupError !== undefined ? 1 : 0),
        firstError: stats.firstError ?? cleanupError ?? null,
        ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
    }
}
