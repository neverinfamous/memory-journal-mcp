import type { JournalEntry, EntryType } from '../../../types/index.js'
import { ENTRY_COLUMNS, ALIASED_ENTRY_COLUMNS, type EntriesSharedContext, rowsToEntries } from './shared.js'

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
    let query = `
        SELECT DISTINCT ${ALIASED_ENTRY_COLUMNS} 
        FROM memory_journal e
    `
    const params: unknown[] = []
    const conditions: string[] = ['e.deleted_at IS NULL']

    if (queryStr) {
        conditions.push(`e.content LIKE '%' || ? || '%'`)
        params.push(queryStr)
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

    query += ` ORDER BY e.timestamp DESC, e.id DESC`

    query += ` LIMIT ?`
    params.push(options?.limit ?? 10)

    const stmt = db.prepare(query)
    const rows = stmt.all(params)

    return rowsToEntries(tagsMgr, rows)
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
