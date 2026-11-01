import type { JournalEntry } from '../../../types/index.js'
import {
    ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowToEntry,
    rowToObject,
    rowsToEntries,
} from './shared.js'

export function getEntryById(
    context: EntriesSharedContext,
    id: number,
    workspaceId = 'default'
): JournalEntry | null {
    const { db, tagsMgr } = context
    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ? AND deleted_at IS NULL`
    )
    const row = rowToObject(stmt.get(id))

    if (row === undefined) {
        return null
    }

    const entry = rowToEntry(tagsMgr, row)
    if (workspaceId !== '*' && entry.workspaceId !== workspaceId) {
        return null
    }
    return entry
}

export function getEntriesByIds(
    context: EntriesSharedContext,
    ids: number[]
): Map<number, JournalEntry> {
    const result = new Map<number, JournalEntry>()
    if (ids.length === 0) return result

    const { db, tagsMgr } = context
    const placeholders = ids.map(() => '?').join(', ')
    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    )
    const rows = stmt.all(ids)

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

export function getEntryByIdIncludeDeleted(
    context: EntriesSharedContext,
    id: number,
    workspaceId = 'default'
): JournalEntry | null {
    const { db, tagsMgr } = context
    const stmt = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ?`)
    const row = rowToObject(stmt.get(id))

    if (row === undefined) {
        return null
    }

    const entry = rowToEntry(tagsMgr, row)
    if (workspaceId !== '*' && entry.workspaceId !== workspaceId) {
        return null
    }
    return entry
}

export function getActiveEntries(
    context: EntriesSharedContext,
    workspaceId?: string
): JournalEntry[] {
    const { db, tagsMgr } = context
    let query = `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NULL`
    const params: unknown[] = []
    if (workspaceId !== undefined && workspaceId !== '*') {
        query += ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    query += ' ORDER BY timestamp DESC, id DESC'
    const rows = db.prepare(query).all(...params)
    return rowsToEntries(tagsMgr, rows)
}

export function getActiveEntryCount(context: EntriesSharedContext, workspaceId?: string): number {
    const { db } = context
    let query = 'SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL'
    const params: unknown[] = []
    if (workspaceId !== undefined && workspaceId !== '*') {
        query += ' AND workspace_id = ?'
        params.push(workspaceId)
    }
    const stmt = db.prepare(query)
    const row = rowToObject(stmt.get(...params))
    return typeof row?.['count'] === 'number' ? row['count'] : 0
}

export function getDeletedEntries(
    context: EntriesSharedContext,
    options?: { limit?: number; offset?: number; workspaceId?: string }
): { entries: JournalEntry[]; count: number } {
    const { db, tagsMgr } = context
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const workspaceId = options?.workspaceId

    let wsFilter = ''
    const wsParams: unknown[] = []
    if (workspaceId !== undefined && workspaceId !== '*') {
        wsFilter = ' AND workspace_id = ?'
        wsParams.push(workspaceId)
    }

    const countStmt = db.prepare(
        `SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NOT NULL${wsFilter}`
    )
    const countRow = rowToObject(countStmt.get(...wsParams))
    const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0

    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NOT NULL${wsFilter} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`
    )
    const rows = stmt.all(...wsParams, limit, offset)
    const entries = rowsToEntries(tagsMgr, rows)

    return { entries, count }
}
