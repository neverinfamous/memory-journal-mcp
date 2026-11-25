/**
 * Model load serialization and native ONNX pipeline disposal helpers for `VectorSearchManager`.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import { logger } from '../../utils/logger.js'
import { isRecord } from '../../utils/type-guards.js'
import { isMissingTableError } from '../../database/sqlite-adapter/schema-errors.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import {
    embedTextsSequentiallySettled,
    formatEntryForEmbedding,
    runPipelineBatchEmbeddingsSettled,
    upsertEntryChunksSequentially,
} from './candidate-search.js'
import { getOrComputeCachedEmbedding, QUERY_EMBEDDING_CACHE_MAX_CHARS } from './embedding-cache.js'
import {
    invokeSingleEmbeddingPipeline,
    isModelCachedOnDisk,
    isTransientFileLockError,
    loadTransformersModule,
    MODEL_LOAD_RETRY_DELAY_MS,
    resolveEmbeddingCacheDir,
    dbPathFromAdapter,
    type TransformersPipelineModule,
} from './model-cache.js'
import { REBUILD_BATCH_SIZE } from './types.js'

export const DISPOSED_MANAGER_ERROR = 'VectorSearchManager has been disposed'

let modelLoadMutex: Promise<void> = Promise.resolve()

/** Serialize ONNX model loading across `VectorSearchManager` instances. */
export function withModelLoadLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = modelLoadMutex.then(fn, fn)
    modelLoadMutex = next.then(
        () => undefined,
        () => undefined
    )
    return next
}

/** Retry pipeline construction across transient Windows ONNX cache-lock errors. */
export async function loadPipelineWithRetry(
    transformersModule: TransformersPipelineModule,
    modelName: string,
    cacheDir: string,
    cachedLocally: boolean,
    attempt = 1,
    maxAttempts = 5
): Promise<unknown> {
    try {
        if (attempt > 1 && (cachedLocally || isModelCachedOnDisk(cacheDir, modelName))) {
            transformersModule.env['allowRemoteModels'] = false
        }
        return await transformersModule.pipeline('feature-extraction', modelName, {
            dtype: 'fp32',
        })
    } catch (pipelineErr) {
        if (attempt < maxAttempts && isTransientFileLockError(pipelineErr)) {
            transformersModule.env['allowRemoteModels'] = true
            await new Promise((r) => setTimeout(r, MODEL_LOAD_RETRY_DELAY_MS * attempt))
            return loadPipelineWithRetry(
                transformersModule,
                modelName,
                cacheDir,
                cachedLocally,
                attempt + 1,
                maxAttempts
            )
        }
        throw pipelineErr
    }
}

/** Flush queued entry deletions that occurred while a vector rebuild was running. */
export function flushPendingVectorRemovals(
    dbAdapter: IDatabaseAdapter,
    pendingRemovedIds: Set<number>
): void {
    if (pendingRemovedIds.size === 0) return
    const ids = [...pendingRemovedIds]
    pendingRemovedIds.clear()
    for (const id of ids) {
        try {
            dbAdapter.deleteVector(id)
        } catch (error) {
            logger.warning(`Failed to remove entry ${id} from vector index post-rebuild`, { error })
        }
    }
}

/** Validate vector dimensionality and finiteness. */
export function validateEmbeddingVector(candidate: Float32Array, dims: number): Float32Array {
    if (candidate.length !== dims) {
        throw new Error(
            `Embedding dimension mismatch: expected ${String(dims)}, got ${String(candidate.length)}`
        )
    }
    for (const el of candidate) {
        if (!Number.isFinite(el)) {
            throw new Error('Generated embedding contains non-finite value')
        }
    }
    return candidate
}

/**
 * Check whether an entry still exists in SQLite and was not removed concurrently.
 * Bare mock adapters without `getEntryById` (or returning `undefined`) remain allowed.
 */
export function isEntryLiveForVectorUpsert(
    dbAdapter: IDatabaseAdapter,
    entryId: number,
    pendingRemovedIds: ReadonlySet<number>
): boolean {
    if (pendingRemovedIds.has(entryId)) return false
    if (typeof dbAdapter.getEntryById === 'function') {
        return dbAdapter.getEntryById(entryId, '*') !== null
    }
    return true
}

/**
 * Filter a batch of computed vectors against concurrent tombstones and live SQLite rows
 * in a single batched `getEntriesByIds` lookup whenever supported.
 */
export function filterLiveVectorsForUpsert(
    dbAdapter: IDatabaseAdapter,
    items: readonly { entryId: number; embedding: Float32Array }[],
    pendingRemovedIds: ReadonlySet<number>
): { entryId: number; embedding: Float32Array }[] {
    const remaining = items.filter((item) => !pendingRemovedIds.has(item.entryId))
    if (remaining.length === 0) return []
    if (typeof dbAdapter.getEntriesByIds === 'function') {
        const liveMap: unknown = dbAdapter.getEntriesByIds(
            remaining.map((item) => item.entryId),
            '*'
        )
        if (liveMap instanceof Map) {
            return remaining.filter((item) => liveMap.has(item.entryId))
        }
    }
    if (typeof dbAdapter.getEntryById === 'function') {
        return remaining.filter((item) => dbAdapter.getEntryById(item.entryId, '*') !== null)
    }
    return remaining
}

/** Load the default transformers embedding pipeline and measure dimensions. */
export async function loadDefaultEmbeddingSession(
    dbAdapter: IDatabaseAdapter,
    modelName: string,
    existingTransformers: TransformersPipelineModule | null,
    onTransformersLoaded: (mod: TransformersPipelineModule) => void,
    onPipelineLoaded: (pipeline: unknown) => void
): Promise<number> {
    const cacheDir = resolveEmbeddingCacheDir(dbPathFromAdapter(dbAdapter))
    const transformersModule = existingTransformers ?? (await loadTransformersModule())
    onTransformersLoaded(transformersModule)
    const cachedLocally = isModelCachedOnDisk(cacheDir, modelName)
    transformersModule.env['allowRemoteModels'] = !cachedLocally
    transformersModule.env['cacheDir'] = cacheDir
    transformersModule.env['localModelPath'] = cacheDir

    logger.info(`Loading embedding model: ${modelName}`)
    const pipeline = await loadPipelineWithRetry(transformersModule, modelName, cacheDir, cachedLocally)
    onPipelineLoaded(pipeline)
    logger.info('Embedding model loaded')

    const testVec = await invokeSingleEmbeddingPipeline(pipeline, 'test')
    logger.info(`Detected ${testVec.length} dimensions for ${modelName}`)
    return testVec.length
}

/** Upsert a single entry embedding with post-await disposal and tombstone guards. */
export async function runAddSingleVectorEntry(opts: {
    entry: JournalEntry
    dbAdapter: IDatabaseAdapter
    pendingRemovedIds: ReadonlySet<number>
    isDisposed: () => boolean
    initialize: () => Promise<void>
    generateEmbedding: (text: string) => Promise<Float32Array>
}): Promise<void> {
    await opts.initialize()
    try {
        const embedding = await opts.generateEmbedding(formatEntryForEmbedding(opts.entry))
        if (
            opts.isDisposed() ||
            !isEntryLiveForVectorUpsert(opts.dbAdapter, opts.entry.id, opts.pendingRemovedIds)
        ) {
            return
        }
        opts.dbAdapter.upsertVector(opts.entry.id, embedding)
    } catch (error) {
        logger.error(`Failed to add entry ${opts.entry.id} to vector index`, {
            error: error instanceof Error ? error.message : String(error),
        })
        throw error
    }
}

/** Batch-embed and upsert entries in bounded chunks with disposal/tombstone guards. */
export async function runAddBatchVectorEntries(opts: {
    entries: readonly JournalEntry[]
    dbAdapter: IDatabaseAdapter
    pendingRemovedIds: ReadonlySet<number>
    isDisposed: () => boolean
    initialize: () => Promise<void>
    generateEmbeddingsSettled: (texts: readonly string[]) => Promise<PromiseSettledResult<Float32Array>[]>
}): Promise<void> {
    await opts.initialize()
    await upsertEntryChunksSequentially(
        opts.entries,
        REBUILD_BATCH_SIZE,
        (texts) => opts.generateEmbeddingsSettled(texts),
        typeof opts.dbAdapter.upsertVectors === 'function'
            ? (items) => {
                  if (opts.isDisposed()) return
                  const liveItems = filterLiveVectorsForUpsert(
                      opts.dbAdapter,
                      items,
                      opts.pendingRemovedIds
                  )
                  if (liveItems.length > 0 && !opts.isDisposed()) {
                      opts.dbAdapter.upsertVectors(liveItems)
                  }
              }
            : undefined,
        (entryId, embedding) => {
            if (
                !opts.isDisposed() &&
                isEntryLiveForVectorUpsert(opts.dbAdapter, entryId, opts.pendingRemovedIds)
            ) {
                opts.dbAdapter.upsertVector(entryId, embedding)
            }
        },
        opts.isDisposed
    )
}

type VectorPendingSnapshot = () => {
    init: Promise<void> | null
    tail: Promise<void>
    reads: Promise<unknown>[]
    isUnchanged: (init: Promise<void> | null, tail: Promise<void>) => boolean
}

async function runBoundedDrainPass(
    snapshot: VectorPendingSnapshot,
    deadline: number | undefined
): Promise<void> {
    const { init, tail, reads, isUnchanged } = snapshot()
    const pending = Promise.allSettled([...(init !== null ? [init] : []), tail, ...reads])
    if (deadline === undefined) {
        await pending
    } else {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
            logger.debug('Timed out draining vector search manager pending state')
            return
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        let timedOut = false
        try {
            await Promise.race([
                pending,
                new Promise<void>((resolve) => {
                    timer = setTimeout(() => {
                        timedOut = true
                        resolve()
                    }, remaining)
                    timer.unref()
                }),
            ])
        } finally {
            if (timer !== undefined) clearTimeout(timer)
        }
        if (timedOut) {
            logger.debug('Timed out draining vector search manager pending state')
            return
        }
    }
    if (!isUnchanged(init, tail)) {
        await runBoundedDrainPass(snapshot, deadline)
    }
}

/** Drain in-flight init, mutation tail, and active read promises until quiescent or timed out. */
export async function drainVectorPendingState(
    snapshot: VectorPendingSnapshot,
    timeoutMs?: number
): Promise<void> {
    const hasDeadline = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    const deadline = hasDeadline ? Date.now() + timeoutMs : undefined
    await runBoundedDrainPass(snapshot, deadline)
}

/** Generate and validate a single embedding using optional query cache or HF pipeline. */
export async function generateValidatedSingleEmbedding(opts: {
    text: string
    modelName: string
    bypassQueryCache: boolean
    hasCustomGenerator: boolean
    hasTransformers: boolean
    initialize: () => Promise<void>
    getDimensions: () => number | null
    getPipeline: () => unknown
    isDisposed: () => boolean
}): Promise<Float32Array> {
    await opts.initialize()
    if (opts.isDisposed()) throw new Error(DISPOSED_MANAGER_ERROR)
    const dims = opts.getDimensions()
    if (dims === null || dims <= 0) {
        throw new Error('Vector search not initialized properly. Cannot rebuild index.')
    }
    const canCache =
        !opts.bypassQueryCache &&
        !opts.hasCustomGenerator &&
        opts.hasTransformers &&
        opts.text.length <= QUERY_EMBEDDING_CACHE_MAX_CHARS
    const raw = await getOrComputeCachedEmbedding(opts.modelName, opts.text, canCache, async () => {
        const pipeline = opts.getPipeline()
        if (opts.isDisposed() || pipeline === null) throw new Error(DISPOSED_MANAGER_ERROR)
        return validateEmbeddingVector(await invokeSingleEmbeddingPipeline(pipeline, opts.text), dims)
    })
    return validateEmbeddingVector(raw, dims)
}

/** Generate settled per-item embeddings for a batch of texts, using tensor batching when available. */
export async function generateValidatedBatchEmbeddingsSettled(opts: {
    texts: readonly string[]
    hasCustomGenerator: boolean
    initialize: () => Promise<void>
    getDimensions: () => number | null
    getPipeline: () => unknown
    isDisposed: () => boolean
    generateSingle: (text: string) => Promise<Float32Array>
}): Promise<PromiseSettledResult<Float32Array>[]> {
    await opts.initialize()
    if (opts.isDisposed()) throw new Error(DISPOSED_MANAGER_ERROR)
    const dims = opts.getDimensions()
    if (dims === null) {
        throw new Error('Vector search not initialized properly. Cannot rebuild index.')
    }
    if (opts.hasCustomGenerator) {
        return embedTextsSequentiallySettled(opts.texts, 0, opts.generateSingle)
    }
    return runPipelineBatchEmbeddingsSettled(opts.getPipeline(), opts.texts, dims, opts.generateSingle)
}

/** Track an active read/embedding promise synchronously for graceful `dispose()` draining. */
export function trackVectorRead<T>(
    activeReads: Set<Promise<unknown>>,
    isDisposed: () => boolean,
    fn: () => Promise<T>
): Promise<T> {
    if (isDisposed()) {
        return Promise.reject(new Error(DISPOSED_MANAGER_ERROR))
    }
    const run = async (): Promise<T> => {
        await Promise.resolve()
        try {
            if (isDisposed()) {
                throw new Error(DISPOSED_MANAGER_ERROR)
            }
            return await fn()
        } finally {
            activeReads.delete(settlePromise)
        }
    }
    const settlePromise = run()
    activeReads.add(settlePromise)
    return settlePromise
}

/** Dispose a loaded transformers pipeline session if it exposes a `dispose()` method. */
export async function disposePipelineHandle(pipeline: unknown): Promise<void> {
    if (!isRecord(pipeline) && typeof pipeline !== 'function') return
    const maybeDispose: unknown = Reflect.get(pipeline, 'dispose')
    if (typeof maybeDispose !== 'function') return
    try {
        const result: unknown = Reflect.apply(maybeDispose, pipeline, [])
        await result
    } catch (error: unknown) {
        logger.debug('Failed to dispose vector pipeline session', {
            error: error instanceof Error ? error.message : String(error),
        })
    }
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
