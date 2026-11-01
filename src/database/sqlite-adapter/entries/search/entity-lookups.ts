import type { JournalEntry, EntryType } from '../../../../types/index.js'
import {
    ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { sanitizeFtsQuery } from './fts-sanitizer.js'

export function getEntriesByProject(
    context: EntriesSharedContext,
    projectNumber: number,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [projectNumber]
    let wsFilter = ''
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND project_number = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
}

export function getEntriesByIssue(
    context: EntriesSharedContext,
    issueNumber: number,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [issueNumber]
    let wsFilter = ''
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND issue_number = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
}

export function getEntriesByPR(
    context: EntriesSharedContext,
    prNumber: number,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [prNumber]
    let wsFilter = ''
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND pr_number = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
}

export function getEntriesByWorkflowRun(
    context: EntriesSharedContext,
    workflowRunId: number,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [workflowRunId]
    let wsFilter = ''
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND workflow_run_id = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
}

export function getEntriesBySession(
    context: EntriesSharedContext,
    sessionId: string,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [sessionId]
    let wsFilter = ''
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND session_id = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const fromClause = useFts
        ? `FROM fts_content fts CROSS JOIN memory_journal e ON e.id = fts.rowid`
        : `FROM memory_journal e`

    const tagsSql = `
        SELECT t.name, COUNT(DISTINCT e.id) AS cnt
        ${fromClause}
        JOIN entry_tags et ON e.id = et.entry_id
        JOIN tags t ON et.tag_id = t.id
        ${whereClause}
        GROUP BY t.name ORDER BY cnt DESC LIMIT 20
    `

    const entryTypesJoinTags =
        options?.tags !== undefined && options.tags.length > 0
            ? `JOIN entry_tags et ON e.id = et.entry_id JOIN tags t ON et.tag_id = t.id`
            : ''
    const entryTypesSql = `
        SELECT e.entry_type AS name, COUNT(DISTINCT e.id) AS cnt
        ${fromClause}
        ${entryTypesJoinTags}
        ${whereClause}
        GROUP BY e.entry_type ORDER BY cnt DESC
    `

    const tagsStmt = db.prepare(tagsSql)
    const entryTypesStmt = db.prepare(entryTypesSql)

    const tagsRows = tagsStmt.all(params) as { name: string; cnt: number }[]
    const entryTypesRows = entryTypesStmt.all(params) as { name: string; cnt: number }[]

    return {
        tags: tagsRows.map((r) => ({ name: r.name, count: r.cnt })),
        entryTypes: entryTypesRows.map((r) => ({ name: r.name, count: r.cnt })),
    }
}
