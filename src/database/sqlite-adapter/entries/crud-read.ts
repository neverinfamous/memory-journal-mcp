import type { JournalEntry } from '../../../types/index.js'
import {
    ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowToEntry,
    rowsToEntries,
    rowToObject,
} from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { bucketInParams, SCOPED_IN_PARAM_BUCKETS } from '../row-helpers.js'

export function getEntryById(
    context: EntriesSharedContext,
    id: number,
    workspaceId = 'default'
): JournalEntry | null {
    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ? AND deleted_at IS NULL`
    )
    const row = rowToObject(stmt.get(id))

    if (row === undefined) {
        return null
    }

    if (scopeId !== '*' && row['workspaceId'] !== scopeId) {
        return null
    }
    return rowToEntry(tagsMgr, row)
}

function fetchEntriesByIds(
    context: EntriesSharedContext,
    ids: number[],
    workspaceId: string | undefined,
    includeDeleted: boolean
): Map<number, JournalEntry> {
    const result = new Map<number, JournalEntry>()
    if (ids.length === 0) return result

    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
    const wsClause = scopeId === '*' ? '' : ' AND workspace_id = ?'
    const rows: unknown[] = []

    for (const { placeholders, params } of bucketInParams(ids, SCOPED_IN_PARAM_BUCKETS)) {
        const stmt = db.prepare(
            `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id IN (${placeholders})${deletedClause}${wsClause}`
        )
        const chunkRows = scopeId === '*' ? stmt.all(...params) : stmt.all(...params, scopeId)
        rows.push(...chunkRows)
    }

    if (rows.length === 0) return result

    const entries = rows.map((r) => {
        const p = r as Partial<JournalEntry>
        return {
            ...p,
            isPersonal: Boolean(p.isPersonal),
            isArchived: Boolean(p.isArchived),
            tags: [],
        } as JournalEntry
    })

    const entryIds = entries.map((e) => e.id)
    const tagsMap = tagsMgr.batchGetTagsForEntries(entryIds)

    for (const entry of entries) {
        entry.tags = tagsMap.get(entry.id) ?? []
        result.set(entry.id, entry)
    }

    return result
}

export function getEntriesByIds(
    context: EntriesSharedContext,
    ids: number[],
    workspaceId?: string
): Map<number, JournalEntry> {
    return fetchEntriesByIds(context, ids, workspaceId, false)
}

export function getEntriesByIdsIncludeDeleted(
    context: EntriesSharedContext,
    ids: number[],
    workspaceId?: string
): Map<number, JournalEntry> {
    return fetchEntriesByIds(context, ids, workspaceId, true)
}

export function getEntryByIdIncludeDeleted(
    context: EntriesSharedContext,
    id: number,
    workspaceId = 'default'
): JournalEntry | null {
    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const stmt = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ?`)
    const row = rowToObject(stmt.get(id))

    if (row === undefined) {
        return null
    }

    if (scopeId !== '*' && row['workspaceId'] !== scopeId) {
        return null
    }
    return rowToEntry(tagsMgr, row)
}

export function getActiveEntryCount(
    context: EntriesSharedContext,
    workspaceId?: string,
    projectNumber?: number
): number {
    const { db } = context
    let query = 'SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL'
    const params: unknown[] = []
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        query += ' AND workspace_id = ?'
        params.push(scopeId)
    }
    if (projectNumber !== undefined) {
        if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
            return 0
        }
        query += ' AND project_number = ?'
        params.push(projectNumber)
    }
    const stmt = db.prepare(query)
    const row = rowToObject(stmt.get(...params))
    return typeof row?.['count'] === 'number' ? row['count'] : 0
}

export function getDeletedEntries(
    context: EntriesSharedContext,
    options?: { limit?: number; offset?: number; workspaceId?: string; projectNumber?: number }
): { entries: JournalEntry[]; count: number } {
    const { db, tagsMgr } = context
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const scopeId = effectiveWorkspace(options?.workspaceId)

    let scopeFilter = ''
    const scopeParams: unknown[] = []
    if (scopeId !== '*') {
        scopeFilter += ' AND workspace_id = ?'
        scopeParams.push(scopeId)
    }
    if (options?.projectNumber !== undefined) {
        if (!Number.isSafeInteger(options.projectNumber) || options.projectNumber <= 0) {
            return { entries: [], count: 0 }
        }
        scopeFilter += ' AND project_number = ?'
        scopeParams.push(options.projectNumber)
    }

    const countStmt = db.prepare(
        `SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NOT NULL${scopeFilter}`
    )
    const countRow = rowToObject(countStmt.get(...scopeParams))
    const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0
    if (count === 0 || offset >= count) {
        return { entries: [], count }
    }

    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NOT NULL${scopeFilter} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`
    )
    const rows = stmt.all(...scopeParams, limit, offset)
    const entries = rowsToEntries(tagsMgr, rows)

    return { entries, count }
}
