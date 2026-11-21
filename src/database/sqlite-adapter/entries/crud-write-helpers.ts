import type { CreateEntryInput } from '../../core/interfaces.js'
import type { EntriesSharedContext } from './shared.js'
import { ValidationError } from '../../../types/errors.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { resolveProjectContextWithRegistry } from '../../../utils/workspace-resolver-pure.js'
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

interface CachedColumnState {
    schemaVersion: number
    hasCol: boolean
}

const authorColumnCache = new WeakMap<object, CachedColumnState>()
const originColumnCache = new WeakMap<object, CachedColumnState>()

function getSchemaVersion(db: EntriesSharedContext['db']): number | undefined {
    if (typeof db.pragma !== 'function') return undefined
    const raw = db.pragma('schema_version', { simple: true })
    return typeof raw === 'number' ? raw : undefined
}

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

function hasCachedJournalColumn(
    db: EntriesSharedContext['db'],
    cache: WeakMap<object, CachedColumnState>,
    column: string
): boolean {
    const schemaVersion = getSchemaVersion(db)
    const cached = cache.get(db)
    if (cached !== undefined && (schemaVersion === undefined || cached.schemaVersion === schemaVersion)) {
        return cached.hasCol
    }
    const hasCol = tableHasColumn(db, column)
    if (hasCol || schemaVersion !== undefined) {
        cache.set(db, { schemaVersion: schemaVersion ?? -1, hasCol })
    }
    return hasCol
}

/** True when the team-only `origin_personal_id` column (migration 020) exists. */
function hasOriginPersonalIdColumn(db: EntriesSharedContext['db']): boolean {
    return hasCachedJournalColumn(db, originColumnCache, 'origin_personal_id')
}

function hasAuthorColumn(db: EntriesSharedContext['db']): boolean {
    return hasCachedJournalColumn(db, authorColumnCache, 'author')
}

const nonEmpty = (s: string | null | undefined): string | null =>
    s !== undefined && s !== null && s !== '' ? s : null

function resolveInsertScope(
    context: EntriesSharedContext,
    input: CreateEntryInput
): { finalProjNum: number | null; finalWsId: string } {
    const trimmedWorkspace = input.workspaceId?.trim()
    const omittedWorkspace = trimmedWorkspace === undefined || trimmedWorkspace.length === 0
    const effectiveRegistry = activeProjectRegistry(context.config?.projectRegistry)
    const resolutionInput = {
        ...(omittedWorkspace ? {} : { workspace_id: trimmedWorkspace }),
        ...(input.projectNumber !== undefined ? { project_number: input.projectNumber } : {}),
    }
    const resolved =
        context.config?.projectRegistry !== undefined
            ? resolveProjectContext(resolutionInput, context.config)
            : resolveProjectContextWithRegistry(resolutionInput, context.config, effectiveRegistry)
    const paired = pairStoredScope(
        resolved.workspaceId,
        input.projectNumber ?? resolved.projectNumber,
        effectiveRegistry
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
