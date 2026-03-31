/**
 * Search Group — Hybrid RRF (Reciprocal Rank Fusion)
 *
 * Combines FTS5 (keyword) and semantic (vector) search results
 * using Reciprocal Rank Fusion for optimal relevance ranking.
 *
 * RRF formula: score(d) = Σ 1 / (k + rank_i(d))
 * where k=60 is a tuning constant (standard in literature).
 */

import type { JournalEntry } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager.js'
import type { EntryWithSource } from './helpers.js'

/** RRF tuning constant (standard value from Cormack et al. 2009) */
const RRF_K = 60

/** Over-fetch multiplier for each source before fusion */
const OVERFETCH_MULTIPLIER = 3

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
export function computeRRFScores(rankedLists: number[][]): Map<number, number> {
    const scores = new Map<number, number>()

    for (const list of rankedLists) {
        for (let rank = 0; rank < list.length; rank++) {
            const entryId = list[rank]
            if (entryId === undefined) continue
            const rrfScore = 1 / (RRF_K + rank + 1) // rank is 0-indexed, formula uses 1-indexed
            scores.set(entryId, (scores.get(entryId) ?? 0) + rrfScore)
        }
    }

    return scores
}

/**
 * Perform hybrid search combining FTS5 and semantic results via RRF.
 *
 * 1. Run FTS5 search and semantic search in parallel
 * 2. Extract entry ID ranked lists from each
 * 3. Compute RRF scores
 * 4. Fetch full entries for top results
 * 5. Return sorted by fusion score
 */
export async function hybridSearch(
    query: string,
    db: IDatabaseAdapter,
    vectorManager: VectorSearchManager | undefined,
    options: {
        limit: number
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        prStatus?: string
        workflowRunId?: number
    }
): Promise<{ entries: EntryWithSource[]; fusionScores: Map<number, number> }> {
    const overfetchLimit = Math.min(options.limit * OVERFETCH_MULTIPLIER, 500)

    // Run FTS5 and semantic search in parallel
    const [ftsResults, semanticResults] = await Promise.all([
        // FTS5 search
        Promise.resolve(
            db.searchEntries(query, {
                limit: overfetchLimit,
                isPersonal: options.isPersonal,
                projectNumber: options.projectNumber,
                issueNumber: options.issueNumber,
                prNumber: options.prNumber,
                prStatus: options.prStatus,
                workflowRunId: options.workflowRunId,
            })
        ),
        // Semantic search (returns [] if vectorManager is unavailable)
        vectorManager
            ? vectorManager.search(query, overfetchLimit, 0.15) // Lower threshold for broader recall
            : Promise.resolve([]),
    ])

    // Build ranked ID lists
    const ftsRanked = ftsResults.map((e) => e.id)
    const semanticRanked = semanticResults.map((r) => r.entryId)

    // Compute RRF scores
    const fusionScores = computeRRFScores([ftsRanked, semanticRanked])

    // Sort by fusion score descending
    const sortedIds = [...fusionScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, options.limit)
        .map(([id]) => id)

    // Batch fetch entries
    const entriesMap = db.getEntriesByIds(sortedIds)

    // Build output in fusion-score order
    const entries: EntryWithSource[] = []
    for (const id of sortedIds) {
        const entry = entriesMap.get(id)
        if (!entry) continue
        // Apply is_personal filter if specified
        if (options.isPersonal !== undefined && entry.isPersonal !== options.isPersonal) continue
        entries.push({ ...entry, source: 'personal' as const })
    }

    return { entries, fusionScores }
}
