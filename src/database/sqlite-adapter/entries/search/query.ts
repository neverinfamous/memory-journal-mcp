import type { JournalEntry, EntryType } from '../../../../types/index.js'
import { ValidationError } from '../../../../types/errors.js'
import {
    ENTRY_COLUMNS,
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { buildImportanceSqlExpression, buildImportanceCte } from '../importance.js'
import { sanitizeSearchQuery } from '../../../../utils/security-utils.js'
import { buildVocabulary, expandFuzzyQuery } from '../fuzzy-matcher.js'
import { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
import { sanitizeFtsQuery } from './fts-sanitizer.js'

// ============================================================================
// Query Functions
// ============================================================================

export function getRecentEntries(
    context: EntriesSharedContext,
    limit: number,
    sortBy: SortBy = 'timestamp',
    cursor?: string,
    includeArchived = false,
    workspaceId = 'default'
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
        
        const params: unknown[] = []
        if (workspaceId !== '*') params.push(workspaceId)
        params.push(limit, offset)

        const stmt = db.prepare(`
            WITH ${cte}
            SELECT ${ALIASED_ENTRY_COLUMNS}, ${importanceExpr} AS importanceScore
            FROM memory_journal e
            LEFT JOIN rel_stats rs ON e.id = rs.entry_id
            LEFT JOIN anchor_stats ans ON e.id = ans.entry_id
            WHERE e.deleted_at IS NULL ${!includeArchived ? 'AND e.is_archived = 0' : ''} ${workspaceId !== '*' ? 'AND e.workspace_id = ?' : ''}
            ORDER BY importanceScore DESC, e.timestamp DESC, e.id DESC LIMIT ? OFFSET ?
        `)
        const rows = stmt.all(params)
        const entries = rowsToEntries(tagsMgr, rows)
        
        let nextCursor: string | undefined
        if (entries.length === limit && limit > 0) {
            nextCursor = encodeCursor({ offset: offset + limit })
        }
        return { entries, nextCursor }
    }

    let cursorCondition = ''
    const params: unknown[] = []
    
    if (workspaceId !== '*') {
        params.push(workspaceId)
    }
    
    if (cursor) {
        const decoded = decodeCursor(cursor)
        if (decoded && 't' in decoded) {
            cursorCondition = ' AND (timestamp < ? OR (timestamp = ? AND id < ?))'
            params.push(decoded.t, decoded.t, decoded.id)
        }
    }

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL ${!includeArchived ? 'AND is_archived = 0' : ''} ${workspaceId !== '*' ? 'AND workspace_id = ?' : ''} ${cursorCondition}
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
        includeArchived?: boolean
        includeHighlights?: boolean
        fuzzy_match?: boolean
        auto_correct?: boolean
        workspaceId?: string
    }
): { entries: JournalEntry[]; nextCursor?: string; degraded?: boolean; highlights?: { id: number; snippet: string }[]; suggestions?: string[]; correctedQuery?: string } {
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

    const buildAndExecute = (useFts: boolean): { entries: JournalEntry[]; nextCursor?: string; highlights?: { id: number; snippet: string }[] } => {
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
        
        let highlights: { id: number; snippet: string }[] | undefined
        if (useFts && options?.includeHighlights) {
            highlights = rows.map((row: unknown) => {
                const r = row as { id: number; highlight_snippet: string }
                return {
                    id: r.id,
                    snippet: r.highlight_snippet,
                }
            })
        }
        
        return { entries, nextCursor, highlights }
    }

    // Try FTS5 first for relevance-ranked results, fall back to LIKE on syntax error
    if (queryStr.length > 0) {
        try {
            const result = buildAndExecute(true)
            
            // Fuzzy search integration
            if (result.entries.length === 0 && options?.fuzzy_match) {
                const vocab = buildVocabulary(db)
                const fuzzyRes = expandFuzzyQuery(queryStr, vocab, options.auto_correct)
                
                if (fuzzyRes.corrected && fuzzyRes.expanded !== queryStr) {
                    // Try again with corrected query
                    const correctedResult = searchEntries(context, fuzzyRes.expanded, { ...options, fuzzy_match: false, auto_correct: false })
                    return { ...correctedResult, correctedQuery: fuzzyRes.expanded }
                } else if (fuzzyRes.suggestions.length > 0) {
                    // Return empty results but with suggestions
                    return { ...result, suggestions: fuzzyRes.suggestions }
                }
            }
            
            return result
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
    const importanceCol = useImportance
        ? `, ${buildImportanceSqlExpression()} AS importanceScore`
        : ''

    let ctePrefix = ''
    let joinClause = ''
    if (useImportance) {
        ctePrefix = `WITH ${buildImportanceCte()}`
        joinClause = `LEFT JOIN rel_stats rs ON e.id = rs.entry_id LEFT JOIN anchor_stats ans ON e.id = ans.entry_id`
    }

    const snippetCol = (useFts && options?.includeHighlights) ? ", snippet(fts_content, 0, '«', '»', '…', 64) AS highlight_snippet" : ""

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
    if (options?.tags && options.tags.length > 0) {
        query += `
            JOIN entry_tags et ON e.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
        `
    }

    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    const targetWs = options?.workspaceId ?? 'default';
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?');
        params.push(targetWs);
    }

    if (!options?.includeArchived) {
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

export function getSearchFacets(
    context: EntriesSharedContext,
    queryStr: string,
    options?: {
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
        includeArchived?: boolean
        workspaceId?: string
    }
): { tags: { name: string; count: number }[]; entryTypes: { name: string; count: number }[] } {
    const { db } = context
    
    // Build shared conditions based on options and query
    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    const targetWs = options?.workspaceId ?? 'default';
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?');
        params.push(targetWs);
    }

    if (!options?.includeArchived) {
        conditions.push('e.is_archived = 0')
    }

    const useFts = queryStr.length > 0

    if (useFts) {
        conditions.push(`fts_content MATCH ?`)
        params.push(sanitizeFtsQuery(queryStr))
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const joinFts = useFts ? `JOIN fts_content fts ON fts.rowid = e.id` : ''

    // 1. Tag facets query
    const tagsSql = `
        SELECT t.name, COUNT(DISTINCT e.id) AS cnt
        FROM memory_journal e
        ${joinFts}
        JOIN entry_tags et ON e.id = et.entry_id
        JOIN tags t ON et.tag_id = t.id
        ${whereClause}
        GROUP BY t.name ORDER BY cnt DESC LIMIT 20
    `
    // We pass params twice if options.tags was used, because the whereClause has the tags condition in it.
    // Wait, if options.tags was used, it adds a JOIN in tagsSql? Yes, but tagsSql ALREADY has a JOIN tags t.
    // It's perfectly fine to reuse the whereClause, but we need to ensure the table aliases match.
    // `e`, `fts`, `et`, `t` are used in tagsSql exactly as expected.
    
    // However, if options?.tags was used, `conditions` uses `t.name IN (...)`.
    // In tagsSql, `t` is already joined.
    
    // What about entry types query? It does NOT join `tags` or `entry_tags` normally, UNLESS `options.tags` is provided.
    const entryTypesJoinTags = options?.tags && options.tags.length > 0 ? `JOIN entry_tags et ON e.id = et.entry_id JOIN tags t ON et.tag_id = t.id` : ''
    const entryTypesSql = `
        SELECT e.entry_type AS name, COUNT(DISTINCT e.id) AS cnt
        FROM memory_journal e
        ${joinFts}
        ${entryTypesJoinTags}
        ${whereClause}
        GROUP BY e.entry_type ORDER BY cnt DESC
    `

    const tagsStmt = db.prepare(tagsSql)
    const entryTypesStmt = db.prepare(entryTypesSql)

    const tagsRows = tagsStmt.all(params) as { name: string; cnt: number }[]
    const entryTypesRows = entryTypesStmt.all(params) as { name: string; cnt: number }[]

    return {
        tags: tagsRows.map(r => ({ name: r.name, count: r.cnt })),
        entryTypes: entryTypesRows.map(r => ({ name: r.name, count: r.cnt })),
    }
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
        includeArchived?: boolean
        workspaceId?: string
    }
): { entries: JournalEntry[]; nextCursor?: string } {
    const { db, tagsMgr } = context

    let start = startDate
    if (!start.includes('T')) start += 'T00:00:00.000Z'

    const conditions = ['e.deleted_at IS NULL', 'e.timestamp >= ?']
    const params: unknown[] = [start]

    const targetWs = options?.workspaceId ?? 'default';
    if (targetWs !== '*') {
        conditions.push('e.workspace_id = ?');
        params.push(targetWs);
    }

    if (!options?.includeArchived) {
        conditions.push('e.is_archived = 0')
    }

    if (endDate) {
        conditions.push('e.timestamp <= ?')
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
        query += `LEFT JOIN anchor_stats ans ON e.id = ans.entry_id `
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
