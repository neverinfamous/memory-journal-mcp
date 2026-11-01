import type { JournalEntry, EntryType } from '../../../types/index.js'
import type { NativeConnectionManager } from '../native-connection.js'
import {
    saveAnalyticsSnapshot as saveSnapshot,
    getLatestAnalyticsSnapshot as getLatestSnapshot,
    getAnalyticsSnapshots as getSnapshots,
    computeDigest as computeDigestCore,
} from '../entries/digest.js'

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
    if (workspaceId !== undefined && workspaceId !== '*') {
        sql += ` AND workspace_id = ?`
        params.push(workspaceId)
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`
    params.push(limit)

    const rows = connection.exec(sql, params)
    if (!rows[0] || rows[0].values.length === 0) return []

    const cols = rows[0].columns
    const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
    const tagsMap = new Map<number, string[]>()

    if (entryIds.length > 0) {
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
    }

    return rows[0].values.map((row: unknown[]): JournalEntry => {
        const getVal = (idx: number): unknown => row[idx]
        const id = getVal(cols.indexOf('id')) as number
        return {
            id,
            entryType: getVal(cols.indexOf('entry_type')) as EntryType,
            content: getVal(cols.indexOf('content')) as string,
            timestamp: getVal(cols.indexOf('timestamp')) as string,
            tags: tagsMap.get(id) ?? [],
            isPersonal: Boolean(getVal(cols.indexOf('is_personal'))),
            projectNumber: getVal(cols.indexOf('project_number')) as number | undefined,
            issueNumber: getVal(cols.indexOf('issue_number')) as number | undefined,
            prNumber: getVal(cols.indexOf('pr_number')) as number | undefined,
            prStatus: getVal(cols.indexOf('pr_status')) as string | undefined,
            workflowRunId: getVal(cols.indexOf('workflow_run_id')) as number | undefined,
            workflowName: getVal(cols.indexOf('workflow_name')) as string | undefined,
            workflowStatus: getVal(cols.indexOf('workflow_status')) as string | undefined,
            significanceType: getVal(cols.indexOf('significance_type')) as string | undefined,
            autoContext: getVal(cols.indexOf('auto_context')) as string | undefined,
            workspaceId: getVal(cols.indexOf('workspace_id')) as string | undefined,
        } as JournalEntry
    })
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
    if (workspaceId !== undefined && workspaceId !== '*') {
        sql += ` AND workspace_id = ?`
        params.push(workspaceId)
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`
    params.push(limit)

    const rows = connection.exec(sql, params)
    if (!rows[0] || rows[0].values.length === 0) return []

    const cols = rows[0].columns
    const entryIds = rows[0].values.map((row) => row[cols.indexOf('id')] as number)
    const tagsMap = new Map<number, string[]>()

    if (entryIds.length > 0) {
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
    }

    return rows[0].values.map((row: unknown[]): JournalEntry => {
        const getVal = (idx: number): unknown => row[idx]
        const id = getVal(cols.indexOf('id')) as number
        return {
            id,
            entryType: getVal(cols.indexOf('entry_type')) as EntryType,
            content: getVal(cols.indexOf('content')) as string,
            timestamp: getVal(cols.indexOf('timestamp')) as string,
            tags: tagsMap.get(id) ?? [],
            isPersonal: Boolean(getVal(cols.indexOf('is_personal'))),
            projectNumber: getVal(cols.indexOf('project_number')) as number | undefined,
            issueNumber: getVal(cols.indexOf('issue_number')) as number | undefined,
            prNumber: getVal(cols.indexOf('pr_number')) as number | undefined,
            significanceType: getVal(cols.indexOf('significance_type')) as string | undefined,
            workspaceId: getVal(cols.indexOf('workspace_id')) as string | undefined,
        } as JournalEntry
    })
}

export function saveAnalyticsDigest(
    connection: NativeConnectionManager,
    type: string,
    data: Record<string, unknown>
): number {
    return saveSnapshot(connection.getNativeDb(), type, data)
}

export function getLatestAnalyticsDigest(
    connection: NativeConnectionManager,
    type: string
): { id: number; createdAt: string; data: Record<string, unknown> } | null {
    return getLatestSnapshot(connection.getNativeDb(), type)
}

export function getAnalyticsSnapshots(
    connection: NativeConnectionManager,
    type: string,
    limit?: number
): { id: number; createdAt: string; data: Record<string, unknown> }[] {
    return getSnapshots(connection.getNativeDb(), type, limit)
}

export function computeDigest(
    connection: NativeConnectionManager,
    workspaceId?: string
): Record<string, unknown> {
    const digest = computeDigestCore(connection.getNativeDb(), workspaceId)
    return { ...digest }
}
