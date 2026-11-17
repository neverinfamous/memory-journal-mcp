import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { SemanticSearchResult } from './types.js'

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
    for (let i = 0; i < count; i++) {
        const start = i * dimensions
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

/** Batch-extract per-entry settled embeddings from a pipeline function using 2D [N, D] tensor batching when available. */
export async function runPipelineBatchEmbeddingsSettled(
    pipeline: unknown,
    texts: readonly string[],
    dimensions: number,
    fallbackSingle: (text: string) => Promise<Float32Array>
): Promise<PromiseSettledResult<Float32Array>[]> {
    if (texts.length === 0) return []
    if (texts.length > 1 && typeof pipeline === 'function') {
        const pipeFn = pipeline as (
            inputs: string[],
            options: unknown
        ) => Promise<{ data?: ArrayLike<number>; dims?: number[] }>
        const results: PromiseSettledResult<Float32Array>[] = []
        let startIndex = 0
        try {
            const batchOut = await pipeFn([...texts], { pooling: 'mean', normalize: true })
            const vectors = sliceBatchTensor(batchOut, texts.length, dimensions)
            if (vectors !== undefined) {
                return vectors.map((value) => ({ status: 'fulfilled', value }))
            }
            if (batchOut.data?.length === dimensions) {
                results.push({ status: 'fulfilled', value: new Float32Array(batchOut.data) })
                startIndex = 1
            }
        } catch (reason) {
            results.push({ status: 'rejected', reason })
            startIndex = 1
        }
        for (let i = startIndex; i < texts.length; i++) {
            const text = texts[i]
            if (text !== undefined) results.push(await embedSingleSettled(text, fallbackSingle))
        }
        return results
    }
    const results: PromiseSettledResult<Float32Array>[] = []
    for (const text of texts) {
        results.push(await embedSingleSettled(text, fallbackSingle))
    }
    return results
}

/** Batch-extract embeddings from a pipeline function when it returns a 2D tensor [N, D]. */
export async function runPipelineBatchEmbeddings(
    pipeline: unknown,
    texts: readonly string[],
    dimensions: number,
    fallbackSingle: (text: string) => Promise<Float32Array>
): Promise<Float32Array[]> {
    const settled = await runPipelineBatchEmbeddingsSettled(pipeline, texts, dimensions, fallbackSingle)
    return settled.map((item) => {
        if (item.status === 'rejected') throw item.reason
        return item.value
    })
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
    if (candidates.length === 0) {
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
            (targetWs === '*' || entry.workspaceId === targetWs) &&
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
    projectNumber?: number
): Promise<SemanticSearchResult[]> {
    const sourceEntry = dbAdapter.getEntryById(entryId, targetWs)
    if (!sourceEntry) {
        throw new Error(`Entry ${entryId} not found`)
    }
    if (projectNumber !== undefined && sourceEntry.projectNumber !== projectNumber) {
        throw new Error(`Entry ${entryId} not found`)
    }

    let queryEmbedding = dbAdapter.getVector(entryId)
    if (!queryEmbedding) {
        const tagsText =
            sourceEntry.tags !== undefined && sourceEntry.tags !== null && sourceEntry.tags.length > 0
                ? ` [Tags: ${sourceEntry.tags.join(', ')}]`
                : ''
        const text = `[${sourceEntry.entryType}]${tagsText} ${sourceEntry.content}`
        queryEmbedding = await generateEmbedding(text)
        dbAdapter.upsertVector(entryId, queryEmbedding)
    }

    const results = dbAdapter.searchVectors(queryEmbedding, limit + 1, targetWs, projectNumber)
    const candidates = collectCandidates(results, threshold, entryId)
    return resolveCandidates(dbAdapter, candidates, limit, targetWs, projectNumber)
}
