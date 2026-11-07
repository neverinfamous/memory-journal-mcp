import type { JournalEntry, EntryType } from '../../../types/index.js'
import type { NativeConnectionManager } from '../native-connection.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import {
    saveAnalyticsSnapshot as saveSnapshot,
    getLatestAnalyticsSnapshot as getLatestSnapshot,
    getAnalyticsSnapshots as getSnapshots,
    computeDigest as computeDigestCore,
    type DigestSnapshot,
} from '../entries/digest.js'

function mapDigestRowToEntry(
    cols: string[],
    row: unknown[],
    tagsMap: Map<number, string[]>
): JournalEntry {
    const getVal = (col: string): unknown => {
        const idx = cols.indexOf(col)
        return idx >= 0 ? row[idx] : undefined
    }
    const id = getVal('id') as number
    return {
        id,
        entryType: getVal('entry_type') as EntryType,
        content: getVal('content') as string,
        timestamp: getVal('timestamp') as string,
        tags: tagsMap.get(id) ?? [],
        isPersonal: Boolean(getVal('is_personal')),
        isArchived: Boolean(getVal('is_archived')),
        significanceType: (getVal('significance_type') as JournalEntry['significanceType']) ?? null,
        autoContext: (getVal('auto_context') as string | null | undefined) ?? null,
        projectNumber: getVal('project_number') as number | undefined,
        projectOwner: getVal('project_owner') as string | undefined,
        issueNumber: getVal('issue_number') as number | undefined,
        issueUrl: getVal('issue_url') as string | undefined,
        prNumber: getVal('pr_number') as number | undefined,
        prUrl: getVal('pr_url') as string | undefined,
        prStatus: getVal('pr_status') as JournalEntry['prStatus'],
        workflowRunId: getVal('workflow_run_id') as number | undefined,
        workflowName: getVal('workflow_name') as string | undefined,
        workflowStatus: getVal('workflow_status') as JournalEntry['workflowStatus'],
        deletedAt: (getVal('deleted_at') as string | null | undefined) ?? null,
        version: (getVal('version') as number | undefined) ?? 1,
        workspaceId: getVal('workspace_id') as string | undefined,
        trustScore: getVal('trust_score') as number | undefined,
        validationStatus: getVal('validation_status') as JournalEntry['validationStatus'],
        impactScore: getVal('impact_score') as number | undefined,
        sessionId: getVal('session_id') as string | undefined,
    }
}

function hydrateTagsMap(connection: NativeConnectionManager, entryIds: number[]): Map<number, string[]> {
    const tagsMap = new Map<number, string[]>()
    if (entryIds.length === 0) return tagsMap
    const placeholders = entryIds.map(() => '?').join(',')
    const tagRows = connection.exec(
        `SELECT entry_tags.entry_id, tags.name as tag FROM entry_tags JOIN tags ON entry_tags.tag_id = tags.id WHERE entry_tags.entry_id IN (${placeholders})`,
        entryIds
    )
    if (tagRows[0] && tagRows[0].values.length > 0) {
        const tagCols = tagRows[0].columns
        const entryIdIdx = tagCols.indexOf('entry_id')
        const tagIdx = tagCols.indexOf('tag')
        for (const row of tagRows[0].values) {
            const eId = row[entryIdIdx] as number
            const tag = row[tagIdx] as string
            const list = tagsMap.get(eId) ?? []
            list.push(tag)
            tagsMap.set(eId, list)
        }
    }
    return tagsMap
}

export function getWorkflowActionEntries(
    connection: NativeConnectionManager,
    limit: number,
    workspaceId?: string
): JournalEntry[] {
    let sql = `
        SELECT * FROM memory_journal
        WHERE workflow_run_id IS NOT NULL AND deleted_at IS NULL
    `
    const params: unknown[] = []
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        sql += ` AND workspace_id = ?`
        params.push(scopeId)
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`
    params.push(limit)

    const rows = connection.exec(sql, params)
    if (!rows[0] || rows[0].values.length === 0) return []

    const cols = rows[0].columns
    const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
    const tagsMap = hydrateTagsMap(connection, entryIds)

    return rows[0].values.map((row: unknown[]): JournalEntry =>
        mapDigestRowToEntry(cols, row, tagsMap)
    )
}

export function getSignificantEntries(
    connection: NativeConnectionManager,
    limit: number,
    projectNumber?: number,
    workspaceId?: string
): JournalEntry[] {
    let sql = `
        SELECT * FROM memory_journal
        WHERE significance_type IS NOT NULL AND deleted_at IS NULL
    `
    const params: unknown[] = []
    if (projectNumber !== undefined) {
        sql += ` AND project_number = ?`
        params.push(projectNumber)
    }
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        sql += ` AND workspace_id = ?`
        params.push(scopeId)
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`
    params.push(limit)

    const rows = connection.exec(sql, params)
    if (!rows[0] || rows[0].values.length === 0) return []

    const cols = rows[0].columns
    const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
    const tagsMap = hydrateTagsMap(connection, entryIds)

    return rows[0].values.map((row: unknown[]): JournalEntry =>
        mapDigestRowToEntry(cols, row, tagsMap)
    )
}

export function saveAnalyticsDigest(
    connection: NativeConnectionManager,
    type: string,
    data: object,
    workspaceId?: string
): number {
    return saveSnapshot(connection.getNativeDb(), type, data, workspaceId)
}

export function getLatestAnalyticsDigest(
    connection: NativeConnectionManager,
    type: string,
    workspaceId?: string
): { id: number; createdAt: string; data: Record<string, unknown> } | null {
    return getLatestSnapshot(connection.getNativeDb(), type, workspaceId)
}

export function getAnalyticsSnapshots(
    connection: NativeConnectionManager,
    type: string,
    limit?: number,
    workspaceId?: string
): { id: number; createdAt: string; data: Record<string, unknown> }[] {
    return getSnapshots(connection.getNativeDb(), type, limit, workspaceId)
}

export function computeDigest(
    connection: NativeConnectionManager,
    workspaceId?: string
): DigestSnapshot {
    return computeDigestCore(connection.getNativeDb(), effectiveWorkspace(workspaceId))
}
