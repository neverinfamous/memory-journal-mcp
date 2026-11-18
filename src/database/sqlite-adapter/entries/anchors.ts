import type { Anchor, AnchorStatus } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { bucketInParams, SCOPED_IN_PARAM_BUCKETS } from '../row-helpers.js'

export function getAnchorsByEntryIds(
    context: EntriesSharedContext,
    entryIds: number[],
    workspaceId?: string
): Map<number, Anchor[]> {
    const result = new Map<number, Anchor[]>()
    if (entryIds.length === 0) return result

    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    const wsClause = scopeId === '*' ? '' : ' AND mj.workspace_id = ?'
    for (const { placeholders, params } of bucketInParams(entryIds, SCOPED_IN_PARAM_BUCKETS)) {
        const stmt = db.prepare(
            `SELECT ea.id, ea.entry_id as entryId, ea.anchor_path as anchorPath,
                    ea.anchor_type as anchorType, ea.status, ea.last_checked_at as lastCheckedAt
             FROM entry_anchors ea
             INNER JOIN memory_journal mj ON mj.id = ea.entry_id
             WHERE ea.entry_id IN (${placeholders}) AND mj.deleted_at IS NULL${wsClause}`
        )
        const rows = (scopeId === '*' ? stmt.all(...params) : stmt.all(...params, scopeId)) as Anchor[]
        for (const row of rows) {
            let list = result.get(row.entryId)
            if (list === undefined) {
                list = []
                result.set(row.entryId, list)
            }
            list.push(row)
        }
    }
    return result
}

export function insertAnchors(
    context: EntriesSharedContext,
    entryId: number,
    anchors?: { anchorPath: string; anchorType: string; status?: string | undefined }[]
): void {
    if (!anchors || anchors.length === 0) return

    const { db } = context
    const stmt = db.prepare(`
        INSERT INTO entry_anchors (entry_id, anchor_path, anchor_type, status, last_checked_at)
        VALUES (?, ?, ?, ?, NULL)
    `)

    const runInserts = (): void => {
        for (const a of anchors) {
            stmt.run(entryId, a.anchorPath, a.anchorType, a.status ?? 'pending')
        }
    }

    if (db.inTransaction) {
        runInserts()
    } else {
        db.transaction(runInserts)()
    }
}

export function getAnchorsByEntryId(
    context: EntriesSharedContext,
    entryId: number,
    workspaceId?: string
): Anchor[] {
    const { db } = context
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        const stmt = db.prepare(`
            SELECT ea.id, ea.entry_id as entryId, ea.anchor_path as anchorPath, ea.anchor_type as anchorType, ea.status, ea.last_checked_at as lastCheckedAt
            FROM entry_anchors ea
            INNER JOIN memory_journal mj ON mj.id = ea.entry_id
            WHERE ea.entry_id = ? AND mj.workspace_id = ? AND mj.deleted_at IS NULL
        `)
        return stmt.all(entryId, scopeId) as Anchor[]
    }
    const stmt = db.prepare(`
        SELECT ea.id, ea.entry_id as entryId, ea.anchor_path as anchorPath, ea.anchor_type as anchorType, ea.status, ea.last_checked_at as lastCheckedAt
        FROM entry_anchors ea
        INNER JOIN memory_journal mj ON mj.id = ea.entry_id
        WHERE ea.entry_id = ? AND mj.deleted_at IS NULL
    `)
    return stmt.all(entryId) as Anchor[]
}

/**
 * Update an anchor's status. The anchor must belong to an entry in `workspaceId`
 * (an omitted workspace means the default workspace); only an explicit '*' skips the scope.
 * Returns true when a row was changed.
 */
export function updateAnchorStatus(
    context: EntriesSharedContext,
    id: number,
    status: AnchorStatus,
    workspaceId?: string,
    projectNumber?: number
): boolean {
    const { db } = context
    const scope = effectiveWorkspace(workspaceId)
    const conditions = ['deleted_at IS NULL']
    const params: unknown[] = [status, id]
    if (scope !== '*') {
        conditions.push('workspace_id = ?')
        params.push(scope)
    }
    if (typeof projectNumber === 'number' && Number.isFinite(projectNumber)) {
        conditions.push('project_number = ?')
        params.push(projectNumber)
    }
    const result = db
        .prepare(
            `
        UPDATE entry_anchors
        SET status = ?, last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
              SELECT 1 FROM memory_journal mj
              WHERE mj.id = entry_anchors.entry_id AND ${conditions.join(' AND ')}
          )
    `
        )
        .run(...params)
    return result.changes > 0
}
