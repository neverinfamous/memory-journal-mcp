import type { JournalEntry, EntryType, EntryRevision } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/schema.js'
import { ENTRY_COLUMNS, type EntriesSharedContext, rowToEntry, rowToObject, rowsToEntries } from './shared.js'

export function createEntry(context: EntriesSharedContext, input: CreateEntryInput): JournalEntry {
    const { db, tagsMgr } = context

    let timestamp = input.timestamp ?? new Date().toISOString()

    // Accept broad ISO-8601 input shapes, then normalize to canonical UTC ISO format for storage.
    if (!timestamp.includes('T')) {
        timestamp = `${timestamp}T00:00:00.000Z`
    } else {
        const parsedTimestamp = new Date(timestamp)
        if (Number.isNaN(parsedTimestamp.getTime())) {
            throw new Error(
                `Invalid timestamp format: ${timestamp}. Expected an ISO 8601 date or timestamp.`
            )
        }
        timestamp = parsedTimestamp.toISOString()
    }

    let insertId!: number
    const txn = db.transaction(() => {
        // Build dynamic columns and values
        const columns = [
            'entry_type',
            'content',
            'timestamp',
            'is_personal',
            'significance_type',
            'auto_context',
            'project_number',
            'project_owner',
            'issue_number',
            'issue_url',
            'pr_number',
            'pr_url',
            'pr_status',
            'workflow_run_id',
            'workflow_name',
            'workflow_status',
            'is_archived',
        ]
        const values = [
            input.entryType ?? 'personal_reflection',
            input.content,
            timestamp,
            (input.isPersonal ?? true) ? 1 : 0,
            input.significanceType || null,
            input.autoContext ?? null,
            input.projectNumber ?? null,
            input.projectOwner || null,
            input.issueNumber ?? null,
            input.issueUrl || null,
            input.prNumber ?? null,
            input.prUrl || null,
            input.prStatus || null,
            input.workflowRunId ?? null,
            input.workflowName || null,
            input.workflowStatus || null,
            input.isArchived ? 1 : 0,
        ]

        if (input.author !== undefined) {
            columns.push('author')
            values.push(input.author)
        }

        const placeholders = columns.map(() => '?').join(', ')
        const stmt = db.prepare(
            `INSERT INTO memory_journal (${columns.join(', ')}) VALUES (${placeholders})`
        )
        const result = stmt.run(...values)
        insertId = result.lastInsertRowid as number

        // Link tags
        if (input.tags && input.tags.length > 0) {
            const formattedTags = input.tags.map((t) =>
                t
                    .toLowerCase()
                    .replace(/[^a-z0-9:@]+/g, '-')
                    .replace(/^-+|-+$/g, '')
            )
            tagsMgr.linkTagsToEntry(insertId, formattedTags)
        }
    })

    txn()

    const entry = getEntryById(context, insertId)
    if (!entry) {
        throw new Error(
            `Storage Inconsistency Anomaly: Entry with ID ${insertId} successfully written but could not be read back.`
        )
    }
    return entry
}

export function getEntryById(context: EntriesSharedContext, id: number): JournalEntry | null {
    const { db, tagsMgr } = context
    const stmt = db.prepare(
        `SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ? AND deleted_at IS NULL`
    )
    const row = rowToObject(stmt.get(id))

    if (!row) {
        return null
    }

    return rowToEntry(tagsMgr, row)
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
    id: number
): JournalEntry | null {
    const { db, tagsMgr } = context
    const stmt = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE id = ?`)
    const row = rowToObject(stmt.get(id))

    if (!row) {
        return null
    }

    return rowToEntry(tagsMgr, row)
}

export function getActiveEntryCount(context: EntriesSharedContext): number {
    const { db } = context
    const stmt = db.prepare('SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL')
    const row = rowToObject(stmt.get())
    return (row?.['count'] as number) || 0
}

export function updateEntry(
    context: EntriesSharedContext,
    id: number,
    input: {
        content?: string
        entryType?: EntryType
        tags?: string[]
        isPersonal?: boolean
        significanceType?: string | null
        autoContext?: string | null
        projectNumber?: number | null
        projectOwner?: string | null
        issueNumber?: number | null
        issueUrl?: string | null
        prNumber?: number | null
        prUrl?: string | null
        prStatus?: string | null
        workflowRunId?: number | null
        workflowName?: string | null
        workflowStatus?: string | null
        isArchived?: boolean
    }
): JournalEntry | null {
    const { db, tagsMgr } = context

    // Check existence first
    const existing = getEntryById(context, id)
    if (!existing) return null

    const updates: string[] = []
    const values: unknown[] = []

    if (input.entryType !== undefined) {
        updates.push('entry_type = ?')
        values.push(input.entryType)
    }
    if (input.content !== undefined) {
        updates.push('content = ?')
        values.push(input.content)
    }
    if (input.isPersonal !== undefined) {
        updates.push('is_personal = ?')
        values.push(input.isPersonal ? 1 : 0)
    }
    if (input.significanceType !== undefined) {
        updates.push('significance_type = ?')
        values.push(input.significanceType)
    }
    if (input.autoContext !== undefined) {
        updates.push('auto_context = ?')
        values.push(input.autoContext ?? null)
    }
    if (input.isArchived !== undefined) {
        updates.push('is_archived = ?')
        values.push(input.isArchived ? 1 : 0)
    }
    // GitHub extensions
    for (const key of [
        'projectNumber',
        'projectOwner',
        'issueNumber',
        'issueUrl',
        'prNumber',
        'prUrl',
        'prStatus',
        'workflowRunId',
        'workflowName',
        'workflowStatus',
    ] as const) {
        if (input[key] !== undefined) {
            const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
            updates.push(`${snakeKey} = ?`)
            values.push(input[key] ?? null)
        }
    }

    if (updates.length > 0) {
        const query = `UPDATE memory_journal SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`
        
        const txn = db.transaction(() => {
            // Snapshot creation
            const maxRevStmt = db.prepare('SELECT MAX(revision_number) as maxRev FROM entry_revisions WHERE entry_id = ?')
            const maxRevRow = maxRevStmt.get(id) as { maxRev: number | null }
            const nextRev = (maxRevRow.maxRev ?? 0) + 1

            const snapshotStmt = db.prepare(
                'INSERT INTO entry_revisions (entry_id, revision_number, content_snapshot, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
            )
            snapshotStmt.run(id, nextRev, existing.content, new Date().toISOString(), null)

            // Evict oldest (keep last 10)
            const evictStmt = db.prepare(`
                DELETE FROM entry_revisions 
                WHERE entry_id = ? 
                  AND revision_number IN (
                      SELECT revision_number FROM entry_revisions 
                      WHERE entry_id = ? 
                      ORDER BY revision_number DESC 
                      LIMIT -1 OFFSET 10
                  )
            `)
            evictStmt.run(id, id)

            const stmt = db.prepare(query)
            return stmt.run(...values, id)
        })

        const result = txn()
        if (result.changes === 0) return null
    }

    if (input.tags !== undefined) {
        db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id)
        const formattedTags = input.tags.map((t) =>
            t
                .toLowerCase()
                .replace(/[^a-z0-9:@]+/g, '-')
                .replace(/^-+|-+$/g, '')
        )
        tagsMgr.linkTagsToEntry(id, formattedTags)
    }

    return getEntryById(context, id)
}

export function deleteEntry(context: EntriesSharedContext, id: number, permanent = false): boolean {
    const { db } = context

    if (permanent) {
        const stmt = db.prepare('DELETE FROM memory_journal WHERE id = ?')
        const result = stmt.run(id)
        return result.changes > 0
    }

    const stmt = db.prepare(
        `UPDATE memory_journal SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`
    )
    const result = stmt.run(new Date().toISOString(), id)
    return result.changes > 0
}

export function createEntries(
    context: EntriesSharedContext,
    inputs: CreateEntryInput[]
): JournalEntry[] {
    const { db, tagsMgr } = context
    if (inputs.length === 0) return []

    const insertIds: number[] = []

    const txn = db.transaction(() => {
        for (const input of inputs) {
            let timestamp = input.timestamp ?? new Date().toISOString()
            if (!timestamp.includes('T')) {
                timestamp = `${timestamp}T00:00:00.000Z`
            } else {
                const parsedTimestamp = new Date(timestamp)
                if (Number.isNaN(parsedTimestamp.getTime())) {
                    throw new Error(
                        `Invalid timestamp format: ${timestamp}. Expected an ISO 8601 date or timestamp.`
                    )
                }
                timestamp = parsedTimestamp.toISOString()
            }

            const columns = [
                'entry_type',
                'content',
                'timestamp',
                'is_personal',
                'significance_type',
                'auto_context',
                'project_number',
                'project_owner',
                'issue_number',
                'issue_url',
                'pr_number',
                'pr_url',
                'pr_status',
                'workflow_run_id',
                'workflow_name',
                'workflow_status',
                'is_archived',
            ]
            const values = [
                input.entryType ?? 'personal_reflection',
                input.content,
                timestamp,
                (input.isPersonal ?? true) ? 1 : 0,
                input.significanceType || null,
                input.autoContext ?? null,
                input.projectNumber ?? null,
                input.projectOwner || null,
                input.issueNumber ?? null,
                input.issueUrl || null,
                input.prNumber ?? null,
                input.prUrl || null,
                input.prStatus || null,
                input.workflowRunId ?? null,
                input.workflowName || null,
                input.workflowStatus || null,
                input.isArchived ? 1 : 0,
            ]

            if (input.author !== undefined) {
                columns.push('author')
                values.push(input.author)
            }

            const placeholders = columns.map(() => '?').join(', ')
            const stmt = db.prepare(
                `INSERT INTO memory_journal (${columns.join(', ')}) VALUES (${placeholders})`
            )
            const result = stmt.run(...values)
            const insertId = result.lastInsertRowid as number
            insertIds.push(insertId)

            if (input.tags && input.tags.length > 0) {
                const formattedTags = input.tags.map((t) =>
                    t
                        .toLowerCase()
                        .replace(/[^a-z0-9:@]+/g, '-')
                        .replace(/^-+|-+$/g, '')
                )
                tagsMgr.linkTagsToEntry(insertId, formattedTags)
            }
        }
    })

    txn()

    const resultsMap = getEntriesByIds(context, insertIds)
    return insertIds.map(id => resultsMap.get(id)).filter((entry): entry is JournalEntry => entry !== undefined)
}

export function updateEntries(
    context: EntriesSharedContext,
    updates: {
        id: number
        content?: string
        entryType?: EntryType
        tags?: string[]
        isPersonal?: boolean
        significanceType?: string | null
        autoContext?: string | null
        projectNumber?: number | null
        projectOwner?: string | null
        issueNumber?: number | null
        issueUrl?: string | null
        prNumber?: number | null
        prUrl?: string | null
        prStatus?: string | null
        workflowRunId?: number | null
        workflowName?: string | null
        workflowStatus?: string | null
        isArchived?: boolean
    }[]
): { updated: JournalEntry[]; notFound: number[] } {
    const { db } = context
    if (updates.length === 0) return { updated: [], notFound: [] }

    const notFound: number[] = []
    const updatedIds: number[] = []

    const txn = db.transaction(() => {
        for (const input of updates) {
            const entry = updateEntry(context, input.id, input)
            if (entry) {
                updatedIds.push(input.id)
            } else {
                notFound.push(input.id)
            }
        }
    })

    txn()

    const resultsMap = getEntriesByIds(context, updatedIds)
    const updated = updatedIds.map(id => resultsMap.get(id)).filter((entry): entry is JournalEntry => entry !== undefined)

    return { updated, notFound }
}

export function deleteEntries(
    context: EntriesSharedContext,
    ids: number[],
    permanent = false
): { deleted: number[]; notFound: number[] } {
    const { db } = context
    if (ids.length === 0) return { deleted: [], notFound: [] }

    const placeholders = ids.map(() => '?').join(', ')

    // To figure out which ones were not found, we can query before deleting, or just rely on the count if we don't need exact missing IDs.
    // However, the spec says "notFound: number[]" so we should determine which ones actually existed.
    // For simplicity, we can fetch existing IDs first, or just accept that returning exact missing ones requires a SELECT.
    const existingRows = db.prepare(`SELECT id FROM memory_journal WHERE id IN (${placeholders}) ${permanent ? '' : 'AND deleted_at IS NULL'}`).all(...ids) as { id: number }[]
    const existingIds = new Set(existingRows.map(r => r.id))
    const notFound = ids.filter(id => !existingIds.has(id))
    const toDelete = ids.filter(id => existingIds.has(id))

    if (toDelete.length > 0) {
        const deletePlaceholders = toDelete.map(() => '?').join(', ')
        if (permanent) {
            const stmt = db.prepare(`DELETE FROM memory_journal WHERE id IN (${deletePlaceholders})`)
            stmt.run(...toDelete)
        } else {
            const stmt = db.prepare(`UPDATE memory_journal SET deleted_at = ? WHERE id IN (${deletePlaceholders}) AND deleted_at IS NULL`)
            stmt.run(new Date().toISOString(), ...toDelete)
        }
    }

    return { deleted: toDelete, notFound }
}

export function getEntryHistory(
    context: EntriesSharedContext,
    id: number
): EntryRevision[] {
    const { db } = context
    
    const stmt = db.prepare(`
        SELECT id, entry_id as entryId, revision_number as revisionNumber,
               content_snapshot as contentSnapshot, changed_at as changedAt,
               changed_by as changedBy
        FROM entry_revisions
        WHERE entry_id = ?
        ORDER BY revision_number DESC
    `)
    
    const rows = stmt.all(id) as EntryRevision[]
    return rows
}

export function restoreEntry(context: EntriesSharedContext, id: number): boolean {
    const { db } = context
    const stmt = db.prepare('UPDATE memory_journal SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
    const result = stmt.run(id)
    return result.changes > 0
}

export function getDeletedEntries(
    context: EntriesSharedContext,
    options?: { limit?: number; offset?: number }
): { entries: JournalEntry[]; count: number } {
    const { db, tagsMgr } = context
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    const countStmt = db.prepare('SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NOT NULL')
    const countRow = rowToObject(countStmt.get())
    const count = (countRow?.['count'] as number) || 0

    const stmt = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM memory_journal WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ? OFFSET ?`)
    const rows = stmt.all([limit, offset])
    const entries = rowsToEntries(tagsMgr, rows)

    return { entries, count }
}

