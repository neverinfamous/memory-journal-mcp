/**
 * Progressive chunked vector candidate hydration helper shared across `search_entries` (semantic mode),
 * `semantic_search`, and `team_semantic_search` so metadata filters stop hydrating as soon as `targetCount`
 * matches are collected rather than hydrating up to 1,000 rows eagerly.
 */

import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { ToolContext } from '../../../types/index.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'
import { passMetadataFilters } from './helpers.js'

type VectorManager = NonNullable<ToolContext['vectorManager']>
type SearchFilterOpts = Parameters<typeof passMetadataFilters>[1]

export interface ProgressiveHydrationParams {
    db: IDatabaseAdapter
    vectorManager: VectorManager
    query: string
    candidateLimit: number
    targetCount: number
    threshold: number
    wsId: string
    projectNumber: number | undefined
    filterOptions: SearchFilterOpts
    hasTagFilters: boolean
    hasPostFilters: boolean
    excludeEntryId?: number | undefined
    enforceStrictWorkspace?: boolean
}

function hydrateCandidateChunk(
    chunk: readonly { entryId: number; distance: number; similarityScore: number }[],
    db: IDatabaseAdapter,
    wsId: string,
    projectNumber: number | undefined,
    filterOptions: SearchFilterOpts,
    hasTagFilters: boolean,
    excludeEntryId: number | undefined,
    enforceStrictWorkspace: boolean,
    out: SemanticSearchResult[]
): void {
    const chunkIds = chunk.map((c) => c.entryId)
    const entriesMap = db.getEntriesByIds(chunkIds, wsId)
    if (hasTagFilters) {
        const missingTagIds: number[] = []
        for (const entry of entriesMap.values()) {
            if (!Array.isArray(entry.tags)) missingTagIds.push(entry.id)
        }
        if (missingTagIds.length > 0) {
            const tagsMap = db.getTagsForEntries(missingTagIds)
            for (const id of missingTagIds) {
                const entry = entriesMap.get(id)
                if (entry) entry.tags = tagsMap.get(id) ?? []
            }
        }
    }

    for (const candidate of chunk) {
        const entry = entriesMap.get(candidate.entryId)
        if (!entry) continue
        if (excludeEntryId !== undefined && entry.id === excludeEntryId) continue
        const wsMismatch = enforceStrictWorkspace
            ? wsId !== '*' && entry.workspaceId !== wsId
            : wsId !== '*' && (entry.workspaceId ?? 'default') !== wsId
        if (wsMismatch) continue
        if (projectNumber !== undefined && entry.projectNumber !== projectNumber) continue
        if (!passMetadataFilters(entry, filterOptions, db)) continue
        out.push({
            entryId: candidate.entryId,
            entry,
            distance: candidate.distance,
            score: candidate.similarityScore,
            similarityScore: candidate.similarityScore,
        })
    }
}

/**
 * Search candidates and hydrate matching entries in progressive chunks when `vectorManager.searchCandidates`
 * is available; returns `null` when running against a mock lacking `searchCandidates`.
 */
export async function progressiveSearchVectorResults(
    params: ProgressiveHydrationParams
): Promise<SemanticSearchResult[] | null> {
    const {
        db,
        vectorManager,
        query,
        candidateLimit,
        targetCount,
        threshold,
        wsId,
        projectNumber,
        filterOptions,
        hasTagFilters,
        hasPostFilters,
        excludeEntryId,
        enforceStrictWorkspace = false,
    } = params
    if (typeof vectorManager.searchCandidates !== 'function') return null

    const candidates = await vectorManager.searchCandidates(
        query,
        candidateLimit,
        threshold,
        wsId,
        projectNumber
    )
    if (candidates.length === 0) return []

    const matched: SemanticSearchResult[] = []
    let cursor = 0
    let chunkSize = hasPostFilters ? Math.max(targetCount * 2, 32) : targetCount
    while (cursor < candidates.length && matched.length < targetCount) {
        const chunk = candidates.slice(cursor, cursor + chunkSize)
        cursor += chunk.length
        hydrateCandidateChunk(
            chunk,
            db,
            wsId,
            projectNumber,
            filterOptions,
            hasTagFilters,
            excludeEntryId,
            enforceStrictWorkspace,
            matched
        )
        chunkSize = Math.max(chunkSize * 2, 64)
    }
    return matched.slice(0, targetCount)
}
