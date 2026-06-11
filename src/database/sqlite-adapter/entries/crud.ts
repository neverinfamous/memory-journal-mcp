import type { JournalEntry, EntryType, EntryRevision } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/schema.js'
import { ENTRY_COLUMNS, type EntriesSharedContext, rowToEntry, rowToObject, rowsToEntries } from './shared.js'
import { ConflictError } from '../../../types/errors.js'

class BatchTransactionError extends Error {
    constructor(public readonly batchError: { index?: number; id?: number; error: Error }) {
        super("Batch transaction failed");
        this.name = "BatchTransactionError";
    }
}

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
        expectedVersion?: number
    }
): JournalEntry | null {
    const { db, tagsMgr } = context

    // Check existence first
    const existing = getEntryById(context, id)
    if (!existing) return null

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new ConflictError(
            `Version conflict: expected ${String(input.expectedVersion)} but found ${String(existing.version)}`,
            existing as unknown as Record<string, unknown>
        )
    }

    const updates: string[] = ['version = version + 1']
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
): { created: JournalEntry[]; errors: { index: number; error: Error }[] } {
    if (inputs.length === 0) return { created: [], errors: [] }

    const { db } = context
    const createdIds: number[] = []
    const errors: { index: number; error: Error }[] = []

    const txn = db.transaction(() => {
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i]
            if (!input) continue
            try {
                // Nested transactions are implemented as savepoints by better-sqlite3.
                // This ensures all creations share a single top-level transaction and fsync.
                const newEntry = createEntry(context, input)
                createdIds.push(newEntry.id)
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                throw new BatchTransactionError({ index: i, error });
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.index !== undefined) {
            errors.push({ index: err.batchError.index, error: err.batchError.error });
        } else {
            errors.push({ index: -1, error: err instanceof Error ? err : new Error(String(err)) });
        }
        return { created: [], errors };
    }

    const resultsMap = getEntriesByIds(context, createdIds)
    const created = createdIds.map(id => resultsMap.get(id)).filter((entry): entry is JournalEntry => entry !== undefined)
    
    return { created, errors }
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
        expectedVersion?: number
    }[]
): { updated: JournalEntry[]; notFound: number[]; errors: { id: number; error: Error }[] } {
    if (updates.length === 0) return { updated: [], notFound: [], errors: [] }

    const { db } = context
    const notFound: number[] = []
    const updatedIds: number[] = []
    const errors: { id: number; error: Error }[] = []

    const txn = db.transaction(() => {
        for (const input of updates) {
            try {
                const entry = updateEntry(context, input.id, input)
                if (entry) {
                    updatedIds.push(input.id)
                } else {
                    notFound.push(input.id)
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                throw new BatchTransactionError({ id: input.id, error });
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.id !== undefined) {
            errors.push({ id: err.batchError.id, error: err.batchError.error });
        } else {
            errors.push({ id: -1, error: err instanceof Error ? err : new Error(String(err)) });
        }
        return { updated: [], notFound: [], errors };
    }

    const resultsMap = getEntriesByIds(context, updatedIds)
    const updated = updatedIds.map(id => resultsMap.get(id)).filter((entry): entry is JournalEntry => entry !== undefined)

    return { updated, notFound, errors }
}

export function deleteEntries(
    context: EntriesSharedContext,
    ids: number[],
    permanent = false
): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
    const { db } = context
    if (ids.length === 0) return { deleted: [], notFound: [], errors: [] }

    const placeholders = ids.map(() => '?').join(', ')

    // Determine which IDs actually exist
    const existingRows = db.prepare(`SELECT id FROM memory_journal WHERE id IN (${placeholders}) ${permanent ? '' : 'AND deleted_at IS NULL'}`).all(...ids) as { id: number }[]
    const existingIds = new Set(existingRows.map(r => r.id))
    const notFound = ids.filter(id => !existingIds.has(id))
    const toDelete = ids.filter(id => existingIds.has(id))
    const deleted: number[] = []
    const errors: { id: number; error: Error }[] = []

    const txn = db.transaction(() => {
        for (const id of toDelete) {
            try {
                const success = deleteEntry(context, id, permanent)
                if (success) {
                    deleted.push(id)
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                throw new BatchTransactionError({ id, error });
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.id !== undefined) {
            errors.push({ id: err.batchError.id, error: err.batchError.error });
        } else {
            errors.push({ id: -1, error: err instanceof Error ? err : new Error(String(err)) });
        }
        return { deleted: [], notFound, errors };
    }

    return { deleted, notFound, errors }
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

