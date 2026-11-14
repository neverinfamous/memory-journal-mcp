import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { SemanticSearchResult } from './types.js'

export interface VectorCandidate {
    entryId: number
    distance: number
    similarityScore: number
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

    const fetchLimit = projectNumber !== undefined ? Math.max((limit + 1) * 10, 100) : limit + 1
    const results = dbAdapter.searchVectors(queryEmbedding, fetchLimit, targetWs, projectNumber)
    const candidates = collectCandidates(results, threshold, entryId)
    return resolveCandidates(dbAdapter, candidates, limit, targetWs, projectNumber)
}
