import type { JournalEntry, EntryType } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/interfaces.js'
import type { EntriesSharedContext } from './shared.js'
import { ConflictError } from '../../../types/errors.js'
import { insertAnchors } from './anchors.js'
import { getEntryById, getEntriesByIds } from './crud-read.js'

class BatchTransactionError extends Error {
    constructor(public readonly batchError: { index?: number; id?: number; error: Error }) {
        super('Batch transaction failed')
        this.name = 'BatchTransactionError'
    }
}

export function validateEntryInput(input: CreateEntryInput): { normalizedTimestamp: string } {
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

    return { normalizedTimestamp: timestamp }
}

export function createEntry(context: EntriesSharedContext, input: CreateEntryInput): JournalEntry {
    const { db, tagsMgr } = context
    const { normalizedTimestamp: timestamp } = validateEntryInput(input)

    let insertId!: number
    const txn = db.transaction(() => {
        const columns = [
            'entry_type', 'content', 'timestamp', 'is_personal', 'significance_type',
            'auto_context', 'project_number', 'project_owner', 'issue_number', 'issue_url',
            'pr_number', 'pr_url', 'pr_status', 'workflow_run_id', 'workflow_name',
            'workflow_status', 'is_archived', 'workspace_id', 'trust_score',
            'validation_status', 'impact_score', 'session_id',
        ]
        const nonEmpty = (s: string | null | undefined): string | null =>
            s !== undefined && s !== null && s !== '' ? s : null
        const values = [
            input.entryType ?? 'personal_reflection',
            input.content,
            timestamp,
            (input.isPersonal ?? true) ? 1 : 0,
            nonEmpty(input.significanceType),
            input.autoContext ?? null,
            input.projectNumber ?? null,
            nonEmpty(input.projectOwner),
            input.issueNumber ?? null,
            nonEmpty(input.issueUrl),
            input.prNumber ?? null,
            nonEmpty(input.prUrl),
            input.prStatus ?? null,
            input.workflowRunId ?? null,
            nonEmpty(input.workflowName),
            input.workflowStatus ?? null,
            input.isArchived === true ? 1 : 0,
            input.workspaceId ?? 'default',
            input.trustScore ?? 0.5,
            input.validationStatus ?? 'none',
            input.impactScore ?? 0.0,
            input.sessionId ?? null,
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
        insertId = Number(result.lastInsertRowid)

        if (input.tags !== undefined && input.tags.length > 0) {
            const formattedTags = input.tags.map((t) =>
                t
                    .toLowerCase()
                    .replace(/[^a-z0-9:@]+/g, '-')
                    .replace(/^-+|-+$/g, '')
            )
            tagsMgr.linkTagsToEntry(insertId, formattedTags)
        }

        if (input.anchors !== undefined && input.anchors.length > 0) {
            insertAnchors(context, insertId, input.anchors)
        }
    })

    txn()

    const entry = getEntryById(context, insertId, input.workspaceId ?? 'default')
    if (entry === null) {
        throw new Error(
            `Storage Inconsistency Anomaly: Entry with ID ${String(insertId)} successfully written but could not be read back.`
        )
    }
    return entry
}

export interface UpdateEntryInput {
    content?: string | undefined
    entryType?: EntryType | undefined
    tags?: string[] | undefined
    isPersonal?: boolean | undefined
    significanceType?: string | null | undefined
    autoContext?: string | null | undefined
    projectNumber?: number | null | undefined
    projectOwner?: string | null | undefined
    issueNumber?: number | null | undefined
    issueUrl?: string | null | undefined
    prNumber?: number | null | undefined
    prUrl?: string | null | undefined
    prStatus?: string | null | undefined
    workflowRunId?: number | null | undefined
    workflowName?: string | null | undefined
    workflowStatus?: string | null | undefined
    isArchived?: boolean | undefined
    expectedVersion?: number | undefined
    workspaceId?: string | undefined
    trustScore?: number | undefined
    validationStatus?: 'passed' | 'failed' | 'none' | undefined
    impactScore?: number | undefined
    sessionId?: string | null | undefined
    targetWorkspaceId?: string | undefined
}

export function updateEntry(
    context: EntriesSharedContext,
    id: number,
    input: UpdateEntryInput
): JournalEntry | null {
    const { db, tagsMgr } = context

    const existing = getEntryById(context, id, '*')
    if (existing === null) return null

    const callerWorkspace = input.workspaceId ?? 'default'
    if (callerWorkspace !== '*' && existing.workspaceId !== callerWorkspace) {
        throw new ConflictError(
            `Entry ${String(id)} belongs to workspace '${String(existing.workspaceId)}', cannot be updated from '${callerWorkspace}'. Moving to another workspace requires explicit overrides (e.g. workspaceId = '*').`,
            { id: existing.id, version: existing.version, workspaceId: existing.workspaceId }
        )
    }

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new ConflictError(
            `Version conflict: expected ${String(input.expectedVersion)} but found ${String(existing.version)}`,
            {
                id: existing.id,
                version: existing.version,
                content: existing.content,
                workspaceId: existing.workspaceId,
            }
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

    if (input.trustScore !== undefined) {
        updates.push('trust_score = ?')
        values.push(input.trustScore)
    }
    if (input.validationStatus !== undefined) {
        updates.push('validation_status = ?')
        values.push(input.validationStatus)
    }
    if (input.impactScore !== undefined) {
        updates.push('impact_score = ?')
        values.push(input.impactScore)
    }
    if (input.targetWorkspaceId !== undefined && input.targetWorkspaceId !== '*') {
        updates.push('workspace_id = ?')
        values.push(input.targetWorkspaceId)
    }
    if (input.sessionId !== undefined) {
        updates.push('session_id = ?')
        values.push(input.sessionId)
    }

    const query = `UPDATE memory_journal SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`

    const txn = db.transaction(() => {
        const maxRevStmt = db.prepare(
            'SELECT MAX(revision_number) as maxRev FROM entry_revisions WHERE entry_id = ?'
        )
        const maxRevRow = maxRevStmt.get(id) as { maxRev: number | null }
        const nextRev = (maxRevRow.maxRev ?? 0) + 1

        const snapshotStmt = db.prepare(
            'INSERT INTO entry_revisions (entry_id, revision_number, content_snapshot, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
        )
        snapshotStmt.run(id, nextRev, existing.content, new Date().toISOString(), null)

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
        const result = stmt.run(...values, id)
        if (result.changes === 0) return false

        if (input.tags !== undefined) {
            db.prepare(
                'UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id IN (SELECT tag_id FROM entry_tags WHERE entry_id = ?)'
            ).run(id)
            db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id)
            const formattedTags = input.tags.map((t) =>
                t
                    .toLowerCase()
                    .replace(/[^a-z0-9:@]+/g, '-')
                    .replace(/^-+|-+$/g, '')
            )
            tagsMgr.linkTagsToEntry(id, formattedTags)
        }

        return true
    })

    const updated = txn()
    if (!updated) return null

    const readWs = input.targetWorkspaceId ?? input.workspaceId ?? 'default'
    return getEntryById(context, id, readWs)
}

export function deleteEntry(
    context: EntriesSharedContext,
    id: number,
    permanent = false,
    workspaceId?: string
): boolean {
    const { db } = context
    const hasWorkspaceFilter = workspaceId !== undefined && workspaceId !== '*'

    if (permanent) {
        const stmt = db.prepare(
            hasWorkspaceFilter
                ? 'DELETE FROM memory_journal WHERE id = ? AND workspace_id = ?'
                : 'DELETE FROM memory_journal WHERE id = ?'
        )
        const result = hasWorkspaceFilter ? stmt.run(id, workspaceId) : stmt.run(id)
        return result.changes > 0
    }

    const stmt = db.prepare(
        hasWorkspaceFilter
            ? 'UPDATE memory_journal SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND workspace_id = ?'
            : 'UPDATE memory_journal SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    const now = new Date().toISOString()
    const result = hasWorkspaceFilter ? stmt.run(now, id, workspaceId) : stmt.run(now, id)
    return result.changes > 0
}

export function restoreEntry(
    context: EntriesSharedContext,
    id: number,
    workspaceId?: string
): boolean {
    const { db } = context
    const hasWorkspaceFilter = workspaceId !== undefined && workspaceId !== '*'
    const stmt = db.prepare(
        hasWorkspaceFilter
            ? 'UPDATE memory_journal SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL AND workspace_id = ?'
            : 'UPDATE memory_journal SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL'
    )
    const result = hasWorkspaceFilter ? stmt.run(id, workspaceId) : stmt.run(id)
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
            if (input === undefined) continue
            try {
                const newEntry = createEntry(context, input)
                createdIds.push(newEntry.id)
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err))
                throw new BatchTransactionError({ index: i, error })
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.index !== undefined) {
            errors.push({ index: err.batchError.index, error: err.batchError.error })
        } else {
            errors.push({ index: -1, error: err instanceof Error ? err : new Error(String(err)) })
        }
        return { created: [], errors }
    }

    const resultsMap = getEntriesByIds(context, createdIds)
    const created = createdIds
        .map((id) => resultsMap.get(id))
        .filter((entry): entry is JournalEntry => entry !== undefined)

    return { created, errors }
}

export function updateEntries(
    context: EntriesSharedContext,
    updates: ({ id: number } & Parameters<typeof updateEntry>[2])[]
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
                if (entry !== null) {
                    updatedIds.push(input.id)
                } else {
                    notFound.push(input.id)
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err))
                throw new BatchTransactionError({ id: input.id, error })
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.id !== undefined) {
            errors.push({ id: err.batchError.id, error: err.batchError.error })
        } else {
            errors.push({ id: -1, error: err instanceof Error ? err : new Error(String(err)) })
        }
        return { updated: [], notFound: [], errors }
    }

    const resultsMap = getEntriesByIds(context, updatedIds)
    const updated = updatedIds
        .map((id) => resultsMap.get(id))
        .filter((entry): entry is JournalEntry => entry !== undefined)

    return { updated, notFound, errors }
}

export function deleteEntries(
    context: EntriesSharedContext,
    ids: number[],
    permanent = false,
    workspaceId?: string
): { deleted: number[]; notFound: number[]; errors: { id: number; error: Error }[] } {
    const { db } = context
    if (ids.length === 0) return { deleted: [], notFound: [], errors: [] }

    const placeholders = ids.map(() => '?').join(', ')
    const hasWorkspaceFilter = workspaceId !== undefined && workspaceId !== '*'
    const existingRows = db
        .prepare(
            `SELECT id FROM memory_journal WHERE id IN (${placeholders}) ${permanent ? '' : 'AND deleted_at IS NULL'}${hasWorkspaceFilter ? ' AND workspace_id = ?' : ''}`
        )
        .all(...(hasWorkspaceFilter ? [...ids, workspaceId] : ids)) as { id: number }[]
    const existingIds = new Set(existingRows.map((r) => r.id))
    const notFound = ids.filter((id) => !existingIds.has(id))
    const toDelete = ids.filter((id) => existingIds.has(id))
    const deleted: number[] = []
    const errors: { id: number; error: Error }[] = []

    const txn = db.transaction(() => {
        for (const id of toDelete) {
            try {
                if (deleteEntry(context, id, permanent, workspaceId)) {
                    deleted.push(id)
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err))
                throw new BatchTransactionError({ id, error })
            }
        }
    })

    try {
        txn()
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError && err.batchError.id !== undefined) {
            errors.push({ id: err.batchError.id, error: err.batchError.error })
        } else {
            errors.push({ id: -1, error: err instanceof Error ? err : new Error(String(err)) })
        }
        return { deleted: [], notFound, errors }
    }

    return { deleted, notFound, errors }
}
