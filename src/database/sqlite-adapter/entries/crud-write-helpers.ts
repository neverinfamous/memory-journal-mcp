import type { CreateEntryInput } from '../../core/interfaces.js'
import type { EntriesSharedContext } from './shared.js'
import { ValidationError } from '../../../types/errors.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../utils/write-scope.js'
import { guardEntryTypeWrite } from './entry-type-guard.js'

const ENTRY_INSERT_COLUMNS = [
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
    'workspace_id',
    'trust_score',
    'validation_status',
    'impact_score',
    'session_id',
] as const

const authorColumnCache = new WeakMap<object, boolean>()
const originColumnCache = new WeakMap<object, boolean>()

function tableHasColumn(db: EntriesSharedContext['db'], column: string): boolean {
    const rows = db.prepare('PRAGMA table_info(memory_journal)').all()
    return (
        Array.isArray(rows) &&
        rows.some((row): boolean => {
            if (typeof row !== 'object' || row === null || !('name' in row)) return false
            return Object.getOwnPropertyDescriptor(row, 'name')?.value === column
        })
    )
}

/** True when the team-only `origin_personal_id` column (migration 020) exists. */
function hasOriginPersonalIdColumn(db: EntriesSharedContext['db']): boolean {
    const cached = originColumnCache.get(db)
    if (cached !== undefined) return cached
    const hasCol = tableHasColumn(db, 'origin_personal_id')
    if (hasCol) originColumnCache.set(db, true)
    return hasCol
}

function hasAuthorColumn(db: EntriesSharedContext['db']): boolean {
    const cached = authorColumnCache.get(db)
    if (cached !== undefined) return cached
    const hasCol = tableHasColumn(db, 'author')
    if (hasCol) authorColumnCache.set(db, true)
    return hasCol
}

const nonEmpty = (s: string | null | undefined): string | null =>
    s !== undefined && s !== null && s !== '' ? s : null

function resolveInsertScope(
    context: EntriesSharedContext,
    input: CreateEntryInput
): { finalProjNum: number | null; finalWsId: string } {
    const trimmedWorkspace = input.workspaceId?.trim()
    const omittedWorkspace = trimmedWorkspace === undefined || trimmedWorkspace.length === 0
    const resolved = resolveProjectContext(
        {
            ...(omittedWorkspace ? {} : { workspace_id: trimmedWorkspace }),
            ...(input.projectNumber !== undefined ? { project_number: input.projectNumber } : {}),
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
    if (finalWsId === '*') {
        throw new ValidationError(
            "Wildcard workspace_id '*' cannot be used when creating entries. Specify a concrete workspace_id."
        )
    }
    return { finalProjNum, finalWsId }
}

/** Build the ordered column names and bound SQL values for inserting a journal entry row. */
export function buildEntryInsertPayload(
    context: EntriesSharedContext,
    input: CreateEntryInput,
    timestamp: string
): { columns: string[]; values: unknown[] } {
    const { finalProjNum, finalWsId } = resolveInsertScope(context, input)
    // [INVARIANT] M1 write guard: only canonical ENTRY_TYPES reach storage.
    const guarded = guardEntryTypeWrite(input.entryType ?? 'personal_reflection')
    const significance = nonEmpty(input.significanceType) ?? guarded.defaultSignificance ?? null
    const columns: string[] = [...ENTRY_INSERT_COLUMNS]
    const values: unknown[] = [
        guarded.entryType,
        input.content,
        timestamp,
        (input.isPersonal ?? true) ? 1 : 0,
        significance,
        nonEmpty(input.autoContext),
        finalProjNum,
        nonEmpty(input.projectOwner),
        input.issueNumber ?? null,
        nonEmpty(input.issueUrl),
        input.prNumber ?? null,
        nonEmpty(input.prUrl),
        nonEmpty(input.prStatus),
        input.workflowRunId ?? null,
        nonEmpty(input.workflowName),
        nonEmpty(input.workflowStatus),
        input.isArchived === true ? 1 : 0,
        finalWsId,
        input.trustScore ?? 0.5,
        input.validationStatus ?? 'none',
        input.impactScore ?? 0.0,
        nonEmpty(input.sessionId),
    ]

    if (input.author !== undefined && hasAuthorColumn(context.db)) {
        columns.push('author')
        values.push(input.author)
    }

    if (input.originPersonalId !== undefined && hasOriginPersonalIdColumn(context.db)) {
        columns.push('origin_personal_id')
        values.push(input.originPersonalId)
    }

    return { columns, values }
}
