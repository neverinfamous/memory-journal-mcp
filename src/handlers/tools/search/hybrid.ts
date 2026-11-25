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
    toEntryType,
    type ISearchFilters,
    type EntryWithSource,
} from './helpers.js'
import { isRecord } from '../../../utils/type-guards.js'
import { collapseTeamMirrors } from '../../../utils/team-mirror.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
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
    const entryType: EntryType | undefined = toEntryType(options.entryType)
    const [ftsResults, semanticResults] = await Promise.all([
        Promise.resolve(
            store.searchEntries(query, {
                limit: overfetchLimit, isPersonal: isPersonalFilter, projectNumber: options.projectNumber,
                issueNumber: options.issueNumber, prNumber: options.prNumber, prStatus: options.prStatus,
                workflowRunId: options.workflowRunId, tags: options.tags, excludeTags: options.excludeTags,
                entryType, startDate: options.startDate, endDate: options.endDate,
                includeArchived: options.includeArchived, workspaceId: options.workspaceId,
            })
        ),
        vecMgr
            ? (typeof vecMgr.searchCandidates === 'function'
                  ? vecMgr.searchCandidates(query, overfetchLimit, 0.15, options.workspaceId, options.projectNumber)
                  : vecMgr.search(query, overfetchLimit, 0.15, options.workspaceId, options.projectNumber)
              ).catch((err: unknown) => {
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

function hasHydratedEntryMetadata(entry: JournalEntry): boolean {
    return (
        typeof entry.content === 'string' &&
        typeof entry.timestamp === 'string' &&
        typeof entry.entryType === 'string' &&
        typeof entry.isPersonal === 'boolean'
    )
}

function hydrateQualifiedStoreCandidates(
    ids: number[],
    source: 'personal' | 'team',
    store: IDatabaseAdapter,
    options: HybridSearchOptions,
    ftsSeedById: ReadonlyMap<number, JournalEntry>
): EntryWithSource[] {
    if (ids.length === 0) return []
    const missingIds = ids.filter((id) => {
        const seeded = ftsSeedById.get(id)
        return seeded === undefined || !hasHydratedEntryMetadata(seeded)
    })
    const fetchedMap =
        missingIds.length > 0
            ? store.getEntriesByIds(missingIds, options.workspaceId ?? 'default')
            : new Map<number, JournalEntry>()

    const hydratedById = new Map<number, JournalEntry>()
    for (const id of ids) {
        const chosen = fetchedMap.get(id) ?? ftsSeedById.get(id)
        if (chosen) hydratedById.set(id, chosen)
    }

    const needTags =
        (options.tags !== undefined && options.tags.length > 0) ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0)
    if (needTags) {
        const missingTagIds = ids.filter((id) => {
            const entry = hydratedById.get(id)
            return entry !== undefined && !Array.isArray(entry.tags)
        })
        if (missingTagIds.length > 0) {
            const tagsMap = store.getTagsForEntries(missingTagIds)
            for (const id of missingTagIds) {
                const entry = hydratedById.get(id)
                if (entry) entry.tags = tagsMap.get(entry.id) ?? []
            }
        }
    }

    const candidates: EntryWithSource[] = []
    for (const id of ids) {
        const entry = hydratedById.get(id)
        if (!entry || !passMetadataFilters(entry, options, store)) continue
        const entryRecord: unknown = entry
        const rawAuthor = isRecord(entryRecord) ? entryRecord['author'] : undefined
        candidates.push({
            ...entry,
            ...(source === 'team' && typeof rawAuthor === 'string'
                ? { author: sanitizeAuthor(rawAuthor) }
                : {}),
            source,
        })
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

function hydrateHybridChunk(
    keysChunk: readonly string[],
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    canQueryTeam: boolean,
    options: HybridSearchOptions,
    personalFtsById: ReadonlyMap<number, JournalEntry>,
    teamFtsById: ReadonlyMap<number, JournalEntry>
): EntryWithSource[] {
    const personalIds: number[] = []
    const teamIds: number[] = []
    for (const key of keysChunk) {
        if (key.startsWith('personal:')) {
            personalIds.push(Number(key.slice('personal:'.length)))
        } else if (key.startsWith('team:')) {
            teamIds.push(Number(key.slice('team:'.length)))
        }
    }
    const hydratedPersonal = hydrateQualifiedStoreCandidates(
        personalIds,
        'personal',
        db,
        options,
        personalFtsById
    )
    const hydratedTeam =
        teamDb !== undefined && canQueryTeam
            ? hydrateQualifiedStoreCandidates(teamIds, 'team', teamDb, options, teamFtsById)
            : []
    return [...hydratedPersonal, ...hydratedTeam]
}

function compareHybridCandidates(
    a: EntryWithSource,
    b: EntryWithSource,
    qualifiedFusionScores: ReadonlyMap<string, number>
): number {
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
}

function stampTeamMirrorOriginsForChunk(
    teamDb: IDatabaseAdapter | undefined,
    chunkEntries: EntryWithSource[],
    originCache: Map<number, number | null>
): EntryWithSource[] {
    if (teamDb === undefined || typeof teamDb.getMirrorOrigins !== 'function') return chunkEntries
    const uncachedIds: number[] = []
    for (const entry of chunkEntries) {
        const id = entry['id']
        if (entry.source === 'team' && entry.team_db === undefined && typeof id === 'number' && !originCache.has(id)) {
            uncachedIds.push(id)
        }
    }
    if (uncachedIds.length > 0) {
        const fetched = teamDb.getMirrorOrigins(uncachedIds)
        for (const id of uncachedIds) originCache.set(id, fetched.get(id) ?? null)
    }
    return chunkEntries.map((entry) => {
        const id = entry['id']
        const origin = entry.source === 'team' && entry.team_db === undefined && typeof id === 'number' ? originCache.get(id) : undefined
        return origin !== undefined && origin !== null ? { ...entry, originPersonalId: origin } : entry
    })
}

function assembleHybridCandidates(
    sortedKeys: string[],
    qualifiedFusionScores: Map<string, number>,
    db: IDatabaseAdapter,
    teamDb: IDatabaseAdapter | undefined,
    canQueryTeam: boolean,
    options: HybridSearchOptions,
    personalFtsById: ReadonlyMap<number, JournalEntry>,
    teamFtsById: ReadonlyMap<number, JournalEntry>
): EntryWithSource[] {
    const accumulated: EntryWithSource[] = []
    const teamOriginCache = new Map<number, number | null>()
    let cursor = 0
    let chunkSize = Math.max(options.limit * 2, 24)

    // Hydrate top-ranked RRF chunks lazily and extend across equal-score ties for exact ranking.
    while (cursor < sortedKeys.length) {
        let end = Math.min(cursor + chunkSize, sortedKeys.length)
        const boundaryKey = sortedKeys[end - 1]
        const boundaryScore = boundaryKey !== undefined ? (qualifiedFusionScores.get(boundaryKey) ?? 0) : 0
        while (end < sortedKeys.length) {
            const nextKey = sortedKeys[end]
            const nextScore = nextKey !== undefined ? (qualifiedFusionScores.get(nextKey) ?? 0) : 0
            if (nextScore !== boundaryScore) break
            end++
        }
        const chunkEntries = hydrateHybridChunk(
            sortedKeys.slice(cursor, end), db, teamDb, canQueryTeam, options, personalFtsById, teamFtsById
        )
        accumulated.push(...(canQueryTeam ? stampTeamMirrorOriginsForChunk(teamDb, chunkEntries, teamOriginCache) : chunkEntries))
        cursor = end
        if (accumulated.length >= options.limit) {
            const uniqueCount = canQueryTeam ? collapseTeamMirrors(accumulated).length : accumulated.length
            if (uniqueCount >= options.limit) break
        }
        chunkSize = Math.max(chunkSize * 2, 64)
    }

    const ordered = accumulated.sort((a, b) => compareHybridCandidates(a, b, qualifiedFusionScores))
    // [INVARIANT] M2: collapse personal/team mirror pairs (keep personal, annotate `alsoInTeam`).
    return collapseTeamMirrors(ordered).slice(0, options.limit)
}

function fuseHybridStoreResults(
    personalStoreRes: Awaited<ReturnType<typeof queryStoreHybrid>>,
    teamStoreRes: Awaited<ReturnType<typeof queryStoreHybrid>> | undefined,
    options: HybridSearchOptions
): {
    qualifiedFusionScores: Map<string, number>
    sortedKeys: string[]
    personalFtsById: Map<number, JournalEntry>
    teamFtsById: Map<number, JournalEntry>
} {
    const ftsWeight = options.ftsWeight ?? 1.0
    const semanticWeight = options.semanticWeight ?? 1.0
    const personalFtsKeys = personalStoreRes.ftsResults.entries.map((e) => `personal:${String(e.id)}`)
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

    return {
        qualifiedFusionScores,
        sortedKeys,
        personalFtsById: new Map(personalStoreRes.ftsResults.entries.map((e) => [e.id, e])),
        teamFtsById: new Map((teamStoreRes?.ftsResults.entries ?? []).map((e) => [e.id, e])),
    }
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
        canAccessTeamSilently('search_entries', { teamDb, config: options.config }, options.workspaceId)

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

    const { qualifiedFusionScores, sortedKeys, personalFtsById, teamFtsById } =
        fuseHybridStoreResults(personalStoreRes, teamStoreRes, options)
    const combined = assembleHybridCandidates(
        sortedKeys,
        qualifiedFusionScores,
        db,
        teamDb,
        canQueryTeam,
        options,
        personalFtsById,
        teamFtsById
    )
    const isDegraded =
        personalStoreRes.ftsResults.degraded === true ||
        personalStoreRes.semanticDegraded ||
        teamStoreRes?.ftsResults.degraded === true ||
        teamStoreRes?.semanticDegraded === true
    return { entries: combined, fusionScores: qualifiedFusionScores, degraded: isDegraded }
}
