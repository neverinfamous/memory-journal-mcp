import type { JournalEntry } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import { type EntriesSharedContext, rowsToEntries } from '../shared.js'
import { attachImportanceScoresToEntries } from '../importance.js'
import { buildVocabulary, expandFuzzyQuery } from '../fuzzy-matcher.js'
import { encodeCursor } from './cursor.js'
import { isFts5QueryError, sanitizeFtsQuery } from './fts-sanitizer.js'
import { effectiveWorkspace } from '../../../workspace-scope.js'
import { bucketInParams } from '../../row-helpers.js'
import {
    buildSearchQuery,
    readSearchPosition,
    type SearchQueryOptions,
} from './fts-query-builder.js'

export interface SearchQueryRow {
    id: number
    highlight_snippet?: string
}

interface SearchPage {
    entries: JournalEntry[]
    nextCursor?: string
    highlights?: { id: number; snippet: string }[]
}

function fetchPostLimitSnippets(
    db: EntriesSharedContext['db'],
    queryStr: string,
    entryIds: number[]
): Map<number, string> {
    const snippetMap = new Map<number, string>()
    if (entryIds.length === 0) return snippetMap
    const sanitized = sanitizeFtsQuery(queryStr)
    if (sanitized === '') return snippetMap
    for (const { placeholders, params } of bucketInParams(entryIds)) {
        const rows = db
            .prepare(
                `SELECT rowid AS id, snippet(fts_content, 0, '«', '»', '…', 64) AS highlight_snippet
                 FROM fts_content
                 WHERE fts_content MATCH ? AND rowid IN (${placeholders})`
            )
            .all(sanitized, ...params) as { id: number; highlight_snippet: string }[]
        for (const row of rows) {
            snippetMap.set(row.id, row.highlight_snippet)
        }
    }
    return snippetMap
}

function executeSearchQuery(
    context: EntriesSharedContext,
    queryStr: string,
    options: SearchQueryOptions | undefined,
    useFts: boolean,
    offset: number,
    hasKeyset: boolean,
    keysetT: string,
    keysetId: number
): SearchPage {
    const { db, tagsMgr } = context
    const { sql, params } = buildSearchQuery(
        queryStr,
        options,
        useFts,
        offset,
        hasKeyset,
        keysetT,
        keysetId
    )
    const rows = db.prepare(sql).all(params)
    const entries = rowsToEntries(tagsMgr, rows)
    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    if (!needsImportance && entries.length > 0) {
        attachImportanceScoresToEntries(context, entries, options?.workspaceId)
    }
    let nextCursor: string | undefined
    const limit = options?.limit ?? 10
    if (entries.length === limit && limit > 0) {
        if (!useFts && !needsImportance && queryStr.length === 0 && entries.length > 0) {
            const last = entries[entries.length - 1]
            if (last !== undefined) {
                nextCursor = encodeCursor({ t: last.timestamp, id: last.id })
            }
        } else {
            nextCursor = encodeCursor({ offset: offset + limit })
        }
    }

    const result: SearchPage = { entries }
    if (nextCursor !== undefined) {
        result.nextCursor = nextCursor
    }
    if (useFts && options?.includeHighlights === true) {
        if (needsImportance && entries.length > 0) {
            const snippetMap = fetchPostLimitSnippets(
                db,
                queryStr,
                entries.map((e) => e.id)
            )
            result.highlights = entries.map((e) => ({
                id: e.id,
                snippet: snippetMap.get(e.id) ?? '',
            }))
        } else {
            result.highlights = rows.map((row: unknown) => extractSnippet(row))
        }
    }
    return result
}

export function extractSnippet(row: unknown): { id: number; snippet: string } {
    if (typeof row === 'object' && row !== null && 'id' in row && 'highlight_snippet' in row) {
        return {
            id: Number(row.id),
            snippet: String(row.highlight_snippet),
        }
    }
    return { id: 0, snippet: '' }
}

interface SearchCallOptions extends SearchQueryOptions {
    cursor?: string
    fuzzy_match?: boolean
    auto_correct?: boolean
    offset?: number
}

function applyFuzzyFallback(
    context: EntriesSharedContext,
    db: EntriesSharedContext['db'],
    queryStr: string,
    options: SearchCallOptions | undefined,
    result: SearchPage
):
    | (SearchPage & {
          degraded?: boolean
          suggestions?: string[]
          correctedQuery?: string
      })
    | undefined {
    if (result.entries.length !== 0 || options?.fuzzy_match !== true) return undefined
    const vocab = buildVocabulary(db, effectiveWorkspace(options.workspaceId))
    const fuzzyRes = expandFuzzyQuery(queryStr, vocab, options.auto_correct)
    if (fuzzyRes.corrected && fuzzyRes.expanded !== queryStr) {
        const correctedResult = searchEntries(context, fuzzyRes.expanded, {
            ...options,
            fuzzy_match: false,
            auto_correct: false,
        })
        return { ...correctedResult, correctedQuery: fuzzyRes.expanded }
    }
    if (fuzzyRes.suggestions.length > 0) {
        return { ...result, suggestions: fuzzyRes.suggestions }
    }
    return undefined
}

export function searchEntries(
    context: EntriesSharedContext,
    queryStr: string,
    options?: SearchCallOptions
): {
    entries: JournalEntry[]
    nextCursor?: string
    degraded?: boolean
    highlights?: { id: number; snippet: string }[]
    suggestions?: string[]
    correctedQuery?: string
} {
    const { db } = context

    if (queryStr.length > 500) {
        throw new ValidationError(
            'Search query exceeds maximum length of 500 characters. Please refine your search.'
        )
    }

    const { offset, hasKeyset, keysetT, keysetId } = readSearchPosition(options)

    const runQuery = (useFts: boolean): SearchPage =>
        executeSearchQuery(context, queryStr, options, useFts, offset, hasKeyset, keysetT, keysetId)

    // Try FTS5 first for relevance-ranked results, fall back to LIKE on syntax error or 0 hits
    if (queryStr.length > 0) {
        try {
            const result = runQuery(true)
            if (result.entries.length > 0) {
                return result
            }
            const likeFallback = runQuery(false)
            if (likeFallback.entries.length > 0) {
                return { ...likeFallback, degraded: true }
            }
            const fuzzy = applyFuzzyFallback(context, db, queryStr, options, result)
            return fuzzy ?? result
        } catch (error) {
            if (!isFts5QueryError(error)) {
                throw error
            }

            const result = runQuery(false)
            return { ...result, degraded: true }
        }
    }

    return runQuery(false)
}
