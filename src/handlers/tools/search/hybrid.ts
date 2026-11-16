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
import {
    passMetadataFilters,
    canAccessTeamSilently,
    isTeamDbReady,
    type ISearchFilters,
    type EntryWithSource,
} from './helpers.js'
import { canReadTeamEntriesRbac } from '../team/rbac.js'
import { logger } from '../../../utils/logger.js'

/** RRF tuning constant (standard value from Cormack et al. 2009) */
const RRF_K = 60

/** Over-fetch multiplier for each source before fusion */
const OVERFETCH_MULTIPLIER = 2

export interface RRFResult {
    entry: JournalEntry & { source?: 'personal' | 'team' }
    fusionScore: number
}

/**
 * Compute RRF scores from ranked result lists.
 *
 * Each input list is an array of entry IDs in rank order (best first).
 * The output is a map of entry ID -> cumulative RRF score.
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

interface VectorSearchHitLike {
    entryId: number
    score?: number
    similarity?: number
}

function readHitScore(hit: VectorSearchHitLike): number {
    if (typeof hit.score === 'number') return hit.score
    if (typeof hit.similarity === 'number') return hit.similarity
    return 0
}

function computeQualifiedRRFScores(
    rankedLists: string[][],
    weights: number[]
): Map<string, number> {
    const scores = new Map<string, number>()
    for (let i = 0; i < rankedLists.length; i++) {
        const list = rankedLists[i]
        const weight = weights[i] ?? 1.0
        if (!list) continue
        for (let rank = 0; rank < list.length; rank++) {
            const key = list[rank]
            if (key === undefined) continue
            const rrfScore = weight * (1 / (RRF_K + rank + 1))
            scores.set(key, (scores.get(key) ?? 0) + rrfScore)
        }
    }
    return scores
}

async function queryStoreHybrid(
    query: string,
    store: IDatabaseAdapter,
    vecMgr: VectorSearchManager | undefined,
    options: HybridSearchOptions,
    overfetchLimit: number,
    isPersonalFilter: boolean | undefined
): Promise<{
    ftsResults: ReturnType<IDatabaseAdapter['searchEntries']>
    semanticResults: VectorSearchHitLike[]
    semanticDegraded: boolean
}> {
    let semanticDegraded = false
    const [ftsResults, semanticResults] = await Promise.all([
        Promise.resolve(
            store.searchEntries(query, {
                limit: overfetchLimit,
                isPersonal: isPersonalFilter,
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
        vecMgr
            ? vecMgr
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

function hydrateQualifiedStoreCandidates(
    ids: number[],
    source: 'personal' | 'team',
    store: IDatabaseAdapter,
    options: HybridSearchOptions
): EntryWithSource[] {
    if (ids.length === 0) return []
    const entriesMap = store.getEntriesByIds(ids, options.workspaceId ?? 'default')
    if (
        (options.tags !== undefined && options.tags.length > 0) ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0)
    ) {
        const tagsMap = store.getTagsForEntries(ids)
        for (const entry of entriesMap.values()) {
            entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
    const candidates: EntryWithSource[] = []
    for (const id of ids) {
        const entry = entriesMap.get(id)
        if (!entry || !passMetadataFilters(entry, options, store)) continue
        candidates.push({ ...entry, source })
    }
    return candidates
}

function buildTeamHybridLists(
    teamFtsEntries: JournalEntry[],
    teamSemantic: VectorSearchHitLike[]
): {
    teamFtsKeys: string[]
    teamSemanticRanked: { key: string; score: number }[]
} {
    return {
        teamFtsKeys: teamFtsEntries.map((e) => `team:${String(e.id)}`),
        teamSemanticRanked: teamSemantic.map((r) => ({
            key: `team:${String(r.entryId)}`,
            score: readHitScore(r),
        })),
    }
}

function assembleHybridCandidates(
    sortedKeys: string[],
    qualifiedFusionScores: Map<string, number>,
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    canQueryTeam: boolean,
    options: HybridSearchOptions
): EntryWithSource[] {
    const personalIds: number[] = []
    const teamIds: number[] = []
    for (const key of sortedKeys) {
        if (key.startsWith('personal:')) {
            personalIds.push(Number(key.slice('personal:'.length)))
        } else if (key.startsWith('team:')) {
            teamIds.push(Number(key.slice('team:'.length)))
        }
    }
    const hydratedPersonal = hydrateQualifiedStoreCandidates(personalIds, 'personal', db, options)
    const hydratedTeam =
        teamDb !== undefined && canQueryTeam
            ? hydrateQualifiedStoreCandidates(teamIds, 'team', teamDb, options)
            : []
    return [...hydratedPersonal, ...hydratedTeam]
        .sort((a, b) => {
            const rawA = a['id']
            const rawB = b['id']
            const aIdStr = typeof rawA === 'number' || typeof rawA === 'string' ? String(rawA) : '-1'
            const bIdStr = typeof rawB === 'number' || typeof rawB === 'string' ? String(rawB) : '-1'
            const aKey = `${a.source}:${aIdStr}`
            const bKey = `${b.source}:${bIdStr}`
            const scoreDiff =
                (qualifiedFusionScores.get(bKey) ?? 0) - (qualifiedFusionScores.get(aKey) ?? 0)
            if (scoreDiff !== 0) return scoreDiff
            return (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
        })
        .slice(0, options.limit)
}

/**
 * Perform hybrid search combining FTS5 and semantic results via unified RRF across personal + team stores.
 */
export async function hybridSearch(
    query: string,
    db: IDatabaseAdapter,
    vectorManager: VectorSearchManager | undefined,
    options: HybridSearchOptions
): Promise<{ entries: EntryWithSource[]; fusionScores: Map<string, number>; degraded?: boolean }> {
    const overfetchLimit = Math.min(Math.max(options.limit * OVERFETCH_MULTIPLIER, 50), 500)
    const teamDb = options.teamDb
    const canQueryTeam =
        options.includeTeam === true &&
        options.isPersonal !== true &&
        isTeamDbReady(teamDb) &&
        canAccessTeamSilently('search_entries') &&
        canReadTeamEntriesRbac(teamDb, options.config, options.workspaceId)

    const [personalStoreRes, teamStoreRes] = await Promise.all([
        queryStoreHybrid(query, db, vectorManager, options, overfetchLimit, options.isPersonal),
        canQueryTeam && teamDb !== undefined
            ? queryStoreHybrid(
                  query,
                  teamDb,
                  options.teamVectorManager,
                  options,
                  overfetchLimit,
                  undefined
              )
            : Promise.resolve(undefined),
    ])

    const ftsWeight = options.ftsWeight ?? 1.0
    const semanticWeight = options.semanticWeight ?? 1.0
    const personalFtsKeys = personalStoreRes.ftsResults.entries.map(
        (e) => `personal:${String(e.id)}`
    )
    const personalSemanticRanked = personalStoreRes.semanticResults.map((r) => ({
        key: `personal:${String(r.entryId)}`,
        score: readHitScore(r),
    }))
    const teamLists =
        teamStoreRes !== undefined
            ? buildTeamHybridLists(teamStoreRes.ftsResults.entries, teamStoreRes.semanticResults)
            : { teamFtsKeys: [], teamSemanticRanked: [] }

    const unifiedSemanticKeys = [...personalSemanticRanked, ...teamLists.teamSemanticRanked]
        .sort((a, b) => b.score - a.score)
        .map((item) => item.key)

    const rankedLists =
        teamLists.teamFtsKeys.length > 0
            ? [personalFtsKeys, teamLists.teamFtsKeys, unifiedSemanticKeys]
            : [personalFtsKeys, unifiedSemanticKeys]
    const weights =
        teamLists.teamFtsKeys.length > 0
            ? [ftsWeight, ftsWeight, semanticWeight]
            : [ftsWeight, semanticWeight]
    const qualifiedFusionScores = computeQualifiedRRFScores(rankedLists, weights)

    // Hydrate candidate pool before slicing so post-fusion metadata filters cannot under-fill `limit`
    const candidateCap = Math.min(Math.max(options.limit * 10, 200), 1000)
    const sortedKeys = [...qualifiedFusionScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, candidateCap)
        .map(([key]) => key)

    const combined = assembleHybridCandidates(
        sortedKeys,
        qualifiedFusionScores,
        db,
        teamDb,
        canQueryTeam,
        options
    )
    const isDegraded =
        personalStoreRes.ftsResults.degraded === true ||
        personalStoreRes.semanticDegraded ||
        teamStoreRes?.ftsResults.degraded === true ||
        teamStoreRes?.semanticDegraded === true
    return { entries: combined, fusionScores: qualifiedFusionScores, degraded: isDegraded }
}
