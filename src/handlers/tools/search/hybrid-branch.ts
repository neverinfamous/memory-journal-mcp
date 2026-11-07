/**
 * Hybrid and FTS search branches of search_entries, extracted from the tool handler.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { ftsSearch } from './fts.js'
import { hybridSearch } from './hybrid.js'
import { cursorOffset, pageRows, rankByImportance } from './semantic-branch.js'
import type { SearchEntriesSchema } from './schemas.js'

type SearchInput = z.infer<typeof SearchEntriesSchema>
type FtsSearchOptions = Parameters<typeof ftsSearch>[3]
interface Facets {
    tags: { name: string; count: number }[]
    entryTypes: { name: string; count: number }[]
}

interface HybridBranchParams {
    context: ToolContext
    input: SearchInput
    query: string
    wsId: string
    isAuto: boolean
    searchOptions: FtsSearchOptions
    facets: Facets | undefined
}

/** Run hybrid (FTS + vector) search, optional importance re-sort, and page the output. */
export async function runHybridSearch(params: HybridBranchParams): Promise<Record<string, unknown>> {
    const { context, input, query, wsId, isAuto, searchOptions, facets } = params
    const { db, teamDb, vectorManager, teamVectorManager } = context
    if (!vectorManager) {
        // Fallback to FTS when vector search is unavailable
        const result = ftsSearch(input.query, db, teamDb, searchOptions)
        return { ...result, searchMode: 'fts (fallback)' }
    }
    const hybridOffset = cursorOffset(input.cursor)
    const { entries: hybridEntries, degraded } = await hybridSearch(query, db, vectorManager, {
        ...searchOptions,
        limit: input.limit + hybridOffset,
        ftsWeight: input.fts_weight,
        semanticWeight: input.semantic_weight,
        ...(teamDb !== undefined ? { teamDb } : {}),
        ...(teamVectorManager !== undefined ? { teamVectorManager } : {}),
    })
    const hybridPage = pageRows(hybridEntries, input.cursor, input.limit)

    // Post-fetch importance re-sort for vector results
    if (input.sort_by === 'importance') {
        const scored = rankByImportance(db, hybridEntries, wsId, teamDb)
        const scoredPage = pageRows(scored, input.cursor, input.limit)
        return {
            success: true,
            entries: scoredPage.page,
            count: scoredPage.page.length,
            searchMode: isAuto ? 'hybrid (auto)' : 'hybrid',
            degraded: degraded === true,
            facets,
            ...(scoredPage.nextCursor !== undefined ? { next_cursor: scoredPage.nextCursor } : {}),
        }
    }

    return {
        success: true,
        entries: hybridPage.page,
        count: hybridPage.page.length,
        searchMode: isAuto ? 'hybrid (auto)' : 'hybrid',
        degraded: degraded === true,
        facets,
        ...(hybridPage.nextCursor !== undefined ? { next_cursor: hybridPage.nextCursor } : {}),
    }
}

/** Run FTS search and shape the response. */
export function runFtsSearch(
    context: ToolContext,
    input: SearchInput,
    isAuto: boolean,
    searchOptions: FtsSearchOptions,
    facets: Facets | undefined
): Record<string, unknown> {
    const result = ftsSearch(input.query, context.db, context.teamDb, searchOptions)
    return {
        ...result,
        success: true,
        searchMode: isAuto ? 'fts (auto)' : 'fts',
        degraded: result.degraded ?? false,
        next_cursor: result.nextCursor,
        highlights: result.highlights,
        suggestions: result.suggestions,
        correctedQuery: result.correctedQuery,
        facets,
    }
}
