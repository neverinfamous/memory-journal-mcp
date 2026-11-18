import type { EntryType } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { ConflictError, ValidationError } from '../../../types/errors.js'
import {
    activeProjectRegistry,
    exactRegistryKey,
    pairStoredScope,
} from '../../../utils/write-scope.js'
import type { ProjectRegistry } from '../../../utils/write-scope.js'
import { insertAnchors } from './anchors.js'
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
    anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[] | undefined
}

const nonEmptyNullable = (s: string | null | undefined): string | null | undefined =>
    s === undefined ? undefined : s !== null && s !== '' ? s : null

interface ExistingEntryRow {
    id: number
    content: string
    version: number
    workspaceId: string
}

function workspacesEqual(a: string, b: string, isRegistered: boolean): boolean {
    return isRegistered ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Enforce workspace ownership and optimistic-locking preconditions for an update. */
function assertUpdateAllowed(
    id: number,
    existing: ExistingEntryRow,
    callerWorkspace: string,
    isRegisteredCaller: boolean,
    input: UpdateEntryInput
): void {
    if (
        callerWorkspace !== '*' &&
        !workspacesEqual(existing.workspaceId, callerWorkspace, isRegisteredCaller)
    ) {
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

const OPTIONAL_SNAKE_FIELDS = [
    ['project_number', 'projectNumber'],
    ['project_owner', 'projectOwner'],
    ['issue_number', 'issueNumber'],
    ['issue_url', 'issueUrl'],
    ['pr_number', 'prNumber'],
    ['pr_url', 'prUrl'],
    ['pr_status', 'prStatus'],
    ['workflow_run_id', 'workflowRunId'],
    ['workflow_name', 'workflowName'],
    ['workflow_status', 'workflowStatus'],
] as const

const EMPTY_STRING_NULL_KEYS = new Set<string>([
    'projectOwner',
    'issueUrl',
    'prUrl',
    'prStatus',
    'workflowName',
    'workflowStatus',
])

/** Build the SET clauses (and bound values) for the columns present in `input`. */
function buildUpdateSets(
    id: number,
    existing: ExistingEntryRow,
    callerWorkspace: string,
    input: UpdateEntryInput,
    registry: ProjectRegistry | undefined
): { updates: string[]; values: unknown[] } {
    const updates: string[] = ['version = version + 1']
    const values: unknown[] = []

    const scalarFields = [
        ['entry_type', input.entryType],
        ['content', input.content],
        ['is_personal', input.isPersonal !== undefined ? (input.isPersonal ? 1 : 0) : undefined],
        ['significance_type', nonEmptyNullable(input.significanceType)],
        ['auto_context', nonEmptyNullable(input.autoContext)],
        ['is_archived', input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : undefined],
        ['trust_score', input.trustScore],
        ['validation_status', input.validationStatus],
        ['impact_score', input.impactScore],
        ['session_id', nonEmptyNullable(input.sessionId)],
    ] as const

    for (const [col, val] of scalarFields) {
        if (val !== undefined) {
            updates.push(`${col} = ?`)
            values.push(val)
        }
    }

    for (const [snakeKey, camelKey] of OPTIONAL_SNAKE_FIELDS) {
        const rawVal = input[camelKey]
        if (rawVal !== undefined) {
            const val =
                typeof rawVal === 'string' && EMPTY_STRING_NULL_KEYS.has(camelKey)
                    ? nonEmptyNullable(rawVal)
                    : rawVal
            updates.push(`${snakeKey} = ?`)
            values.push(val ?? null)
        }
    }

    if (input.targetWorkspaceId !== undefined) {
        const isRegTarget =
            exactRegistryKey(input.targetWorkspaceId, registry) !== undefined ||
            exactRegistryKey(existing.workspaceId, registry) !== undefined
        const sameWorkspace = workspacesEqual(
            input.targetWorkspaceId,
            existing.workspaceId,
            isRegTarget
        )
        if (callerWorkspace !== '*' && !sameWorkspace) {
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

/**
 * [INTENT] Pair the destination workspace with its project before writing.
 * [INVARIANT] Moving to `default`/an unregistered workspace without an explicit project
 * clears project_number so the old project's number never travels with the row; a
 * registered numbered workspace can never be written with project_number NULL.
 */
function resolveUpdateScope(
    id: number,
    existing: ExistingEntryRow,
    input: UpdateEntryInput,
    registry: ProjectRegistry | undefined
): UpdateEntryInput {
    if (
        input.projectNumber !== undefined &&
        input.projectNumber !== null &&
        (!Number.isSafeInteger(input.projectNumber) || input.projectNumber <= 0)
    ) {
        throw new ValidationError('project_number must be a positive integer.', { id })
    }
    let target: string | undefined
    if (input.targetWorkspaceId !== undefined) {
        const trimmedTarget = input.targetWorkspaceId.trim()
        if (trimmedTarget === '') {
            throw new ValidationError('targetWorkspaceId cannot be blank.', { id })
        }
        if (trimmedTarget === '*') {
            throw new ConflictError(
                "targetWorkspaceId cannot be '*'. Provide the concrete destination workspace.",
                { id, version: existing.version, workspaceId: existing.workspaceId }
            )
        }
        target = exactRegistryKey(trimmedTarget, registry) ?? trimmedTarget
    }
    const isRegMove =
        (target !== undefined && exactRegistryKey(target, registry) !== undefined) ||
        exactRegistryKey(existing.workspaceId, registry) !== undefined
    const moving =
        target !== undefined && !workspacesEqual(target, existing.workspaceId, isRegMove)
    const destination = moving && target !== undefined ? target : existing.workspaceId
    const paired = pairStoredScope(
        destination,
        input.projectNumber === null ? undefined : input.projectNumber,
        registry
    )
    const registeredProject =
        typeof paired.projectNumber === 'number' &&
        exactRegistryKey(destination, registry) !== undefined
    if (input.projectNumber === null && registeredProject) {
        throw new ValidationError(
            `Workspace '${String(paired.workspaceId)}' is registered to project_number ${String(paired.projectNumber)}; project_number cannot be cleared.`,
            { id, workspaceId: paired.workspaceId }
        )
    }

    const next: UpdateEntryInput = { ...input }
    if (target !== undefined) next.targetWorkspaceId = target
    if (input.projectNumber === null) return next
    if (typeof paired.projectNumber === 'number' && (input.projectNumber !== undefined || moving)) {
        next.projectNumber = paired.projectNumber
    } else if (moving && input.projectNumber === undefined) {
        next.projectNumber = null
    }
    const canonical = paired.workspaceId
    if (target !== undefined && canonical !== undefined && canonical !== '' && canonical !== '*') {
        next.targetWorkspaceId = canonical
    }
    return next
}

export function performUpdateEntry(
    context: EntriesSharedContext,
    id: number,
    input: UpdateEntryInput
): boolean {
    const { db, tagsMgr } = context

    const rawCaller = effectiveWorkspace(input.workspaceId)
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const canonicalCaller = rawCaller !== '*' ? exactRegistryKey(rawCaller, registry) : undefined
    const callerWorkspace = canonicalCaller ?? rawCaller
    const isRegisteredCaller = canonicalCaller !== undefined
    const scopedSelect = callerWorkspace !== '*'
    const collateSql = isRegisteredCaller ? ' COLLATE NOCASE' : ''
    const selectSql = scopedSelect
        ? `SELECT id, content, version, workspace_id as workspaceId FROM memory_journal WHERE id = ? AND deleted_at IS NULL AND workspace_id = ?${collateSql}`
        : 'SELECT id, content, version, workspace_id as workspaceId FROM memory_journal WHERE id = ? AND deleted_at IS NULL'
    const scopeUpdate = callerWorkspace !== '*'

    const doUpdate = (): boolean => {
        const existing = (
            scopedSelect
                ? db.prepare(selectSql).get(id, callerWorkspace)
                : db.prepare(selectSql).get(id)
        ) as ExistingEntryRow | undefined
        if (existing === undefined) return false

        assertUpdateAllowed(id, existing, callerWorkspace, isRegisteredCaller, input)

        const writeInput = resolveUpdateScope(id, existing, input, registry)
        const { updates, values } = buildUpdateSets(
            id,
            existing,
            callerWorkspace,
            writeInput,
            registry
        )
        const expectedVersion = input.expectedVersion ?? existing.version
        const query = `UPDATE memory_journal SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL AND version = ?${scopeUpdate ? ` AND workspace_id = ?${collateSql}` : ''}`
        const stmt = db.prepare(query)
        const result = scopeUpdate
            ? stmt.run(...values, id, expectedVersion, callerWorkspace)
            : stmt.run(...values, id, expectedVersion)
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

        if (input.anchors !== undefined) {
            db.prepare('DELETE FROM entry_anchors WHERE entry_id = ?').run(id)
            insertAnchors(context, id, input.anchors)
        }

        return true
    }

    try {
        return db.inTransaction ? doUpdate() : db.transaction(doUpdate).immediate()
    } catch (err) {
        if (err instanceof NoRowsUpdatedError) return false
        throw err
    }
}
