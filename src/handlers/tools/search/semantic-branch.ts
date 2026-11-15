/**
 * Semantic search branch of search_entries, extracted from the tool handler.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { passMetadataFilters, collectTeamSearchEntries, mergeAndDedup, type EntryWithSource } from './helpers.js'
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

/** Hydrate `importanceScore` onto ranked entries via a single batch lookup per DB. */
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
    const personalMap =
        personalIds.length > 0 ? db.getEntriesByIdsWithImportance(personalIds, wsId) : undefined
    const teamMap =
        teamDb !== undefined && teamIds.length > 0
            ? teamDb.getEntriesByIdsWithImportance(teamIds, wsId)
            : undefined
    return ranked.map((entry) => {
        const id = entry['id']
        const map = entry.source === 'team' ? teamMap : personalMap
        const score = typeof id === 'number' ? (map?.get(id)?.importance.score ?? 0) : 0
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
    const semanticResults = await vectorManager.search(
        query,
        internalLimit,
        0.25,
        wsId,
        searchOptions.projectNumber
    )
    const entryIds = semanticResults.map((r) => r.entryId)
    const relevanceMap = new Map<string, number>()
    for (const result of semanticResults) {
        relevanceMap.set(`personal:${String(result.entryId)}`, result.score)
    }
    const entriesMap = db.getEntriesByIds(entryIds, wsId)

    // Pre-hydrate tags to avoid N+1 queries during metadata filtering
    if (
        (input.tags !== undefined && input.tags.length > 0) ||
        (input.exclude_tags !== undefined && input.exclude_tags.length > 0)
    ) {
        const tagsMap = db.getTagsForEntries(entryIds)
        for (const entry of entriesMap.values()) {
            entry.tags = tagsMap.get(entry.id) ?? []
        }
    }

    const entries: EntryWithSource[] = []
    for (const result of semanticResults) {
        const entry = entriesMap.get(result.entryId)
        if (entry === undefined) continue
        if (!passMetadataFilters(entry, searchOptions, db)) continue
        entries.push({
            ...entry,
            content: entry.content,
            timestamp: entry.timestamp,
            source: 'personal',
        })
    }
    let ranked = entries
    let degraded = false

    if (searchOptions.includeTeam && input.is_personal !== true && teamDb !== undefined) {
        // [SIDE-EFFECT] Without a team vector index, team results come from FTS; report it as degraded.
        if (teamVectorManager === undefined) degraded = true
        // [INVARIANT] Keep one row past the page so pageRows can emit next_cursor.
        const teamEntries = await collectTeamSearchEntries(query, teamDb, teamVectorManager, {
            ...searchOptions,
            limit: needed + 1,
        })
        ranked = mergeAndDedup(ranked, teamEntries, needed + 1, 'preserve')
    }

    // Post-fetch importance or blended relevance × importance re-sort for vector results
    if (input.sort_by === 'blended') {
        ranked = rankByBlendedScore(db, ranked, wsId, relevanceMap, teamDb)
    } else if (input.sort_by === 'importance') {
        ranked = rankByImportance(db, ranked, wsId, teamDb)
    }

    return { ...pageRows(ranked, input.cursor, input.limit), degraded }
}
