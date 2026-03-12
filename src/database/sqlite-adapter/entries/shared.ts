import type { JournalEntry } from '../../../types/index.js'
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
    'workflow_status as workflowStatus, deleted_at as deletedAt'

export const ALIASED_ENTRY_COLUMNS =
    'e.id, e.entry_type as entryType, e.content, e.timestamp, ' +
    'e.is_personal as isPersonal, e.significance_type as significanceType, ' +
    'e.auto_context as autoContext, e.project_number as projectNumber, ' +
    'e.project_owner as projectOwner, e.issue_number as issueNumber, ' +
    'e.issue_url as issueUrl, e.pr_number as prNumber, e.pr_url as prUrl, ' +
    'e.pr_status as prStatus, e.workflow_run_id as workflowRunId, ' +
    'e.workflow_name as workflowName, e.workflow_status as workflowStatus, ' +
    'e.deleted_at as deletedAt'

/**
 * Shared context for entries manager operations
 */
export interface EntriesSharedContext {
    ctx: NativeConnectionManager
    tagsMgr: TagsManager
    db: Database
}

/**
 * Convert a generic database row to a JournalEntry by attaching its tags
 */
export function rowToEntry(tagsMgr: TagsManager, row: unknown): JournalEntry {
    const r = row as Partial<JournalEntry>
    return {
        ...r,
        isPersonal: Boolean(r.isPersonal), // SQLite uses 0/1
        tags: tagsMgr.getTagsForEntry(Number(r.id)),
    } as JournalEntry
}

/**
 * Convert multiple generic database rows to JournalEntries
 */
export function rowsToEntries(tagsMgr: TagsManager, rows: unknown[]): JournalEntry[] {
    if (rows.length === 0) return []

    const entries = rows.map((r) => {
        const p = r as Partial<JournalEntry>
        return {
            ...p,
            isPersonal: Boolean(p.isPersonal), // SQLite uses 0/1
            tags: [],
        } as JournalEntry
    })

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
    if (row === null || row === undefined) return undefined
    if (typeof row !== 'object') return undefined
    return row as Record<string, unknown>
}
