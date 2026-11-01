import type { JournalEntry, EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import {
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { buildImportanceSqlExpression, buildImportanceCte } from '../importance.js'
import { sanitizeSearchQuery } from '../../../../utils/security-utils.js'
import { buildVocabulary, expandFuzzyQuery } from '../fuzzy-matcher.js'
import { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
import { sanitizeFtsQuery } from './fts-sanitizer.js'

export interface SearchQueryRow {
    id: number
    highlight_snippet?: string
}

export function ftsRankToRelevance(rank: number): number {
    return 1 / (1 + Math.abs(rank))
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

export function searchEntries(
    context: EntriesSharedContext,
    queryStr: string,
    options?: {
        limit?: number
        cursor?: string
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        prStatus?: string
        workflowRunId?: number
        tags?: string[]
        entryType?: EntryType
        startDate?: string
        endDate?: string
        sortBy?: SortBy
        includeArchived?: boolean
        includeHighlights?: boolean
        fuzzy_match?: boolean
        auto_correct?: boolean
        workspaceId?: string
        offset?: number
    }
): {
    entries: JournalEntry[]
    nextCursor?: string
    degraded?: boolean
    highlights?: { id: number; snippet: string }[]
    suggestions?: string[]
    correctedQuery?: string
} {
    const { db, tagsMgr } = context

    if (queryStr.length > 500) {
        throw new ValidationError(
            'Search query exceeds maximum length of 500 characters. Please refine your search.'
        )
    }

    let offset = options?.offset ?? 0
    let keysetT = ''
    let keysetId = 0
    let hasKeyset = false

    if (options?.cursor !== undefined) {
        const decoded = decodeCursor(options.cursor)
        if (decoded !== null) {
            if ('t' in decoded) {
                hasKeyset = true
                keysetT = decoded.t
                keysetId = decoded.id
            } else if ('offset' in decoded) {
                offset = decoded.offset
            }
        }
    }

    const buildAndExecute = (
        useFts: boolean
    ): {
        entries: JournalEntry[]
        nextCursor?: string
        highlights?: { id: number; snippet: string }[]
    } => {
        const { sql, params } = buildSearchQuery(
            queryStr,
            options,
            useFts,
            offset,
            hasKeyset,
            keysetT,
            keysetId
        )
        const stmt = db.prepare(sql)
        const rows = stmt.all(params)
        const entries = rowsToEntries(tagsMgr, rows)

        let nextCursor: string | undefined
        const limit = options?.limit ?? 10
        if (entries.length === limit && limit > 0) {
            if (!useFts && options?.sortBy !== 'importance' && entries.length > 0) {
                const last = entries[entries.length - 1]
                if (last !== undefined) {
                    nextCursor = encodeCursor({ t: last.timestamp, id: last.id })
                }
            } else {
                nextCursor = encodeCursor({ offset: offset + limit })
            }
        }

        const result: {
            entries: JournalEntry[]
            nextCursor?: string
            highlights?: { id: number; snippet: string }[]
        } = { entries }
        if (nextCursor !== undefined) {
            result.nextCursor = nextCursor
        }
        if (useFts && options?.includeHighlights === true) {
            result.highlights = rows.map((row: unknown) => extractSnippet(row))
        }

        return result
    }

    // Try FTS5 first for relevance-ranked results, fall back to LIKE on syntax error
    if (queryStr.length > 0) {
        try {
            const result = buildAndExecute(true)

            // Fuzzy search integration
            if (result.entries.length === 0 && options?.fuzzy_match === true) {
                const vocab = buildVocabulary(db)
                const fuzzyRes = expandFuzzyQuery(queryStr, vocab, options.auto_correct)

                if (fuzzyRes.corrected && fuzzyRes.expanded !== queryStr) {
                    const correctedResult = searchEntries(context, fuzzyRes.expanded, {
                        ...options,
                        fuzzy_match: false,
                        auto_correct: false,
                    })
                    return { ...correctedResult, correctedQuery: fuzzyRes.expanded }
                } else if (fuzzyRes.suggestions.length > 0) {
                    return { ...result, suggestions: fuzzyRes.suggestions }
                }
            }

            return result
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

            const result = buildAndExecute(false)
            return { ...result, degraded: true }
        }
    }

    return buildAndExecute(false)
}

/**
 * Builds the SQL query and params for searchEntries.
 */
function buildSearchQuery(
    queryStr: string,
    options:
        | {
              limit?: number
              isPersonal?: boolean
              projectNumber?: number
              issueNumber?: number
              prNumber?: number
              prStatus?: string
              workflowRunId?: number
              tags?: string[]
              entryType?: EntryType
              startDate?: string
              endDate?: string
              sortBy?: SortBy
              includeArchived?: boolean
              includeHighlights?: boolean
              workspaceId?: string
          }
        | undefined,
    useFts: boolean,
    offset: number,
    hasKeyset: boolean,
    keysetT: string,
    keysetId: number
): { sql: string; params: unknown[] } {
    let query: string
    const useImportance = options?.sortBy === 'importance'
    const importanceCol = `, ${buildImportanceSqlExpression()} AS importanceScore`

    const ctePrefix = `WITH ${buildImportanceCte()}`
    const joinClause = `LEFT JOIN rel_stats rs ON e.id = rs.entry_id LEFT JOIN anchor_stats ans ON e.id = ans.entry_id`

    const snippetCol =
        useFts && options?.includeHighlights === true
            ? ", snippet(fts_content, 0, '«', '»', '…', 64) AS highlight_snippet"
            : ''

    if (useFts) {
        query = `
            ${ctePrefix}
            SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS}${importanceCol}${snippetCol}
            FROM memory_journal e
            JOIN fts_content fts ON fts.rowid = e.id
            ${joinClause}
        `
    } else {
        query = `
            ${ctePrefix}
            SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS}${importanceCol}
            FROM memory_journal e
            ${joinClause}
        `
    }
    if (options?.tags !== undefined && options.tags.length > 0) {
        query += `
            JOIN entry_tags et ON e.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
        `
    }

    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    const targetWs = options?.workspaceId ?? 'default'
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
        conditions.push(`t.name IN (${placeholders})`)
        params.push(...options.tags)
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

    if (hasKeyset && !useFts && !useImportance) {
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
    }

    if (useImportance) {
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
