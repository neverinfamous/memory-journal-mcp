import type { JournalEntry } from '../../../types/index.js'
import type { CreateEntryInput } from '../../core/interfaces.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { insertAnchors } from './anchors.js'
import { getEntryById, getEntriesByIds } from './crud-read.js'
import { normalizeTag, performUpdateEntry } from './crud-update.js'
import type { UpdateEntryInput } from './crud-update.js'

export type { UpdateEntryInput }

/** Identifies the failing item (array index or entry id) inside an all-or-nothing batch transaction. */
class BatchTransactionError extends Error {
    constructor(
        public readonly key: number,
        public readonly batchError: Error
    ) {
        super('Batch transaction failed')
        this.name = 'BatchTransactionError'
    }
}

function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err))
}

/**
 * Runs `body` in a single transaction. Returns null on success, or the failing item's key
 * (index/id; -1 when the failure was not attributable to a single item) and its error.
 */
function runBatchTransaction(
    db: EntriesSharedContext['db'],
    body: () => void
): { key: number; error: Error } | null {
    try {
        db.transaction(body)()
        return null
    } catch (err: unknown) {
        if (err instanceof BatchTransactionError) {
            return { key: err.key, error: err.batchError }
        }
        return { key: -1, error: toError(err) }
    }
}


export function validateEntryInput(input: CreateEntryInput): { normalizedTimestamp: string } {
    if (input.workspaceId?.trim() === '*') {
        throw new Error(
            "workspace_id '*' is a read-only cross-workspace selector and cannot be used to create an entry. Pass a specific workspace_id."
        )
    }
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

function insertEntryRow(context: EntriesSharedContext, input: CreateEntryInput): number {
    const { db, tagsMgr } = context
    const { normalizedTimestamp: timestamp } = validateEntryInput(input)

    const txn = db.transaction((): number => {
        const columns = [
            'entry_type', 'content', 'timestamp', 'is_personal', 'significance_type',
            'auto_context', 'project_number', 'project_owner', 'issue_number', 'issue_url',
            'pr_number', 'pr_url', 'pr_status', 'workflow_run_id', 'workflow_name',
            'workflow_status', 'is_archived', 'workspace_id', 'trust_score',
            'validation_status', 'impact_score', 'session_id',
        ]
        const nonEmpty = (s: string | null | undefined): string | null =>
            s !== undefined && s !== null && s !== '' ? s : null
        const trimmedWorkspace = input.workspaceId?.trim()
        const omittedWorkspace = trimmedWorkspace === undefined || trimmedWorkspace.length === 0
        const resolved = resolveProjectContext(
            {
                ...(omittedWorkspace ? {} : { workspace_id: trimmedWorkspace }),
                ...(input.projectNumber !== undefined ? { project_number: input.projectNumber } : {}),
                content: input.content,
                ...(input.tags !== undefined ? { tags: input.tags } : {}),
            },
            context.config
        )
        const paired = pairStoredScope(
            resolved.workspaceId,
            input.projectNumber ?? resolved.projectNumber,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const finalProjNum = paired.projectNumber ?? null
        const finalWsId = effectiveWorkspace(paired.workspaceId)
        const values = [
            input.entryType ?? 'personal_reflection',
            input.content,
            timestamp,
            (input.isPersonal ?? true) ? 1 : 0,
            nonEmpty(input.significanceType),
            input.autoContext ?? null,
            finalProjNum,
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
            finalWsId,
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
        const insertId = Number(result.lastInsertRowid)

        if (input.tags !== undefined && input.tags.length > 0) {
            tagsMgr.linkTagsToEntry(insertId, input.tags.map(normalizeTag))
        }

        if (input.anchors !== undefined && input.anchors.length > 0) {
            insertAnchors(context, insertId, input.anchors)
        }
        return insertId
    })

    return txn()
}

export function createEntry(context: EntriesSharedContext, input: CreateEntryInput): JournalEntry {
    const insertId = insertEntryRow(context, input)

    const entry = getEntryById(context, insertId, '*')
    if (entry === null) {
        throw new Error(
            `Storage Inconsistency Anomaly: Entry with ID ${String(insertId)} successfully written but could not be read back.`
        )
    }
    return entry
}


export function updateEntry(
    context: EntriesSharedContext,
    id: number,
    input: UpdateEntryInput
): JournalEntry | null {
    const updated = performUpdateEntry(context, id, input)
    if (!updated) return null

    const readWs = '*' // [INVARIANT] ownership already enforced; destination may be registry-canonicalized
    return getEntryById(context, id, readWs)
}

export function deleteEntry(
    context: EntriesSharedContext,
    id: number,
    permanent = false,
    workspaceId?: string
): boolean {
    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const hasWorkspaceFilter = scopeId !== '*'

    if (permanent) {
        const stmt = db.prepare(
            hasWorkspaceFilter
                ? 'DELETE FROM memory_journal WHERE id = ? AND workspace_id = ?'
                : 'DELETE FROM memory_journal WHERE id = ?'
        )
        const result = hasWorkspaceFilter ? stmt.run(id, scopeId) : stmt.run(id)
        return result.changes > 0
    }

    const stmt = db.prepare(
        hasWorkspaceFilter
            ? 'UPDATE memory_journal SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND workspace_id = ?'
            : 'UPDATE memory_journal SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    const now = new Date().toISOString()
    const result = hasWorkspaceFilter ? stmt.run(now, id, scopeId) : stmt.run(now, id)
    return result.changes > 0
}

export function restoreEntry(
    context: EntriesSharedContext,
    id: number,
    workspaceId?: string
): boolean {
    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const hasWorkspaceFilter = scopeId !== '*'
    const stmt = db.prepare(
        hasWorkspaceFilter
            ? 'UPDATE memory_journal SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL AND workspace_id = ?'
            : 'UPDATE memory_journal SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL'
    )
    const result = hasWorkspaceFilter ? stmt.run(id, scopeId) : stmt.run(id)
    return result.changes > 0
}

export function createEntries(
    context: EntriesSharedContext,
    inputs: CreateEntryInput[]
): { created: JournalEntry[]; errors: { index: number; error: Error }[] } {
    if (inputs.length === 0) return { created: [], errors: [] }

    const { db } = context
    const createdIds: number[] = []

    const failure = runBatchTransaction(db, () => {
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i]
            if (input === undefined) continue
            try {
                createdIds.push(insertEntryRow(context, input))
            } catch (err) {
                throw new BatchTransactionError(i, toError(err))
            }
        }
    })
    if (failure !== null) {
        return { created: [], errors: [{ index: failure.key, error: failure.error }] }
    }

    const resultsMap = getEntriesByIds(context, createdIds, '*')
    const created: JournalEntry[] = []
    const errors: { index: number; error: Error }[] = []
    createdIds.forEach((id, index) => {
        const entry = resultsMap.get(id)
        if (entry === undefined) {
            errors.push({
                index,
                error: new Error(`Entry ${String(id)} was written but could not be read back.`),
            })
        } else {
            created.push(entry)
        }
    })

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

    const failure = runBatchTransaction(db, () => {
        for (const input of updates) {
            try {
                const updated = performUpdateEntry(context, input.id, input)
                if (updated) {
                    updatedIds.push(input.id)
                } else {
                    notFound.push(input.id)
                }
            } catch (err) {
                throw new BatchTransactionError(input.id, toError(err))
            }
        }
    })
    if (failure !== null) {
        return {
            updated: [],
            notFound: [],
            errors: [{ id: failure.key, error: failure.error }],
        }
    }

    const resultsMap = getEntriesByIds(context, updatedIds, '*')
    const updated: JournalEntry[] = []
    const errors: { id: number; error: Error }[] = []
    for (const id of updatedIds) {
        const entry = resultsMap.get(id)
        if (entry === undefined) {
            errors.push({
                id,
                error: new Error(`Entry ${String(id)} was updated but could not be read back.`),
            })
        } else {
            updated.push(entry)
        }
    }

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
    const scopeId = effectiveWorkspace(workspaceId)
    const hasWorkspaceFilter = scopeId !== '*'
    const existingRows = db
        .prepare(
            `SELECT id FROM memory_journal WHERE id IN (${placeholders}) ${permanent ? '' : 'AND deleted_at IS NULL'}${hasWorkspaceFilter ? ' AND workspace_id = ?' : ''}`
        )
        .all(...(hasWorkspaceFilter ? [...ids, scopeId] : ids)) as { id: number }[]
    const existingIds = new Set(existingRows.map((r) => r.id))
    const notFound = ids.filter((id) => !existingIds.has(id))
    const toDelete = ids.filter((id) => existingIds.has(id))
    const deleted: number[] = []
    const errors: { id: number; error: Error }[] = []

    if (toDelete.length === 0) return { deleted: [], notFound, errors: [] }

    const txn = db.transaction(() => {
        const delPlaceholders = toDelete.map(() => '?').join(', ')
        if (permanent) {
            const stmt = db.prepare(
                hasWorkspaceFilter
                    ? `DELETE FROM memory_journal WHERE id IN (${delPlaceholders}) AND workspace_id = ?`
                    : `DELETE FROM memory_journal WHERE id IN (${delPlaceholders})`
            )
            stmt.run(...(hasWorkspaceFilter ? [...toDelete, scopeId] : toDelete))
        } else {
            const now = new Date().toISOString()
            const stmt = db.prepare(
                hasWorkspaceFilter
                    ? `UPDATE memory_journal SET deleted_at = ? WHERE id IN (${delPlaceholders}) AND deleted_at IS NULL AND workspace_id = ?`
                    : `UPDATE memory_journal SET deleted_at = ? WHERE id IN (${delPlaceholders}) AND deleted_at IS NULL`
            )
            stmt.run(...(hasWorkspaceFilter ? [now, ...toDelete, scopeId] : [now, ...toDelete]))
        }
        deleted.push(...toDelete)
    })

    try {
        txn()
    } catch (err: unknown) {
        // Only plain DB errors can surface here (no per-item BatchTransactionError is thrown).
        errors.push({ id: -1, error: toError(err) })
        return { deleted: [], notFound, errors }
    }

    return { deleted, notFound, errors }
}
