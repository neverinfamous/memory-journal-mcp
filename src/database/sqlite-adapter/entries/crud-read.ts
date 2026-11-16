import type { JournalEntry } from '../../../types/index.js'
import {
    ENTRY_COLUMNS,
    type EntriesSharedContext,
    rowToEntry,
    rowToObject,
    rowsToEntries,
} from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

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

    const entry = rowToEntry(tagsMgr, row)
    if (scopeId !== '*' && entry.workspaceId !== scopeId) {
        return null
    }
    return entry
}

export function getEntriesByIds(
    context: EntriesSharedContext,
    ids: number[],
    workspaceId?: string
): Map<number, JournalEntry> {
    const result = new Map<number, JournalEntry>()
    if (ids.length === 0) return result

    const { db, tagsMgr } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const CHUNK_SIZE = 500
    const rows: unknown[] = []
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(', ')
        const stmt = db.prepare(
            scopeId === '*'
                ? `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id IN (${placeholders}) AND deleted_at IS NULL`
                : `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id IN (${placeholders}) AND deleted_at IS NULL AND workspace_id = ?`
        )
        const chunkRows = scopeId === '*' ? stmt.all(...chunk) : stmt.all(...chunk, scopeId)
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

    const entry = rowToEntry(tagsMgr, row)
    if (scopeId !== '*' && entry.workspaceId !== scopeId) {
        return null
    }
    return entry
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
    if (typeof projectNumber === 'number' && projectNumber > 0) {
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
    if (typeof options?.projectNumber === 'number') {
        scopeFilter += ' AND project_number = ?'
        scopeParams.push(options.projectNumber)
    }

    const countStmt = db.prepare(
        `SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NOT NULL${scopeFilter}`
    )
    const countRow = rowToObject(countStmt.get(...scopeParams))
    const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0

    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NOT NULL${scopeFilter} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`
    )
    const rows = stmt.all(...scopeParams, limit, offset)
    const entries = rowsToEntries(tagsMgr, rows)

    return { entries, count }
}
