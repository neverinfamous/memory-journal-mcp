import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { logger } from '../../utils/logger.js'
import { REBUILD_BATCH_SIZE, REBUILD_PAGE_SIZE } from './types.js'
import type { VectorSearchManager } from './manager.js'
import { formatEntryForEmbedding } from './candidate-search.js'
import { effectiveWorkspace } from '../../database/workspace-scope.js'
import { DISPOSED_MANAGER_ERROR, verifyVecTableSchema } from './lifecycle-helpers.js'

export { verifyVecTableSchema }

// Allow mocking in tests
export const setTimeoutFn = globalThis.setTimeout

function isManagerDisposed(manager: VectorSearchManager): boolean {
    return typeof manager.isDisposed === 'function' && manager.isDisposed()
}

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
    if (isManagerDisposed(manager)) return null
    try {
        const embedding = await manager.generateEmbedding(formatEntryForEmbedding(entry), {
            bypassQueryCache: true,
        })
        return { entryId: entry.id, embedding }
    } catch (err) {
        if (isManagerDisposed(manager)) return null
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

async function generateBatchVectors(
    manager: VectorSearchManager,
    toEmbed: JournalEntry[],
    stats: RebuildStats
): Promise<{ entryId: number; embedding: Float32Array }[] | null> {
    const canBatchPipeline =
        toEmbed.length > 1 &&
        typeof manager.generateEmbeddingsSettled === 'function' &&
        typeof manager.hasCustomEmbeddingGenerator === 'function' &&
        !manager.hasCustomEmbeddingGenerator()

    if (!canBatchPipeline) {
        return await toEmbed.reduce<Promise<{ entryId: number; embedding: Float32Array }[]>>(
            async (accPromise, entry) => {
                const acc = await accPromise
                if (isManagerDisposed(manager)) return acc
                const vector = await embedEntry(manager, entry, stats)
                if (vector !== null) acc.push(vector)
                return acc
            },
            Promise.resolve([])
        )
    }

    let settled: PromiseSettledResult<Float32Array>[]
    try {
        settled = await manager.generateEmbeddingsSettled(toEmbed.map(formatEntryForEmbedding))
    } catch (err) {
        if (isManagerDisposed(manager)) return null
        throw err
    }
    if (isManagerDisposed(manager)) return null
    const vectorsToUpsert: { entryId: number; embedding: Float32Array }[] = []
    for (let idx = 0; idx < toEmbed.length; idx++) {
        const entry = toEmbed[idx]
        const outcome = settled[idx]
        if (!entry || !outcome) continue
        if (outcome.status === 'fulfilled') {
            vectorsToUpsert.push({ entryId: entry.id, embedding: outcome.value })
        } else if (!isManagerDisposed(manager)) {
            recordEmbedError(entry.id, outcome.reason, stats)
        }
    }
    return vectorsToUpsert
}

/** Embed and upsert one pre-filtered batch of entries, updating `stats`. Returns true when embedding work ran. */
async function processBatch(
    manager: VectorSearchManager,
    dbAdapter: IDatabaseAdapter,
    toEmbed: JournalEntry[],
    stats: RebuildStats
): Promise<boolean> {
    if (isManagerDisposed(manager) || toEmbed.length === 0) return false

    const vectorsToUpsert = await generateBatchVectors(manager, toEmbed, stats)
    if (vectorsToUpsert === null || isManagerDisposed(manager)) return false

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

function filterPageEntriesToEmbed(
    entries: JournalEntry[],
    dbAdapter: IDatabaseAdapter,
    force: boolean,
    skipExistenceCheck: boolean,
    projectNumber: number | undefined,
    pageExistingVectorIds: ReadonlySet<number> | undefined,
    stats: RebuildStats
): JournalEntry[] {
    const toEmbed: JournalEntry[] = []
    for (const entry of entries) {
        if (shouldSkipEntry(dbAdapter, entry, force, skipExistenceCheck, projectNumber, pageExistingVectorIds)) {
            stats.skipped++
            continue
        }
        toEmbed.push(entry)
    }
    return toEmbed
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
    toEmbed: JournalEntry[],
    pageEntryCount: number,
    offset: number,
    batchOffset: number,
    anyEmbedded = false
): Promise<boolean> {
    if (batchOffset >= toEmbed.length || isManagerDisposed(ctx.manager)) return anyEmbedded
    const batch = toEmbed.slice(batchOffset, batchOffset + ctx.batchSize)
    const didEmbed = await processBatch(ctx.manager, ctx.dbAdapter, batch, ctx.stats)
    if (isManagerDisposed(ctx.manager)) return anyEmbedded || didEmbed
    if (didEmbed) await new Promise((resolve) => setTimeoutFn(resolve, 0))
    const processedInPage = Math.min(pageEntryCount, Math.round(((batchOffset + batch.length) / toEmbed.length) * pageEntryCount))
    await sendProgress(
        ctx.progress,
        offset + processedInPage,
        ctx.totalEntries,
        `Indexing... (${ctx.stats.indexed} indexed, ${ctx.stats.skipped} skipped)`
    )
    return processPageBatchesSequentially(ctx, toEmbed, pageEntryCount, offset, batchOffset + ctx.batchSize, anyEmbedded || didEmbed)
}

async function runRebuildPagesSequentially(
    ctx: RebuildLoopContext,
    offset: number,
    cursor: { timestamp: string; id: number } | undefined
): Promise<void> {
    if (offset >= ctx.totalEntries || isManagerDisposed(ctx.manager)) return
    const entries = ctx.useKeyset
        ? ctx.dbAdapter.getEntriesAfter?.(ctx.pageSize, ctx.wsScope, ctx.projectNumber, cursor) ?? []
        : ctx.dbAdapter.getEntriesPage(offset, ctx.pageSize, ctx.wsScope, ctx.projectNumber).entries
    if (entries.length === 0) return

    const pageExistingVectorIds = lookupExistingBatchVectorIds(ctx.dbAdapter, entries, ctx.force, ctx.skipExistenceCheck, ctx.projectNumber)
    const toEmbed = filterPageEntriesToEmbed(entries, ctx.dbAdapter, ctx.force, ctx.skipExistenceCheck, ctx.projectNumber, pageExistingVectorIds, ctx.stats)
    let pageEmbedded = false
    if (toEmbed.length === 0) {
        await sendProgress(ctx.progress, offset + entries.length, ctx.totalEntries, `Indexing... (${ctx.stats.indexed} indexed, ${ctx.stats.skipped} skipped)`)
    } else {
        pageEmbedded = await processPageBatchesSequentially(ctx, toEmbed, entries.length, offset, 0)
    }
    if (isManagerDisposed(ctx.manager)) return
    if (!pageEmbedded) await new Promise((resolve) => setTimeoutFn(resolve, 0))

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

interface ParsedRebuildOptions {
    force: boolean
    batchSize: number
    pageSize: number
    wsScope: string
    projectNumber: number | undefined
}

function parseRebuildOptions(options?: {
    force?: boolean
    batchSize?: number
    pageSize?: number
    projectNumber?: number
    workspaceId?: string
}): ParsedRebuildOptions {
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
    return { force: options?.force ?? false, batchSize, pageSize, wsScope, projectNumber: options?.projectNumber }
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
    if (isManagerDisposed(manager)) {
        return { success: false, indexed: 0, failed: 0, firstError: DISPOSED_MANAGER_ERROR }
    }
    const { force, batchSize, pageSize, wsScope, projectNumber } = parseRebuildOptions(options)
    const stats: RebuildStats = { indexed: 0, skipped: 0, errorsCount: 0, firstError: null }

    let totalEntries: number
    try {
        totalEntries = dbAdapter.getActiveEntryCount(wsScope, projectNumber)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger.error('Failed to count entries for vector indexing', { error: err })
        return { success: false, indexed: 0, failed: 1, firstError: errorMessage }
    }

    if (totalEntries === 0) {
        const cleanupError = !isManagerDisposed(manager) ? cleanupStaleVectorsSafely(dbAdapter) : undefined
        return {
            success: cleanupError === undefined,
            indexed: 0,
            failed: cleanupError === undefined ? 0 : 1,
            firstError: cleanupError ?? null,
            ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
        }
    }

    const skipExistenceCheck = !force && typeof dbAdapter.hasVectors === 'function' && !dbAdapter.hasVectors()

    await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild')
    await runRebuildLoop(
        manager, dbAdapter, totalEntries, pageSize, batchSize,
        force, skipExistenceCheck, wsScope, projectNumber, progress, stats
    )

    if (isManagerDisposed(manager)) {
        return {
            success: false,
            indexed: stats.indexed,
            failed: stats.errorsCount,
            firstError: stats.firstError ?? DISPOSED_MANAGER_ERROR,
        }
    }

    const cleanupError = cleanupStaleVectorsSafely(dbAdapter)

    return {
        success: stats.errorsCount === 0 && cleanupError === undefined,
        indexed: stats.indexed,
        failed: stats.errorsCount + (cleanupError !== undefined ? 1 : 0),
        firstError: stats.firstError ?? cleanupError ?? null,
        ...(cleanupError !== undefined ? { warning: cleanupError } : {}),
    }
}
