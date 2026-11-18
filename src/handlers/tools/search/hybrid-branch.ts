/**
 * Hybrid and FTS search branches of search_entries, extracted from the tool handler.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { ftsSearch } from './fts.js'
import { hybridSearch } from './hybrid.js'
import { isTeamDbReady } from './helpers.js'
import { cursorOffset, pageRows, rankByImportance, rankByBlendedScore } from './semantic-branch.js'
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
    const readyTeamDb = isTeamDbReady(teamDb) ? teamDb : undefined
    if (!vectorManager) {
        // Fallback to FTS when vector search is unavailable
        const result = ftsSearch(input.query, db, readyTeamDb, searchOptions)
        return {
            ...result,
            success: true,
            entries: result.entries,
            count: result.entries.length,
            searchMode: 'fts (fallback)',
            degraded: true,
            facets,
            ...(result.nextCursor !== undefined ? { next_cursor: result.nextCursor } : {}),
        }
    }
    const hybridOffset = cursorOffset(input.cursor)
    const needed = input.limit + hybridOffset + 1
    const rerankByImportance = input.sort_by === 'blended' || input.sort_by === 'importance'
    const candidateLimit = rerankByImportance ? Math.min(needed * 2, 500) : needed
    const { entries: hybridEntries, fusionScores, degraded } = await hybridSearch(query, db, vectorManager, {
        ...searchOptions,
        // [INVARIANT] Over-fetch one row past the page so pageRows can emit next_cursor.
        limit: candidateLimit,
        ftsWeight: input.fts_weight,
        semanticWeight: input.semantic_weight,
        ...(readyTeamDb !== undefined ? { teamDb: readyTeamDb } : {}),
        ...(readyTeamDb !== undefined && teamVectorManager !== undefined ? { teamVectorManager } : {}),
    })
    // Post-fetch importance or blended relevance × importance re-sort for vector results
    if (rerankByImportance) {
        const scored =
            input.sort_by === 'blended'
                ? rankByBlendedScore(db, hybridEntries, wsId, fusionScores, readyTeamDb)
                : rankByImportance(db, hybridEntries, wsId, readyTeamDb)
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

    const hybridPage = pageRows(hybridEntries, input.cursor, input.limit)
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
    const readyTeamDb = isTeamDbReady(context.teamDb) ? context.teamDb : undefined
    const result = ftsSearch(input.query, context.db, readyTeamDb, searchOptions)
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
