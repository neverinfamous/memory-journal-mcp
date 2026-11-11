import type { EntryType } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { ConflictError } from '../../../types/errors.js'
import { snapshotAndEvictRevisions } from './revisions.js'

/** Thrown inside the update transaction to roll back revision bookkeeping when no row matched. */
class NoRowsUpdatedError extends Error {
    constructor() {
        super('No rows updated')
        this.name = 'NoRowsUpdatedError'
    }
}

/** Lowercase a tag and collapse unsupported characters into single hyphens. */
export function normalizeTag(tag: string): string {
    return tag
        .toLowerCase()
        .replace(/[^a-z0-9:@]+/g, '-')
        .replace(/^-+|-+$/g, '')
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

interface ExistingEntryRow {
    id: number
    content: string
    version: number
    workspaceId: string
}

/** Enforce workspace ownership and optimistic-locking preconditions for an update. */
function assertUpdateAllowed(
    id: number,
    existing: ExistingEntryRow,
    callerWorkspace: string,
    input: UpdateEntryInput
): void {
    if (callerWorkspace !== '*' && existing.workspaceId !== callerWorkspace) {
        throw new ConflictError(
            `Entry ${String(id)} belongs to workspace '${existing.workspaceId}', cannot be updated from '${callerWorkspace}'. Moving to another workspace requires explicit overrides (e.g. workspaceId = '*').`,
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
}

/** Build the SET clauses (and bound values) for the columns present in `input`. */
function buildUpdateSets(
    id: number,
    existing: ExistingEntryRow,
    callerWorkspace: string,
    input: UpdateEntryInput
): { updates: string[]; values: unknown[] } {
    const updates: string[] = ['version = version + 1']
    const values: unknown[] = []

    const scalarFields = [
        ['entry_type', input.entryType],
        ['content', input.content],
        ['is_personal', input.isPersonal !== undefined ? (input.isPersonal ? 1 : 0) : undefined],
        ['significance_type', input.significanceType],
        ['auto_context', input.autoContext !== undefined ? (input.autoContext ?? null) : undefined],
        ['is_archived', input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : undefined],
        ['trust_score', input.trustScore],
        ['validation_status', input.validationStatus],
        ['impact_score', input.impactScore],
        ['session_id', input.sessionId],
    ] as const

    for (const [col, val] of scalarFields) {
        if (val !== undefined) {
            updates.push(`${col} = ?`)
            values.push(val)
        }
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

    if (input.targetWorkspaceId !== undefined) {
        if (callerWorkspace !== '*') {
            throw new ConflictError(
                `Cannot move entry ${String(id)} to workspace '${input.targetWorkspaceId}' from '${callerWorkspace}'. Moving an entry to another workspace requires workspaceId = '*'.`,
                { id: existing.id, version: existing.version, workspaceId: existing.workspaceId }
            )
        }
        if (input.targetWorkspaceId === '*') {
            throw new ConflictError(
                "targetWorkspaceId cannot be '*'. Provide the concrete destination workspace.",
                { id: existing.id, version: existing.version, workspaceId: existing.workspaceId }
            )
        }
        updates.push('workspace_id = ?')
        values.push(input.targetWorkspaceId)
    }

    return { updates, values }
}

export function performUpdateEntry(
    context: EntriesSharedContext,
    id: number,
    input: UpdateEntryInput
): boolean {
    const { db, tagsMgr } = context

    const callerWorkspace = effectiveWorkspace(input.workspaceId)
    const scopedSelect = callerWorkspace !== '*'
    const selectSql = scopedSelect
        ? 'SELECT id, content, version, workspace_id as workspaceId FROM memory_journal WHERE id = ? AND deleted_at IS NULL AND workspace_id = ?'
        : 'SELECT id, content, version, workspace_id as workspaceId FROM memory_journal WHERE id = ? AND deleted_at IS NULL'
    const existing = (
        scopedSelect
            ? db.prepare(selectSql).get(id, callerWorkspace)
            : db.prepare(selectSql).get(id)
    ) as ExistingEntryRow | undefined
    if (existing === undefined) return false

    assertUpdateAllowed(id, existing, callerWorkspace, input)

    const { updates, values } = buildUpdateSets(id, existing, callerWorkspace, input)

    const scopeUpdate = callerWorkspace !== '*'
    const query = `UPDATE memory_journal SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL${scopeUpdate ? ' AND workspace_id = ?' : ''}`

    const txn = db.transaction(() => {
        const stmt = db.prepare(query)
        const result = scopeUpdate ? stmt.run(...values, id, callerWorkspace) : stmt.run(...values, id)
        if (result.changes === 0) {
            throw new NoRowsUpdatedError()
        }

        snapshotAndEvictRevisions(db, id, existing.content)

        if (input.tags !== undefined) {
            db.prepare(
                'UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id IN (SELECT tag_id FROM entry_tags WHERE entry_id = ?)'
            ).run(id)
            db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id)
            tagsMgr.linkTagsToEntry(id, input.tags.map(normalizeTag))
        }

        return true
    })

    try {
        return txn()
    } catch (err) {
        if (err instanceof NoRowsUpdatedError) return false
        throw err
    }
}
