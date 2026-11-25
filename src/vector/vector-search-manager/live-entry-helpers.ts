/**
 * Live-entry SQLite existence checks, tombstone removal flushes, and embedding validation
 * helpers extracted from `lifecycle-helpers.ts`.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { logger } from '../../utils/logger.js'
import { getOrComputeCachedEmbedding, QUERY_EMBEDDING_CACHE_MAX_CHARS } from './embedding-cache.js'
import { invokeSingleEmbeddingPipeline } from './model-cache.js'

export const DISPOSED_MANAGER_ERROR = 'VectorSearchManager has been disposed'

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
 * Prefers PK-only `hasActiveEntry` when available; falls back to `getEntryById` for mocks.
 */
export function isEntryLiveForVectorUpsert(
    dbAdapter: IDatabaseAdapter,
    entryId: number,
    pendingRemovedIds: ReadonlySet<number>
): boolean {
    if (pendingRemovedIds.has(entryId)) return false
    if (typeof dbAdapter.hasActiveEntry === 'function') {
        return dbAdapter.hasActiveEntry(entryId)
    }
    if (typeof dbAdapter.getEntryById === 'function') {
        return dbAdapter.getEntryById(entryId, '*') !== null
    }
    return true
}

/**
 * Filter a batch of computed vectors against concurrent tombstones and live SQLite rows
 * using PK-only `getActiveEntryIds` when available (falling back to `getEntriesByIds`/`getEntryById`).
 */
export function filterLiveVectorsForUpsert(
    dbAdapter: IDatabaseAdapter,
    items: readonly { entryId: number; embedding: Float32Array }[],
    pendingRemovedIds: ReadonlySet<number>
): { entryId: number; embedding: Float32Array }[] {
    const remaining = items.filter((item) => !pendingRemovedIds.has(item.entryId))
    if (remaining.length === 0) return []
    if (typeof dbAdapter.getActiveEntryIds === 'function') {
        const activeIds = dbAdapter.getActiveEntryIds(remaining.map((item) => item.entryId))
        return remaining.filter((item) => activeIds.has(item.entryId))
    }
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
    if (raw.length !== dims) {
        throw new Error(
            `Embedding dimension mismatch: expected ${String(dims)}, got ${String(raw.length)}`
        )
    }
    return raw
}
