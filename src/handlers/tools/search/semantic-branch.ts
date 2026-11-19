/**
 * Semantic search branch of search_entries, extracted from the tool handler.
 */

import type { z } from 'zod'
import type { JournalEntry, ToolContext } from '../../../types/index.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'
import {
    passMetadataFilters,
    collectTeamSearchEntries,
    mergeAndDedup,
    isTeamDbReady,
    type EntryWithSource,
} from './helpers.js'
import { decodeCursor, encodeCursor } from '../../../database/sqlite-adapter/entries/search/cursor.js'
import type { SearchEntriesSchema } from './schemas.js'

type SearchInput = z.infer<typeof SearchEntriesSchema>
type SearchOptions = Parameters<typeof passMetadataFilters>[1]

/** Offset encoded in a pagination cursor (0 when absent or invalid). */
export function cursorOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor.length === 0) return 0
    const decoded = decodeCursor(cursor)
    if (decoded !== null && 'offset' in decoded) return decoded.offset
    return 0
}

/** Slice `rows` for the page named by `cursor`, returning a cursor for the next page if any. */
export function pageRows<T>(
    rows: T[],
    cursor: string | undefined,
    limit: number
): { page: T[]; nextCursor?: string } {
    const offset = cursorOffset(cursor)
    const page = rows.slice(offset, offset + limit)
    const next = offset + page.length
    if (next < rows.length) return { page, nextCursor: encodeCursor({ offset: next }) }
    return { page }
}

interface SemanticSearchParams {
    context: ToolContext
    input: SearchInput
    query: string
    wsId: string
    hasFilters: boolean
    searchOptions: SearchOptions & { includeTeam?: boolean | undefined }
}

/** Hydrate `importanceScore` onto ranked entries via a single lightweight score lookup per DB. */
function attachImportance(
    db: ToolContext['db'],
    ranked: EntryWithSource[],
    wsId: string,
    teamDb?: ToolContext['teamDb']
): EntryWithSource[] {
    const personalIds: number[] = []
    const teamIds: number[] = []
    for (const entry of ranked) {
        const id = entry['id']
        if (typeof id === 'number') {
            if (entry.source === 'team') teamIds.push(id)
            else personalIds.push(id)
        }
    }
    const fetchScores = (
        store: ToolContext['db'],
        ids: number[]
    ): Map<number, number> | undefined => {
        if (ids.length === 0) return undefined
        if (typeof store.getImportanceScoresByIds === 'function') {
            const raw = store.getImportanceScoresByIds(ids, wsId)
            const scores = new Map<number, number>()
            for (const [id, imp] of raw) scores.set(id, imp.score)
            return scores
        }
        const full = store.getEntriesByIdsWithImportance(ids, wsId)
        const scores = new Map<number, number>()
        for (const [id, item] of full) scores.set(id, item.importance.score)
        return scores
    }
    const personalScores = fetchScores(db, personalIds)
    const teamScores = teamDb !== undefined ? fetchScores(teamDb, teamIds) : undefined
    return ranked.map((entry) => {
        const id = entry['id']
        const map = entry.source === 'team' ? teamScores : personalScores
        const score = typeof id === 'number' ? (map?.get(id) ?? 0) : 0
        return { ...entry, importanceScore: Math.round(score * 100) / 100 }
    })
}

/** Re-rank entries by importance score (highest first), annotating `importanceScore`. */
export function rankByImportance(
    db: ToolContext['db'],
    ranked: EntryWithSource[],
    wsId: string,
    teamDb?: ToolContext['teamDb']
): EntryWithSource[] {
    const scored = attachImportance(db, ranked, wsId, teamDb)
    scored.sort((a, b) => {
        const left = typeof a['importanceScore'] === 'number' ? a['importanceScore'] : 0
        const right = typeof b['importanceScore'] === 'number' ? b['importanceScore'] : 0
        return right - left
    })
    return scored
}

/** Re-rank entries by `relevance * (1 + 0.35 * importanceScore)` (highest first). */
export function rankByBlendedScore(
    db: ToolContext['db'],
    ranked: EntryWithSource[],
    wsId: string,
    relevanceMap: ReadonlyMap<string, number>,
    teamDb?: ToolContext['teamDb']
): EntryWithSource[] {
    const scored = attachImportance(db, ranked, wsId, teamDb)
    scored.sort((a, b) => {
        const aId = typeof a['id'] === 'number' ? a['id'] : -1
        const bId = typeof b['id'] === 'number' ? b['id'] : -1
        const aKey = `${a.source ?? 'personal'}:${String(aId)}`
        const bKey = `${b.source ?? 'personal'}:${String(bId)}`
        const aRel = relevanceMap.get(aKey) ?? (typeof a['similarity'] === 'number' ? a['similarity'] : 0)
        const bRel = relevanceMap.get(bKey) ?? (typeof b['similarity'] === 'number' ? b['similarity'] : 0)
        const aImp = typeof a['importanceScore'] === 'number' ? a['importanceScore'] : 0
        const bImp = typeof b['importanceScore'] === 'number' ? b['importanceScore'] : 0
        return bRel * (1.0 + 0.35 * bImp) - aRel * (1.0 + 0.35 * aImp)
    })
    return scored
}

function hydratePersonalSemanticEntries(
    semanticResults: SemanticSearchResult[],
    db: ToolContext['db'],
    input: SearchInput,
    wsId: string,
    searchOptions: SearchOptions
): { entries: EntryWithSource[]; relevanceMap: Map<string, number> } {
    const relevanceMap = new Map<string, number>()
    const missingIds: number[] = []
    for (const result of semanticResults) {
        relevanceMap.set(`personal:${String(result.entryId)}`, result.score)
        if (result.entry === undefined) {
            missingIds.push(result.entryId)
        }
    }
    const entriesMap =
        missingIds.length > 0 ? db.getEntriesByIds(missingIds, wsId) : new Map<number, JournalEntry>()
    const resolvedById = new Map<number, Parameters<typeof passMetadataFilters>[0]>()
    for (const result of semanticResults) {
        const hydrated = result.entry ?? entriesMap.get(result.entryId)
        if (hydrated !== undefined) {
            resolvedById.set(result.entryId, hydrated)
        }
    }
    const missingTagIds = Array.from(resolvedById.values())
        .filter((entry) => !Array.isArray(entry.tags))
        .map((entry) => entry.id)
    if (
        missingTagIds.length > 0 &&
        ((input.tags !== undefined && input.tags.length > 0) ||
            (input.exclude_tags !== undefined && input.exclude_tags.length > 0))
    ) {
        const tagsMap = db.getTagsForEntries(missingTagIds)
        for (const id of missingTagIds) {
            const entry = resolvedById.get(id)
            if (entry) entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
    const entries: EntryWithSource[] = []
    for (const result of semanticResults) {
        const entry = resolvedById.get(result.entryId)
        if (entry === undefined || !passMetadataFilters(entry, searchOptions, db)) continue
        entries.push({
            ...entry,
            content: entry.content,
            timestamp: entry.timestamp,
            similarity: Math.round(result.score * 100) / 100,
            source: 'personal',
        })
    }
    return { entries, relevanceMap }
}

/** Run the vector search, apply metadata filters, merge team results and page the output. */
export async function runSemanticSearch(
    params: SemanticSearchParams
): Promise<{ page: EntryWithSource[]; nextCursor?: string; degraded: boolean }> {
    const { context, input, query, wsId, hasFilters, searchOptions } = params
    const { db, teamDb, vectorManager, teamVectorManager } = context
    if (!vectorManager) return { page: [], degraded: true }

    // Use semantic search with overfetching for filtering and cursor pagination reliability
    const needed = input.limit + cursorOffset(input.cursor)
    const internalLimit = hasFilters
        ? Math.min(Math.max(needed * 10, 100), 1000)
        : Math.min(needed * 2, 1000)
    const canQueryTeam =
        searchOptions.includeTeam === true && input.is_personal !== true && isTeamDbReady(teamDb)
    const teamDiagnostics: { teamVectorFailed?: boolean } = {}

    const [semanticResults, teamEntries] = await Promise.all([
        vectorManager.search(query, internalLimit, 0.25, wsId, searchOptions.projectNumber),
        canQueryTeam && teamDb !== undefined
            ? collectTeamSearchEntries(
                  query,
                  teamDb,
                  teamVectorManager,
                  {
                      ...searchOptions,
                      similarityThreshold: 0.25,
                      limit: Math.min(internalLimit, 500),
                  },
                  teamDiagnostics
              )
            : Promise.resolve<EntryWithSource[]>([]),
    ])
    const degraded =
        (canQueryTeam && teamVectorManager === undefined) ||
        teamDiagnostics.teamVectorFailed === true

    const { entries, relevanceMap } = hydratePersonalSemanticEntries(
        semanticResults,
        db,
        input,
        wsId,
        searchOptions
    )
    let ranked = entries

    if (canQueryTeam) {
        for (const teamEntry of teamEntries) {
            const id = teamEntry['id']
            const sim = teamEntry['similarity']
            if (typeof id === 'number' && typeof sim === 'number') {
                relevanceMap.set(`team:${String(id)}`, sim)
            }
        }
        ranked = mergeAndDedup(ranked, teamEntries, undefined, 'similarity', teamDb)
    }

    // Post-fetch importance or blended relevance × importance re-sort for vector results
    if (input.sort_by === 'blended') {
        ranked = rankByBlendedScore(db, ranked, wsId, relevanceMap, teamDb)
    } else if (input.sort_by === 'importance') {
        ranked = rankByImportance(db, ranked, wsId, teamDb)
    }

    return { ...pageRows(ranked, input.cursor, input.limit), degraded }
}
