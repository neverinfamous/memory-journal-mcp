import { Buffer } from 'buffer'
import type { JournalEntry, EntryType } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import {
    ENTRY_COLUMNS,
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from './shared.js'
import { buildImportanceSqlExpression, buildImportanceCte } from './importance.js'
import { sanitizeSearchQuery } from '../../../utils/security-utils.js'

/** Allowed sort dimensions for search results */
export type SortBy = 'timestamp' | 'importance'

// ============================================================================
// Cursor Pagination Helpers
// ============================================================================

export function encodeCursor(payload: { t: string; id: number } | { offset: number }): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64')
}

export function decodeCursor(cursor: string): { t: string; id: number } | { offset: number } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded) as unknown
        return parsed as { t: string; id: number } | { offset: number }
    } catch {
        return null
    }
}

// ============================================================================
// Query Functions
// ============================================================================

export function getRecentEntries(
    context: EntriesSharedContext,
    limit: number,
    sortBy: SortBy = 'timestamp',
    cursor?: string
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

    if (sortBy === 'importance') {
        let offset = 0
        if (cursor) {
            const decoded = decodeCursor(cursor)
            if (decoded && 'offset' in decoded) offset = decoded.offset
        }
        const importanceExpr = buildImportanceSqlExpression()
        const cte = buildImportanceCte()
        const stmt = db.prepare(`
            WITH ${cte}
            SELECT ${ALIASED_ENTRY_COLUMNS}, ${importanceExpr} AS importanceScore
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            WHERE e.deleted_at IS NULL
            ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC LIMIT ? OFFSET ?
        `)
        const rows = stmt.all([limit, offset])
        const entries = rowsToEntries(tagsMgr, rows)
        
        let nextCursor: string | undefined
        if (entries.length === limit && limit > 0) {
            nextCursor = encodeCursor({ offset: offset + limit })
        }
        return { entries, nextCursor }
    }

    let cursorCondition = ''
    const params: unknown[] = []
    
    if (cursor) {
        const decoded = decodeCursor(cursor)
        if (decoded && 't' in decoded) {
            cursorCondition = ' AND (timestamp < ? OR (timestamp = ? AND id < ?))'
            params.push(decoded.t, decoded.t, decoded.id)
        }
    }

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL ${cursorCondition}
        ORDER BY timestamp DESC, id DESC LIMIT ?
    `)
    params.push(limit)
    const rows = stmt.all(params)
    const entries = rowsToEntries(tagsMgr, rows)

    let nextCursor: string | undefined
    if (entries.length === limit && limit > 0) {
        const last = entries[entries.length - 1]
        if (last) {
            nextCursor = encodeCursor({ t: last.timestamp, id: last.id })
        }
    }

    return { entries, nextCursor }
}

export function getEntriesPage(
    context: EntriesSharedContext,
    offset: number,
    limit: number,
    order: 'asc' | 'desc' = 'desc'
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

    const sortDir = order === 'asc' ? 'ASC' : 'DESC'

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL 
        ORDER BY timestamp ${sortDir}, id ${sortDir} 
        LIMIT ? OFFSET ?
    `)
    const rows = stmt.all([limit, offset])
    const entries = rowsToEntries(tagsMgr, rows)

    let nextCursor: string | undefined
    if (entries.length === limit && limit > 0) {
        nextCursor = encodeCursor({ offset: offset + limit })
    }

    return { entries, nextCursor }
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
    }
): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean } {
    const { db, tagsMgr } = context

    if (queryStr.length > 500) {
        throw new ValidationError(
            'Search query exceeds maximum length of 500 characters. Please refine your search.'
        )
    }

    let offset = 0
    let keysetT = ''
    let keysetId = 0
    let hasKeyset = false

    if (options?.cursor) {
        const decoded = decodeCursor(options.cursor)
        if (decoded) {
            if ('t' in decoded) {
                hasKeyset = true
                keysetT = decoded.t
                keysetId = decoded.id
            } else if ('offset' in decoded) {
                offset = decoded.offset
            }
        }
    }

    const buildAndExecute = (useFts: boolean): { entries: JournalEntry[]; nextCursor?: string } => {
        const { sql, params } = buildSearchQuery(queryStr, options, useFts, offset, hasKeyset, keysetT, keysetId)
        const stmt = db.prepare(sql)
        const rows = stmt.all(params)
        const entries = rowsToEntries(tagsMgr, rows)
        
        let nextCursor: string | undefined
        const limit = options?.limit ?? 10
        if (entries.length === limit && limit > 0) {
            if (!useFts && options?.sortBy !== 'importance' && entries.length > 0) {
                const last = entries[entries.length - 1]
                if (last) {
                    nextCursor = encodeCursor({ t: last.timestamp, id: last.id })
                }
            } else {
                nextCursor = encodeCursor({ offset: offset + limit })
            }
        }
        return { entries, nextCursor }
    }

    // Try FTS5 first for relevance-ranked results, fall back to LIKE on syntax error
    if (queryStr.length > 0) {
        try {
            return buildAndExecute(true)
        } catch (error) {
            // FTS5 syntax error (e.g. unbalanced quotes, special chars) — fall back to LIKE
            // Rethrow if it's an infrastructural error (like missing extension)
            const isSyntaxError =
                error instanceof Error &&
                (error.message.includes('syntax error') ||
                    error.message.includes('no such column') ||
                    error.message.includes('unterminated string') ||
                    error.message.includes('unrecognized token'))

            if (!isSyntaxError) {
                // Infrastructural error - rethrow
                throw error
            }

            // Syntax error - fall back to LIKE with degraded flag
            const result = buildAndExecute(false)
            return { ...result, degraded: true }
        }
    }

    return buildAndExecute(false)
}

/**
 * Builds the SQL query and params for searchEntries.
 * @param useFts - If true, uses FTS5 MATCH with BM25 ranking. If false, uses LIKE substring matching.
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
    const importanceCol = useImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    let ctePrefix = ''
    let joinClause = ''
    if (useImportance) {
        ctePrefix = `WITH ${buildImportanceCte()}`
        joinClause = `LEFT JOIN rel_stats rs ON e.id = rs.entry_id`
    }

    if (useFts) {
        query = `
            ${ctePrefix}
            SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS}${importanceCol}
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
    if (options?.tags && options.tags.length > 0) {
        query += `
            JOIN entry_tags et ON e.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
        `
    }

    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

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

    if (options?.tags && options.tags.length > 0) {
        const placeholders = options.tags.map(() => '?').join(',')
        conditions.push(`t.name IN (${placeholders})`)
        params.push(...options.tags)
    }

    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
    }

    if (options?.startDate) {
        let start = options.startDate
        if (!start.includes('T')) start += 'T00:00:00.000Z'
        conditions.push(`e.timestamp >= ?`)
        params.push(start)
    }

    if (options?.endDate) {
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

    // FTS5: rank by relevance (BM25), then timestamp for tiebreaking
    // LIKE/no-query: rank by timestamp only
    // Importance: override ranking with importance score
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

export function searchByDateRange(
    context: EntriesSharedContext,
    startDate: string,
    endDate: string,
    options?: {
        entryType?: EntryType
        tags?: string[]
        cursor?: string
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        workflowRunId?: number
        limit?: number
        sortBy?: SortBy
    }
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

    let start = startDate
    if (!start.includes('T')) start += 'T00:00:00.000Z'

    const conditions = ['deleted_at IS NULL', 'timestamp >= ?']
    const params: unknown[] = [start]

    if (endDate) {
        conditions.push('timestamp <= ?')
        let end = endDate
        if (!end.includes('T')) end += 'T23:59:59.999Z'
        params.push(end)
    }

    const useImportance = options?.sortBy === 'importance'
    const importanceCol = useImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    let offset = 0
    let hasKeyset = false
    let keysetT = ''
    let keysetId = 0
    if (options?.cursor) {
        const decoded = decodeCursor(options.cursor)
        if (decoded) {
            if ('t' in decoded) {
                hasKeyset = true
                keysetT = decoded.t
                keysetId = decoded.id
            } else if ('offset' in decoded) {
                offset = decoded.offset
            }
        }
    }

    let query = ''
    if (useImportance) {
        query += `WITH ${buildImportanceCte()} `
    }

    query += `
        SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS}${importanceCol} FROM memory_journal e
    `
    if (useImportance) {
        query += `LEFT JOIN rel_stats rs ON e.id = rs.entry_id `
    }

    if (options?.tags && options.tags.length > 0) {
        query += `
            JOIN entry_tags et ON e.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
        `
        const placeholders = options.tags.map(() => '?').join(',')
        conditions.push(`t.name IN (${placeholders})`)
        params.push(...options.tags)
    }

    if (options?.entryType !== undefined) {
        conditions.push(`e.entry_type = ?`)
        params.push(options.entryType)
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

    if (options?.workflowRunId !== undefined) {
        conditions.push(`e.workflow_run_id = ?`)
        params.push(options.workflowRunId)
    }

    if (hasKeyset && !useImportance) {
        conditions.push(`(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))`)
        params.push(keysetT, keysetT, keysetId)
    }

    if (useImportance) {
        query += ` WHERE ${conditions.join(' AND ')} ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC`
    } else {
        query += ` WHERE ${conditions.join(' AND ')} ORDER BY e.timestamp DESC, e.id DESC`
    }

    query += ` LIMIT ? OFFSET ?`
    params.push(options?.limit ?? 500, offset)

    const stmt = db.prepare(query)
    const rows = stmt.all(params)

    const entries = rowsToEntries(tagsMgr, rows)
    let nextCursor: string | undefined
    const limit = options?.limit ?? 500
    if (entries.length === limit && limit > 0) {
        if (!useImportance && entries.length > 0) {
            const last = entries[entries.length - 1]
            if (last) {
                nextCursor = encodeCursor({ t: last.timestamp, id: last.id })
            }
        } else {
            nextCursor = encodeCursor({ offset: offset + limit })
        }
    }

    return { entries, nextCursor }
}

// ============================================================================
// FTS5 Helpers
// ============================================================================

/**
 * Rigorous FTS5 Query Sanitization
 *
 * Prevents FTS5 catastrophic backtracking (ReDoS) and application-level syntax crashes
 * by aggressively stripping FTS control syntax and forcing queries into safe,
 * implicit AND-token sequences.
 *
 * Threat Vectors Mitigated:
 * - Unbalanced quotes & parentheses causing SQLITE_ERROR syntax crashes
 * - Deeply nested or hallucinated \`NEAR/xxx\` proximity operators causing FTS planner ReDoS
 * - Column filters (\`col:val\`) leaking unintended field traversals
 * - Naked booleans (\`word AND OR NOT word\`) confusing the FTS AST parser
 */
function sanitizeFtsQuery(query: string): string {
    if (!query) return ''

    // Strip quotes entirely to prevent unterminated string syntax errors
    const noQuotes = query.replace(/"/g, ' ')
    const tokens = noQuotes.split(/\s+/)
    const safeTokens: string[] = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (!token) continue

        // Strip out non-alphanumeric characters, except hyphen, underscore, and asterisk
        let sanitizedToken = token.replace(/[^a-zA-Z0-9_*-]/g, '')
        if (!sanitizedToken) continue

        // Ensure asterisk is only at the end of the token for prefix matching,
        // preventing standalone asterisks or inner asterisks which cause syntax errors.
        const hasAsterisk = token.endsWith('*')
        sanitizedToken = sanitizedToken.replace(/\*/g, '')
        if (hasAsterisk && sanitizedToken.length > 0) {
            sanitizedToken += '*'
        }

        if (!sanitizedToken || sanitizedToken === '*') continue

        // Drop NEAR as it causes ReDoS
        if (/^NEAR$/i.test(sanitizedToken)) continue

        const isOperator = /^(AND|OR|NOT)$/i.test(sanitizedToken)
        if (isOperator) {
            // Must be uppercase for FTS5
            sanitizedToken = sanitizedToken.toUpperCase()

            // Operators cannot be the first token
            if (safeTokens.length === 0) continue

            // Operators cannot be preceded by another operator
            const prevToken = safeTokens[safeTokens.length - 1]
            if (prevToken && /^(AND|OR|NOT)$/.test(prevToken)) {
                // If there are adjacent operators, skip the current one
                continue
            }

            // Operators must have a valid subsequent non-operator token
            let hasValidNext = false
            for (let j = i + 1; j < tokens.length; j++) {
                const rawNext = tokens[j]
                if (!rawNext) continue

                let nextToken = rawNext.replace(/[^a-zA-Z0-9_*-]/g, '')
                nextToken = nextToken.replace(/\*/g, '')
                if (nextToken && !/^(AND|OR|NOT|NEAR)$/i.test(nextToken)) {
                    hasValidNext = true
                    break
                }
            }

            if (!hasValidNext) continue
        }

        safeTokens.push(sanitizedToken)
    }

    return safeTokens.join(' ')
}
