import type { JournalEntry } from '../../../types/index.js'
import type { NativeConnectionManager } from '../native-connection.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { ENTRY_COLUMNS } from '../entries/shared.js'
import { bucketInParams } from '../row-helpers.js'
import {
    saveAnalyticsSnapshot as saveSnapshot,
    getLatestAnalyticsSnapshot as getLatestSnapshot,
    getAnalyticsSnapshots as getSnapshots,
    computeDigest as computeDigestCore,
    type DigestSnapshot,
} from '../entries/digest.js'

type RawEntryRow = Omit<JournalEntry, 'tags' | 'isPersonal' | 'isArchived'> & {
    isPersonal: number | boolean
    isArchived: number | boolean
}

function hydrateTagsMap(connection: NativeConnectionManager, entryIds: number[]): Map<number, string[]> {
    const tagsMap = new Map<number, string[]>()
    if (entryIds.length === 0) return tagsMap
    const db = connection.getNativeDb()
    for (const { placeholders, params } of bucketInParams(entryIds)) {
        const rows = db
            .prepare<unknown[], { entryId: number; tag: string }>(
                `SELECT entry_tags.entry_id as entryId, tags.name as tag
                 FROM entry_tags
                 JOIN tags ON entry_tags.tag_id = tags.id
                 WHERE entry_tags.entry_id IN (${placeholders})`
            )
            .all(...params)
        for (const row of rows) {
            const list = tagsMap.get(row.entryId)
            if (list) {
                list.push(row.tag)
            } else {
                tagsMap.set(row.entryId, [row.tag])
            }
        }
    }
    return tagsMap
}

function rowsToDigestEntries(
    connection: NativeConnectionManager,
    rows: RawEntryRow[]
): JournalEntry[] {
    if (rows.length === 0) return []
    const tagsMap = hydrateTagsMap(
        connection,
        rows.map((r) => r.id)
    )
    return rows.map((row) => ({
        ...row,
        tags: tagsMap.get(row.id) ?? [],
        isPersonal: Boolean(row.isPersonal),
        isArchived: Boolean(row.isArchived),
        significanceType: row.significanceType ?? null,
        autoContext: row.autoContext ?? null,
        deletedAt: row.deletedAt ?? null,
        version: row.version ?? 1,
    }))
}

export function getWorkflowActionEntries(
    connection: NativeConnectionManager,
    limit: number,
    workspaceId?: string
): JournalEntry[] {
    let sql = `
        SELECT ${ENTRY_COLUMNS} FROM memory_journal
        WHERE workflow_run_id IS NOT NULL AND deleted_at IS NULL
    `
    const params: unknown[] = []
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        sql += ` AND workspace_id = ?`
        params.push(scopeId)
    }
    sql += ` ORDER BY timestamp DESC, id DESC LIMIT ?`
    params.push(limit)

    const rows = connection.getNativeDb().prepare<unknown[], RawEntryRow>(sql).all(...params)
    return rowsToDigestEntries(connection, rows)
}

export function getSignificantEntries(
    connection: NativeConnectionManager,
    limit: number,
    projectNumber?: number,
    workspaceId?: string
): JournalEntry[] {
    let sql = `
        SELECT ${ENTRY_COLUMNS} FROM memory_journal
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
    sql += ` ORDER BY timestamp DESC, id DESC LIMIT ?`
    params.push(limit)

    const rows = connection.getNativeDb().prepare<unknown[], RawEntryRow>(sql).all(...params)
    return rowsToDigestEntries(connection, rows)
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
