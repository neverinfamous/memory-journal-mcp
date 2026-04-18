import type { JournalEntry, EntryType } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/schema.js'
import { ENTRY_COLUMNS, type EntriesSharedContext, rowToEntry, rowToObject } from './shared.js'

export function createEntry(context: EntriesSharedContext, input: CreateEntryInput): JournalEntry {
    const { db, tagsMgr } = context

    let timestamp = input.timestamp ?? new Date().toISOString()
    // SQLite expects standard ISO format
    if (!timestamp.includes('T')) {
        timestamp += 'T00:00:00.000Z'
    }

    let insertId!: number
    const txn = db.transaction(() => {
        // Build dynamic columns and values
        const columns = [
            'entry_type', 'content', 'timestamp', 'is_personal', 'significance_type', 'auto_context',
            'project_number', 'project_owner', 'issue_number', 'issue_url', 'pr_number', 'pr_url', 'pr_status',
            'workflow_run_id', 'workflow_name', 'workflow_status'
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
            input.workflowStatus || null
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
            tagsMgr.linkTagsToEntry(insertId, input.tags)
        }
    })

    txn()

    const entry = getEntryById(context, insertId)
    if (!entry) {
        // Fallback: the write committed successfully, but the readback failed.
        // Return a constructed entry so the caller knows the write succeeded instead
        // of throwing an error and masking the successful write.
        console.warn(`[crud.ts] Write succeeded but getEntryById returned null for ID ${insertId}. Returning partial entry to avoid false-failure signal.`)
        return {
            id: insertId,
            content: input.content,
            entryType: input.entryType ?? 'personal_reflection',
            tags: input.tags ?? [],
            isPersonal: input.isPersonal ?? true,
            significanceType: input.significanceType ?? null,
            autoContext: input.autoContext ?? null,
            projectNumber: input.projectNumber ?? null,
            projectOwner: input.projectOwner ?? null,
            issueNumber: input.issueNumber ?? null,
            issueUrl: input.issueUrl ?? null,
            prNumber: input.prNumber ?? null,
            prUrl: input.prUrl ?? null,
            prStatus: input.prStatus ?? null,
            workflowRunId: input.workflowRunId ?? null,
            workflowName: input.workflowName ?? null,
            workflowStatus: input.workflowStatus ?? null,
            timestamp: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null
        } as JournalEntry
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
        significanceType?: string
        autoContext?: string | null
        projectNumber?: number
        projectOwner?: string
        issueNumber?: number
        issueUrl?: string
        prNumber?: number
        prUrl?: string
        prStatus?: string
        workflowRunId?: number
        workflowName?: string
        workflowStatus?: string
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
        const stmt = db.prepare(query)
        const result = stmt.run(...values, id)
        if (result.changes === 0) return null
    }

    if (input.tags !== undefined) {
        db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id)
        tagsMgr.linkTagsToEntry(id, input.tags)
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
