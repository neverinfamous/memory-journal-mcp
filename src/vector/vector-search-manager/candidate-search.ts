import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { SemanticSearchResult } from './types.js'
import { logger } from '../../utils/logger.js'
import { isRecord } from '../../utils/type-guards.js'
import { asNumberArrayLike, isCallable } from './model-cache.js'

export interface VectorCandidate {
    entryId: number
    distance: number
    similarityScore: number
}

/** Build the embedding text representation for a journal entry (type + tags + content). */
export function formatEntryForEmbedding(entry: JournalEntry): string {
    const tagsText =
        entry.tags !== undefined && entry.tags !== null && entry.tags.length > 0
            ? ` [Tags: ${entry.tags.join(', ')}]`
            : ''
    return `[${entry.entryType}]${tagsText} ${entry.content}`
}

function sliceBatchTensor(
    batchOut: { data?: ArrayLike<number>; dims?: number[] },
    count: number,
    dimensions: number
): Float32Array[] | undefined {
    const { data, dims } = batchOut
    if (
        data === undefined ||
        dims?.length !== 2 ||
        dims[0] !== count ||
        dims[1] !== dimensions ||
        data.length !== count * dimensions
    ) {
        return undefined
    }
    const vectors: Float32Array[] = []
    const isFloat32 = data instanceof Float32Array
    for (let i = 0; i < count; i++) {
        const start = i * dimensions
        const end = start + dimensions
        for (let j = start; j < end; j++) {
            if (!Number.isFinite(data[j])) return undefined
        }
        if (isFloat32) {
            vectors.push(data.slice(start, end))
            continue
        }
        const slice = new Float32Array(dimensions)
        for (let j = 0; j < dimensions; j++) {
            slice[j] = data[start + j] ?? 0
        }
        vectors.push(slice)
    }
    return vectors
}

async function embedSingleSettled(
    text: string,
    fallbackSingle: (text: string) => Promise<Float32Array>
): Promise<PromiseSettledResult<Float32Array>> {
    try {
        return { status: 'fulfilled', value: await fallbackSingle(text) }
    } catch (reason) {
        return { status: 'rejected', reason }
    }
}

export async function embedTextsSequentiallySettled(
    texts: readonly string[],
    startIndex: number,
    fallbackSingle: (text: string) => Promise<Float32Array>,
    results: PromiseSettledResult<Float32Array>[] = []
): Promise<PromiseSettledResult<Float32Array>[]> {
    if (startIndex >= texts.length) return results
    const text = texts[startIndex]
    if (text !== undefined) {
        results.push(await embedSingleSettled(text, fallbackSingle))
    }
    return embedTextsSequentiallySettled(texts, startIndex + 1, fallbackSingle, results)
}

function extractBatchTensorOutput(rawOut: unknown): {
    data?: ArrayLike<number>
    dims?: number[]
} {
    if (!isRecord(rawOut)) return {}
    const data = asNumberArrayLike(rawOut['data'])
    const rawDims = rawOut['dims']
    const dims =
        Array.isArray(rawDims) && rawDims.every((d): d is number => typeof d === 'number')
            ? rawDims
            : undefined
    return {
        ...(data !== undefined ? { data } : {}),
        ...(dims !== undefined ? { dims } : {}),
    }
}

/** Batch-extract per-entry settled embeddings from a pipeline function using 2D [N, D] tensor batching when available. */
export async function runPipelineBatchEmbeddingsSettled(
    pipeline: unknown,
    texts: readonly string[],
    dimensions: number,
    fallbackSingle: (text: string) => Promise<Float32Array>
): Promise<PromiseSettledResult<Float32Array>[]> {
    if (texts.length === 0) return []
    if (texts.length > 1 && isCallable(pipeline)) {
        const results: PromiseSettledResult<Float32Array>[] = []
        let startIndex = 0
        try {
            const rawOut: unknown = await Promise.resolve(
                pipeline([...texts], { pooling: 'mean', normalize: true })
            )
            const batchOut = extractBatchTensorOutput(rawOut)
            const vectors = sliceBatchTensor(batchOut, texts.length, dimensions)
            if (vectors !== undefined) {
                return vectors.map((value) => ({ status: 'fulfilled', value }))
            }
            if (batchOut.data?.length === dimensions) {
                const slice = new Float32Array(batchOut.data)
                if (slice.every((v) => Number.isFinite(v))) {
                    results.push({ status: 'fulfilled', value: slice })
                    startIndex = 1
                }
            }
        } catch (reason) {
            logger.warning('Batch embedding failed; embedding each text separately', {
                module: 'VectorSearchManager',
                error: reason instanceof Error ? reason.message : String(reason),
            })
        }
        return embedTextsSequentiallySettled(texts, startIndex, fallbackSingle, results)
    }
    return embedTextsSequentiallySettled(texts, 0, fallbackSingle)
}

/**
 * Convert raw sqlite-vec hits into scored candidates above `threshold`,
 * optionally skipping `excludeId` (the query entry itself).
 */
export function collectCandidates(
    results: { entry_id: number; distance: number }[],
    threshold: number,
    excludeId?: number
): VectorCandidate[] {
    const candidates: VectorCandidate[] = []
    for (const result of results) {
        if (excludeId !== undefined && result.entry_id === excludeId) continue
        // sqlite-vec MATCH computes L2 distance by default.
        // For normalized unit vectors: L2_distance^2 = 2 - 2 * cosine_similarity
        // Therefore: cosine_similarity = 1 - (L2_distance^2 / 2)
        const similarityScore = Math.max(-1, 1 - (result.distance * result.distance) / 2)
        if (similarityScore >= threshold) {
            candidates.push({
                entryId: result.entry_id,
                distance: result.distance,
                similarityScore,
            })
        }
    }
    return candidates
}

/**
 * Hydrate vector-search candidates into entries (workspace- and project-filtered), capped at `limit`.
 */
export function resolveCandidates(
    dbAdapter: IDatabaseAdapter,
    candidates: VectorCandidate[],
    limit: number,
    targetWs: string,
    projectNumber?: number
): SemanticSearchResult[] {
    if (candidates.length === 0 || limit <= 0) {
        return []
    }

    const entriesMap =
        typeof (dbAdapter as { getEntriesByIds?: unknown }).getEntriesByIds === 'function'
            ? dbAdapter.getEntriesByIds(
                  candidates.map((c) => c.entryId),
                  targetWs
              )
            : null

    const searchResults: SemanticSearchResult[] = []
    for (const candidate of candidates) {
        const entry = entriesMap
            ? (entriesMap.get(candidate.entryId) ?? null)
            : dbAdapter.getEntryById(candidate.entryId, targetWs)
        if (
            entry &&
            (targetWs === '*' || (entry.workspaceId ?? 'default') === targetWs) &&
            (projectNumber === undefined || entry.projectNumber === projectNumber)
        ) {
            searchResults.push({
                entryId: candidate.entryId,
                entry,
                distance: candidate.distance,
                score: candidate.similarityScore,
                similarityScore: candidate.similarityScore,
            })
        }
        if (searchResults.length >= limit) break
    }

    return searchResults
}

/**
 * Execute similarity lookup for an existing entry ID, backfilling its vector if absent.
 */
export async function searchSimilarEntriesById(
    dbAdapter: IDatabaseAdapter,
    generateEmbedding: (text: string) => Promise<Float32Array>,
    entryId: number,
    limit: number,
    threshold: number,
    targetWs: string,
    projectNumber?: number,
    prefetchedEntry?: JournalEntry,
    expectedDimensions?: number
): Promise<SemanticSearchResult[]> {
    if (!Number.isSafeInteger(entryId) || entryId <= 0) {
        throw new Error(`Entry ${String(entryId)} not found`)
    }
    if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isFinite(threshold)) {
        return []
    }
    const safeLimit = Math.min(limit, 10_000)
    const sourceEntry =
        prefetchedEntry?.id === entryId
            ? prefetchedEntry
            : dbAdapter.getEntryById(entryId, targetWs)
    if (!sourceEntry) {
        throw new Error(`Entry ${entryId} not found`)
    }
    if (targetWs !== '*' && (sourceEntry.workspaceId ?? 'default') !== targetWs) {
        throw new Error(`Entry ${entryId} not found`)
    }
    if (projectNumber !== undefined && sourceEntry.projectNumber !== projectNumber) {
        throw new Error(`Entry ${entryId} not found`)
    }

    let queryEmbedding = dbAdapter.getVector(entryId)
    const hasDimensionMismatch =
        expectedDimensions !== undefined &&
        expectedDimensions > 0 &&
        queryEmbedding !== null &&
        queryEmbedding.length !== expectedDimensions
    if (!queryEmbedding || hasDimensionMismatch) {
        queryEmbedding = await generateEmbedding(formatEntryForEmbedding(sourceEntry))
        if (
            expectedDimensions !== undefined &&
            expectedDimensions > 0 &&
            queryEmbedding.length !== expectedDimensions
        ) {
            throw new Error(
                `Embedding dimension mismatch: expected ${String(expectedDimensions)}, got ${String(queryEmbedding.length)}`
            )
        }
        dbAdapter.upsertVector(entryId, queryEmbedding)
    }

    const results = dbAdapter.searchVectors(queryEmbedding, safeLimit + 1, targetWs, projectNumber)
    const candidates = collectCandidates(results, threshold, entryId)
    return resolveCandidates(dbAdapter, candidates, safeLimit, targetWs, projectNumber)
}
