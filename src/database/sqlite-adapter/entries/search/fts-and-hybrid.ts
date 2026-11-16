import type { JournalEntry, EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import {
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import {
    buildImportanceSqlExpression,
    buildImportanceCte,
    attachImportanceScoresToEntries,
} from '../importance.js'
import { sanitizeSearchQuery } from '../../../../utils/security-utils.js'
import { buildVocabulary, expandFuzzyQuery } from '../fuzzy-matcher.js'
import { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
import { sanitizeFtsQuery } from './fts-sanitizer.js'
import { effectiveWorkspace } from '../../../workspace-scope.js'

interface SearchQueryOptions {
    limit?: number
    isPersonal?: boolean
    projectNumber?: number
    issueNumber?: number
    prNumber?: number
    prStatus?: string
    workflowRunId?: number
    tags?: string[]
    excludeTags?: string[]
    entryType?: EntryType
    startDate?: string
    endDate?: string
    sortBy?: SortBy
    includeArchived?: boolean
    includeHighlights?: boolean
    workspaceId?: string
}

export interface SearchQueryRow {
    id: number
    highlight_snippet?: string
}

interface SearchPage {
    entries: JournalEntry[]
    nextCursor?: string
    highlights?: { id: number; snippet: string }[]
}

interface SearchPosition {
    offset: number
    hasKeyset: boolean
    keysetT: string
    keysetId: number
}

function readSearchPosition(options?: { cursor?: string; offset?: number }): SearchPosition {
    let offset = options?.offset ?? 0
    let keysetT = ''
    let keysetId = 0
    let hasKeyset = false
    if (options?.cursor !== undefined && options.cursor !== '') {
        const decoded = decodeCursor(options.cursor)
        if (decoded === null) {
            throw new ValidationError('Invalid pagination cursor. Re-run the search without a cursor.')
        }
        if ('t' in decoded) {
            hasKeyset = true
            offset = 0
            keysetT = decoded.t
            keysetId = decoded.id
        } else {
            offset = decoded.offset
        }
    }
    return { offset, hasKeyset, keysetT, keysetId }
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
    if (options?.sortBy !== 'importance' && entries.length > 0) {
        attachImportanceScoresToEntries(context, entries)
    }

    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    let nextCursor: string | undefined
    const limit = options?.limit ?? 10
    if (entries.length === limit && limit > 0) {
        if (!useFts && !needsImportance && entries.length > 0) {
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
        result.highlights = rows.map((row: unknown) => extractSnippet(row))
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
                const fuzzy = applyFuzzyFallback(context, db, queryStr, options, result)
                return fuzzy ?? result
            }
            const likeFallback = runQuery(false)
            if (likeFallback.entries.length > 0) {
                return { ...likeFallback, degraded: true }
            }
            const fuzzy = applyFuzzyFallback(context, db, queryStr, options, result)
            return fuzzy ?? result
        } catch (error) {
            const isSyntaxError =
                error instanceof Error &&
                (error.message.includes('syntax error') ||
                    error.message.includes('no such column') ||
                    error.message.includes('unterminated string') ||
                    error.message.includes('unrecognized token'))

            if (!isSyntaxError) {
                throw error
            }

            const result = runQuery(false)
            return { ...result, degraded: true }
        }
    }

    return runQuery(false)
}

/**
 * Builds the SELECT ... FROM prefix (with optional importance CTE/joins and snippet column).
 */
function buildBaseSelect(options: SearchQueryOptions | undefined, useFts: boolean): string {
    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    const importanceCol = needsImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    const ctePrefix = needsImportance ? `WITH ${buildImportanceCte()}` : ''
    const joinClause = needsImportance
        ? `LEFT JOIN rel_stats rs ON e.id = rs.entry_id LEFT JOIN anchor_stats ans ON e.id = ans.entry_id`
        : ''

    const snippetCol =
        useFts && options?.includeHighlights === true
            ? ", snippet(fts_content, 0, '«', '»', '…', 64) AS highlight_snippet"
            : ''

    if (useFts) {
        return `
            ${ctePrefix}
            SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol}${snippetCol}
            FROM fts_content fts
            CROSS JOIN memory_journal e ON e.id = fts.rowid
            ${joinClause}
        `
    }
    return `
            ${ctePrefix}
            SELECT ${ALIASED_ENTRY_COLUMNS}${importanceCol}
            FROM memory_journal e
            ${joinClause}
        `
}

/**
 * Builds the SQL query and params for searchEntries.
 */
function buildSearchQuery(
    queryStr: string,
    options: SearchQueryOptions | undefined,
    useFts: boolean,
    offset: number,
    hasKeyset: boolean,
    keysetT: string,
    keysetId: number
): { sql: string; params: unknown[] } {
    const needsImportance = options?.sortBy === 'importance' || options?.sortBy === 'blended'
    let query = buildBaseSelect(options, useFts)

    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    const targetWs = effectiveWorkspace(options?.workspaceId)
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?')
        params.push(targetWs)
    }

    if (options?.includeArchived !== true) {
        conditions.push('e.is_archived = 0')
    }

    if (queryStr.length > 0) {
        if (useFts) {
            conditions.push(`fts_content MATCH ?`)
            params.push(sanitizeFtsQuery(queryStr))
        } else {
            conditions.push(`e.content LIKE '%' || ? || '%' ESCAPE '\\'`)
            params.push(sanitizeSearchQuery(queryStr))
        }
    }

    appendFilterConditions(conditions, params, options)

    if (hasKeyset && !useFts && !needsImportance) {
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
    }

    if (options?.sortBy === 'blended' && useFts) {
        query += ` ORDER BY ((-rank) * (1.0 + 0.35 * importanceScore)) DESC, e.timestamp DESC, e.id DESC`
    } else if (needsImportance) {
        query += ` ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC`
    } else if (useFts) {
        query += ` ORDER BY rank, e.timestamp DESC, e.id DESC`
    } else {
        query += ` ORDER BY e.timestamp DESC, e.id DESC`
    }

    query += ` LIMIT ? OFFSET ?`
    params.push(options?.limit ?? 10, offset)

    return { sql: query, params }
}

/**
 * Appends the optional attribute/tag/date filter conditions for searchEntries.
 */
function appendFilterConditions(
    conditions: string[],
    params: unknown[],
    options: SearchQueryOptions | undefined
): void {
    if (options?.isPersonal !== undefined) {
        conditions.push(`e.is_personal = ?`)
        params.push(options.isPersonal ? 1 : 0)
    }

    if (options?.projectNumber !== undefined) {
        conditions.push(`e.project_number = ?`)
        params.push(options.projectNumber)
    }

    if (options?.issueNumber !== undefined) {
        conditions.push(`e.issue_number = ?`)
        params.push(options.issueNumber)
    }

    if (options?.prNumber !== undefined) {
        conditions.push(`e.pr_number = ?`)
        params.push(options.prNumber)
    }

    if (options?.prStatus !== undefined) {
        conditions.push(`e.pr_status = ?`)
        params.push(options.prStatus)
    }

    if (options?.workflowRunId !== undefined) {
        conditions.push(`e.workflow_run_id = ?`)
        params.push(options.workflowRunId)
    }

    if (options?.tags !== undefined && options.tags.length > 0) {
        const placeholders = options.tags.map(() => '?').join(',')
        conditions.push(
            `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.name IN (${placeholders}))`
        )
        params.push(...options.tags)
    }

    if (options?.excludeTags !== undefined && options.excludeTags.length > 0) {
        const placeholders = options.excludeTags.map(() => '?').join(',')
        conditions.push(
            `NOT EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.name IN (${placeholders}))`
        )
        params.push(...options.excludeTags)
    }

    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
    }

    if (options?.startDate !== undefined && options.startDate.length > 0) {
        let start = options.startDate
        if (!start.includes('T')) start += 'T00:00:00.000Z'
        conditions.push(`e.timestamp >= ?`)
        params.push(start)
    }

    if (options?.endDate !== undefined && options.endDate.length > 0) {
        let end = options.endDate
        if (!end.includes('T')) end += 'T23:59:59.999Z'
        conditions.push(`e.timestamp <= ?`)
        params.push(end)
    }
}

