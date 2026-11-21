import type { JournalEntry } from '../../../../types/index.js'
import {
    ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowsToEntries,
} from '../shared.js'
import { effectiveWorkspace } from '../../../workspace-scope.js'

export { getSearchFacets, type SearchFacetOptions } from './facets.js'

export function getEntriesAfter(
    context: EntriesSharedContext,
    limit: number,
    order: 'asc' | 'desc' = 'desc',
    workspaceId = 'default',
    projectNumber?: number,
    cursor?: { timestamp: string; id: number }
): JournalEntry[] {
    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const sortDir = order === 'asc' ? 'ASC' : 'DESC'
    const cmpOp = order === 'asc' ? '>' : '<'
    const scoped = scopeId !== '*'
    const pnScoped = projectNumber !== undefined
    const cursorSql =
        cursor !== undefined
            ? ` AND (timestamp ${cmpOp} ? OR (timestamp = ? AND id ${cmpOp} ?))`
            : ''

    const stmt = db.prepare(`
        SELECT ${ENTRY_COLUMNS} FROM memory_journal
        WHERE deleted_at IS NULL${scoped ? ' AND workspace_id = ?' : ''}${pnScoped ? ' AND project_number = ?' : ''}${cursorSql}
        ORDER BY timestamp ${sortDir}, id ${sortDir}
        LIMIT ?
    `)
    const params: unknown[] = []
    if (scoped) params.push(scopeId)
    if (pnScoped) params.push(projectNumber)
    if (cursor !== undefined) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
    params.push(limit)
    return rowsToEntries(tagsMgr, stmt.all(params))
}

export function getLatestEntryPerProject(
    context: EntriesSharedContext
): Map<string, { id: number; timestamp: string; entryType: string }> {
    const rows = context.db
        .prepare(
            `SELECT workspace_id, project_number, id, timestamp, entry_type
             FROM (
                 SELECT workspace_id, project_number, id, timestamp, entry_type,
                        ROW_NUMBER() OVER (
                            PARTITION BY workspace_id, project_number
                            ORDER BY timestamp DESC, id DESC
                        ) AS rn
                 FROM memory_journal
                 WHERE deleted_at IS NULL AND project_number IS NOT NULL
             )
             WHERE rn = 1`
        )
        .all() as {
        workspace_id: string | null
        project_number: number
        id: number
        timestamp: string
        entry_type: string
    }[]
    const map = new Map<string, { id: number; timestamp: string; entryType: string }>()
    for (const r of rows) {
        const ws = r.workspace_id ?? 'default'
        map.set(`${ws}:${String(r.project_number)}`, {
            id: r.id,
            timestamp: r.timestamp,
            entryType: r.entry_type,
        })
    }
    return map
}

export function getEntriesByProject(
    context: EntriesSharedContext,
    projectNumber: number,
    limit = 50,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    const params: unknown[] = [projectNumber]
    let wsFilter = ''
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(scopeId)
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
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(scopeId)
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
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(scopeId)
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
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(scopeId)
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
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        params.push(scopeId)
    }
    params.push(limit)
    const rows = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL AND session_id = ?${wsFilter} ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(...params)
    return rowsToEntries(tagsMgr, rows)
}
