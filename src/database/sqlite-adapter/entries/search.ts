import type { JournalEntry, EntryType } from '../../../types/index.js'
import {
    ENTRY_COLUMNS,
    ALIASED_ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from './shared.js'

export function getRecentEntries(context: EntriesSharedContext, limit: number): JournalEntry[] {
    const { db, tagsMgr } = context
    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL 
        ORDER BY timestamp DESC, id DESC LIMIT ?
    `)
    const rows = stmt.all([limit])
    return rowsToEntries(tagsMgr, rows)
}

export function getEntriesPage(
    context: EntriesSharedContext,
    offset: number,
    limit: number,
    order: 'asc' | 'desc' = 'desc'
): JournalEntry[] {
    const { db, tagsMgr } = context

    const sortDir = order === 'asc' ? 'ASC' : 'DESC'

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal 
        WHERE deleted_at IS NULL 
        ORDER BY timestamp ${sortDir}, id ${sortDir} 
        LIMIT ? OFFSET ?
    `)
    const rows = stmt.all([limit, offset])

    return rowsToEntries(tagsMgr, rows)
}

export function searchEntries(
    context: EntriesSharedContext,
    queryStr: string,
    options?: {
        limit?: number
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
    }
): JournalEntry[] {
    const { db, tagsMgr } = context

    // Try FTS5 first for relevance-ranked results, fall back to LIKE on syntax error
    if (queryStr.length > 0) {
        try {
            const { sql, params } = buildSearchQuery(queryStr, options, true)
            const stmt = db.prepare(sql)
            const rows = stmt.all(params)
            return rowsToEntries(tagsMgr, rows)
        } catch {
            // FTS5 syntax error (e.g. unbalanced quotes, special chars) — fall back to LIKE
        }
    }

    const { sql, params } = buildSearchQuery(queryStr, options, false)
    const stmt = db.prepare(sql)
    const rows = stmt.all(params)
    return rowsToEntries(tagsMgr, rows)
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
          }
        | undefined,
    useFts: boolean
): { sql: string; params: unknown[] } {
    let query: string
    if (useFts) {
        query = `
            SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS}
            FROM memory_journal e
            JOIN fts_content fts ON fts.rowid = e.id
        `
    } else {
        query = `
            SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS} 
            FROM memory_journal e
        `
    }
    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    if (queryStr.length > 0) {
        if (useFts) {
            conditions.push(`fts_content MATCH ?`)
            params.push(sanitizeFtsQuery(queryStr))
        } else {
            conditions.push(`e.content LIKE '%' || ? || '%'`)
            params.push(queryStr)
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

    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
    }

    // FTS5: rank by relevance (BM25), then timestamp for tiebreaking
    // LIKE/no-query: rank by timestamp only
    if (useFts) {
        query += ` ORDER BY rank, e.timestamp DESC, e.id DESC`
    } else {
        query += ` ORDER BY e.timestamp DESC, e.id DESC`
    }

    query += ` LIMIT ?`
    params.push(options?.limit ?? 10)

    return { sql: query, params }
}

export function searchByDateRange(
    context: EntriesSharedContext,
    startDate: string,
    endDate: string,
    options?: {
        entryType?: EntryType
        tags?: string[]
        isPersonal?: boolean
        projectNumber?: number
        issueNumber?: number
        prNumber?: number
        workflowRunId?: number
        limit?: number
    }
): JournalEntry[] {
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

    let query = `
        SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS} FROM memory_journal e
    `

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

    query += ` WHERE ${conditions.join(' AND ')} ORDER BY e.timestamp DESC, e.id DESC`

    query += ` LIMIT ?`
    params.push(options?.limit ?? 500)

    const stmt = db.prepare(query)
    const rows = stmt.all(params)

    return rowsToEntries(tagsMgr, rows)
}

// ============================================================================
// FTS5 Helpers
// ============================================================================

/**
 * Sanitize an FTS5 query string to handle porter-stemmer phrase mismatch.
 *
 * FTS5 phrase queries (e.g. `"error handling"`) require exact token sequences.
 * However the porter stemmer stores stems: `handling` → `handl`, so the phrase
 * `"error handling"` never matches even when the content contains "error handling".
 *
 * Fix: detect a *pure* quoted phrase (the entire query is one quoted phrase)
 * and rewrite it as AND-joined individual terms. This lets the stemmer apply
 * to each word and correctly finds documents containing all the terms.
 *
 * Non-phrase queries are passed through unchanged.
 *
 * Examples:
 *   `"error handling"` → `error AND handling`
 *   `deploy OR release` → `deploy OR release` (unchanged)
 *   `auth*` → `auth*` (unchanged)
 *   `deploy NOT staging` → `deploy NOT staging` (unchanged)
 */
function sanitizeFtsQuery(query: string): string {
    const trimmed = query.trim()
    // Pure phrase: starts and ends with double-quote, no other quotes inside
    if (
        trimmed.startsWith('"') &&
        trimmed.endsWith('"') &&
        trimmed.length > 2 &&
        !trimmed.slice(1, -1).includes('"')
    ) {
        const inner = trimmed.slice(1, -1).trim()
        // Split on whitespace, drop empty tokens, join with AND
        const words = inner.split(/\s+/).filter(Boolean)
        if (words.length > 1) {
            return words.join(' AND ')
        }
        // Single-word phrase: strip quotes (no AND needed)
        return inner
    }
    return query
}
