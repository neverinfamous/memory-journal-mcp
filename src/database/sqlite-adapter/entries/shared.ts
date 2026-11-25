import type { EntryType, JournalEntry, SignificanceType, ToolHandlerConfig } from '../../../types/index.js'
import { SIGNIFICANCE_TYPES } from '../../../types/entities.js'
import {
    canonicalizeStoredEntryType,
    isCanonicalEntryType,
} from '../../../utils/legacy-commit-narrative.js'
import { isRecord } from '../../../utils/type-guards.js'
import type { Database } from 'better-sqlite3'
import type { TagsManager } from '../tags.js'
import type { NativeConnectionManager } from '../native-connection.js'

export const ENTRY_COLUMNS =
    'id, entry_type as entryType, content, timestamp, is_personal as isPersonal, ' +
    'significance_type as significanceType, auto_context as autoContext, ' +
    'project_number as projectNumber, project_owner as projectOwner, ' +
    'issue_number as issueNumber, issue_url as issueUrl, ' +
    'pr_number as prNumber, pr_url as prUrl, pr_status as prStatus, ' +
    'workflow_run_id as workflowRunId, workflow_name as workflowName, ' +
    'workflow_status as workflowStatus, deleted_at as deletedAt, ' +
    'is_archived as isArchived, version, workspace_id as workspaceId, ' +
    'trust_score as trustScore, validation_status as validationStatus, impact_score as impactScore, ' +
    'session_id as sessionId'

export const ALIASED_ENTRY_COLUMNS =
    'e.id, e.entry_type as entryType, e.content, e.timestamp, ' +
    'e.is_personal as isPersonal, e.significance_type as significanceType, ' +
    'e.auto_context as autoContext, e.project_number as projectNumber, ' +
    'e.project_owner as projectOwner, e.issue_number as issueNumber, ' +
    'e.issue_url as issueUrl, e.pr_number as prNumber, e.pr_url as prUrl, ' +
    'e.pr_status as prStatus, e.workflow_run_id as workflowRunId, ' +
    'e.workflow_name as workflowName, e.workflow_status as workflowStatus, ' +
    'e.deleted_at as deletedAt, e.is_archived as isArchived, e.version, e.workspace_id as workspaceId, ' +
    'e.trust_score as trustScore, e.validation_status as validationStatus, e.impact_score as impactScore, ' +
    'e.session_id as sessionId'

/**
 * Shared context for entries manager operations
 */
export interface EntriesSharedContext {
    ctx: NativeConnectionManager
    tagsMgr: TagsManager
    db: Database
    config?: ToolHandlerConfig | undefined
}

/**
 * Convert a generic database row to a JournalEntry by attaching its tags.
 * Delegates to rowsToEntries to utilize batch tag fetching.
 */
export function rowToEntry(tagsMgr: TagsManager, row: unknown): JournalEntry {
    const entry = rowsToEntries(tagsMgr, [row])[0]
    if (!entry) throw new Error('Expected entry to be defined')
    return entry
}

function parseEntryType(val: unknown): EntryType {
    const raw = typeof val === 'string' ? val : ''
    return isCanonicalEntryType(raw) ? raw : canonicalizeStoredEntryType(raw, null).entryType
}

const SIGNIFICANCE_TYPE_MAP = new Map<string, SignificanceType>(
    SIGNIFICANCE_TYPES.filter((t): t is Exclude<SignificanceType, null> => t !== null).map((t) => [t, t])
)
const NUM_ENTRY_KEYS = ['projectNumber', 'issueNumber', 'prNumber', 'workflowRunId'] as const
const STR_ENTRY_KEYS = [
    'projectOwner',
    'issueUrl',
    'prUrl',
    'prStatus',
    'workflowName',
    'workflowStatus',
    'sessionId',
] as const

function parseSignificanceType(val: unknown): SignificanceType {
    return typeof val === 'string' ? (SIGNIFICANCE_TYPE_MAP.get(val) ?? null) : null
}

function parseValidationStatus(val: unknown): 'passed' | 'failed' | 'none' | undefined {
    return val === 'passed' || val === 'failed' || val === 'none' ? val : undefined
}

const optStr = (r: Record<string, unknown>, key: string): string | null | undefined => {
    const val = r[key]
    return val === null || typeof val === 'string' ? val : undefined
}

const optNum = (r: Record<string, unknown>, key: string): number | null | undefined => {
    const val = r[key]
    return val === null || typeof val === 'number' ? val : undefined
}

function attachOptionalEntryFields(entry: JournalEntry, r: Record<string, unknown>): void {
    for (const k of NUM_ENTRY_KEYS) {
        const v = optNum(r, k)
        if (v !== undefined) entry[k] = v
    }
    for (const k of STR_ENTRY_KEYS) {
        const v = optStr(r, k)
        if (v !== undefined) entry[k] = v
    }
    if (typeof r['importanceScore'] === 'number') {
        entry.importanceScore = Math.round(r['importanceScore'] * 100) / 100
    }
    if (typeof r['trustScore'] === 'number') entry.trustScore = r['trustScore']
    if (typeof r['impactScore'] === 'number') entry.impactScore = r['impactScore']
    const vs = parseValidationStatus(r['validationStatus'])
    if (vs !== undefined) entry.validationStatus = vs
    if (typeof r['workspaceId'] === 'string') entry.workspaceId = r['workspaceId']
}

function mapRawRowToEntry(r: unknown): JournalEntry {
    if (!isRecord(r)) {
        throw new Error('Expected database row object')
    }
    const idRaw = r['id']
    const id = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'bigint' ? Number(idRaw) : 0
    const entry: JournalEntry = {
        id,
        entryType: parseEntryType(r['entryType']),
        content: typeof r['content'] === 'string' ? r['content'] : '',
        timestamp: typeof r['timestamp'] === 'string' ? r['timestamp'] : '',
        isPersonal: Boolean(r['isPersonal']),
        significanceType: parseSignificanceType(r['significanceType']),
        autoContext: typeof r['autoContext'] === 'string' ? r['autoContext'] : null,
        deletedAt: typeof r['deletedAt'] === 'string' ? r['deletedAt'] : null,
        isArchived: Boolean(r['isArchived']),
        tags: [],
        version: typeof r['version'] === 'number' ? r['version'] : 1,
    }
    attachOptionalEntryFields(entry, r)
    return entry
}

/**
 * Convert multiple generic database rows to JournalEntries
 */
export function rowsToEntries(tagsMgr: TagsManager, rows: unknown[]): JournalEntry[] {
    if (rows.length === 0) return []

    const entries = rows.map(mapRawRowToEntry)

    const ids = entries.map((e) => e.id)
    const tagsMap = tagsMgr.batchGetTagsForEntries(ids)

    for (const entry of entries) {
        entry.tags = tagsMap.get(entry.id) ?? []
    }

    return entries
}

/**
 * Helper: Safely convert a row from execQuery/get to an object.
 */
export function rowToObject(row: unknown): Record<string, unknown> | undefined {
    return isRecord(row) ? row : undefined
}

/**
 * Typed wrapper for `db.prepare(sql).get(…params)`.
 * Returns the row typed as `Record<string, unknown>` for safe access.
 */
export function queryRow(
    db: Database,
    sql: string,
    ...params: unknown[]
): Record<string, unknown> | undefined {
    return db.prepare<unknown[], Record<string, unknown>>(sql).get(...params)
}

/**
 * Typed wrapper for `db.prepare(sql).all(…params)`.
 * Returns rows typed as `Record<string, unknown>[]` for safe access.
 */
export function queryRows(
    db: Database,
    sql: string,
    ...params: unknown[]
): Record<string, unknown>[] {
    return db.prepare<unknown[], Record<string, unknown>>(sql).all(...params)
}
