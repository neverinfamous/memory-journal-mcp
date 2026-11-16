/**
 * Search Group — Hybrid RRF (Reciprocal Rank Fusion)
 *
 * Combines FTS5 (keyword) and semantic (vector) search results
 * using Reciprocal Rank Fusion for optimal relevance ranking.
 *
 * RRF formula: score(d) = Σ 1 / (k + rank_i(d))
 * where k=60 is a tuning constant (standard in literature).
 */

import type { JournalEntry, EntryType } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import { passMetadataFilters, collectTeamSearchEntries, mergeAndDedup, type ISearchFilters, type EntryWithSource } from './helpers.js'
import { logger } from '../../../utils/logger.js'

/** RRF tuning constant (standard value from Cormack et al. 2009) */
const RRF_K = 60

/** Over-fetch multiplier for each source before fusion */
const OVERFETCH_MULTIPLIER = 2

// ============================================================================
// Types
// ============================================================================

export interface RRFResult {
    entry: JournalEntry & { source?: 'personal' | 'team' }
    fusionScore: number
}

// ============================================================================
// RRF Algorithm
// ============================================================================

/**
 * Compute RRF scores from ranked result lists.
 *
 * Each input list is an array of entry IDs in rank order (best first).
 * The output is a map of entry ID → cumulative RRF score.
 */
export function computeRRFScores(rankedLists: number[][], weights?: number[]): Map<number, number> {
    const scores = new Map<number, number>()

    for (let i = 0; i < rankedLists.length; i++) {
        const list = rankedLists[i]
        const weight = weights?.[i] ?? 1.0
        if (!list) continue

        for (let rank = 0; rank < list.length; rank++) {
            const entryId = list[rank]
            if (entryId === undefined) continue
            const rrfScore = weight * (1 / (RRF_K + rank + 1)) // rank is 0-indexed, formula uses 1-indexed
            scores.set(entryId, (scores.get(entryId) ?? 0) + rrfScore)
        }
    }

    return scores
}

type HybridSearchOptions = ISearchFilters & {
    limit: number
    ftsWeight?: number
    semanticWeight?: number
    teamDb?: IDatabaseAdapter
    teamVectorManager?: VectorSearchManager
}

async function runPersonalHybridQueries(
    query: string,
    db: IDatabaseAdapter,
    vectorManager: VectorSearchManager | undefined,
    options: HybridSearchOptions,
    overfetchLimit: number
): Promise<{
    ftsResults: ReturnType<IDatabaseAdapter['searchEntries']>
    semanticResults: Awaited<ReturnType<VectorSearchManager['search']>>
    semanticDegraded: boolean
}> {
    let semanticDegraded = false
    const [ftsResults, semanticResults] = await Promise.all([
        Promise.resolve(
            db.searchEntries(query, {
                limit: overfetchLimit,
                isPersonal: options.isPersonal,
                projectNumber: options.projectNumber,
                issueNumber: options.issueNumber,
                prNumber: options.prNumber,
                prStatus: options.prStatus,
                workflowRunId: options.workflowRunId,
                tags: options.tags,
                excludeTags: options.excludeTags,
                entryType: options.entryType as EntryType,
                startDate: options.startDate,
                endDate: options.endDate,
                includeArchived: options.includeArchived,
                workspaceId: options.workspaceId,
            })
        ),
        vectorManager
            ? vectorManager
                  .search(query, overfetchLimit, 0.15, options.workspaceId, options.projectNumber)
                  .catch((err: unknown) => {
                      logger.warning(
                          `Semantic search degraded: ${err instanceof Error ? err.message : String(err)}`,
                          { module: 'HybridSearch' }
                      )
                      semanticDegraded = true
                      return []
                  })
            : Promise.resolve([]),
    ])
    return { ftsResults, semanticResults, semanticDegraded }
}

function hydrateAndFilterFusionCandidates(
    sortedIds: number[],
    db: IDatabaseAdapter,
    options: HybridSearchOptions
): EntryWithSource[] {
    const entriesMap = db.getEntriesByIds(sortedIds, options.workspaceId ?? 'default')
    if (
        (options.tags !== undefined && options.tags.length > 0) ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0)
    ) {
        const tagsMap = db.getTagsForEntries(sortedIds)
        for (const entry of entriesMap.values()) {
            entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
    const entries: EntryWithSource[] = []
    for (const id of sortedIds) {
        const entry = entriesMap.get(id)
        if (!entry || !passMetadataFilters(entry, options, db)) continue
        entries.push({ ...entry, source: 'personal' as const })
        if (entries.length >= options.limit) break
    }
    return entries
}

/**
 * Perform hybrid search combining FTS5 and semantic results via RRF.
 */
export async function hybridSearch(
    query: string,
    db: IDatabaseAdapter,
    vectorManager: VectorSearchManager | undefined,
    options: HybridSearchOptions
): Promise<{ entries: EntryWithSource[]; fusionScores: Map<string, number>; degraded?: boolean }> {
    const overfetchLimit = Math.min(Math.max(options.limit * OVERFETCH_MULTIPLIER, 50), 500)
    const { ftsResults, semanticResults, semanticDegraded } = await runPersonalHybridQueries(
        query,
        db,
        vectorManager,
        options,
        overfetchLimit
    )

    const fusionScores = computeRRFScores(
        [ftsResults.entries.map((e) => e.id), semanticResults.map((r) => r.entryId)],
        [options.ftsWeight ?? 1.0, options.semanticWeight ?? 1.0]
    )

    // Hydrate candidate pool before slicing so post-fusion metadata filters cannot under-fill `limit`
    const candidateCap = Math.min(Math.max(options.limit * 10, 200), 1000)
    const sortedIds = [...fusionScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, candidateCap)
        .map(([id]) => id)

    const entries = hydrateAndFilterFusionCandidates(sortedIds, db, options)
    const isDegraded = ftsResults.degraded === true || semanticDegraded
    let output = entries
    if (options.includeTeam === true && options.isPersonal !== true && options.teamDb !== undefined) {
        const teamEntries = await collectTeamSearchEntries(
            query,
            options.teamDb,
            options.teamVectorManager,
            options
        )
        output = mergeAndDedup(entries, teamEntries, options.limit, 'preserve')
    }

    const qualifiedFusionScores = new Map<string, number>()
    for (const [id, score] of fusionScores) {
        qualifiedFusionScores.set(`personal:${String(id)}`, score)
    }
    return { entries: output, fusionScores: qualifiedFusionScores, degraded: isDegraded }
}
