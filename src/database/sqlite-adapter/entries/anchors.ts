import type { Anchor, AnchorStatus } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

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

    const insertMany = db.transaction(
        (anchorsList: { anchorPath: string; anchorType: string; status?: string | undefined }[]) => {
            for (const a of anchorsList) {
                stmt.run(entryId, a.anchorPath, a.anchorType, a.status ?? 'pending')
            }
        }
    )

    insertMany(anchors)
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
            SELECT id, entry_id as entryId, anchor_path as anchorPath, anchor_type as anchorType, status, last_checked_at as lastCheckedAt
            FROM entry_anchors
            WHERE entry_id = ?
              AND entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ? AND deleted_at IS NULL)
        `)
        return stmt.all(entryId, scopeId) as Anchor[]
    }
    const stmt = db.prepare(`
        SELECT id, entry_id as entryId, anchor_path as anchorPath, anchor_type as anchorType, status, last_checked_at as lastCheckedAt
        FROM entry_anchors
        WHERE entry_id = ?
          AND entry_id IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)
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
          AND entry_id IN (SELECT id FROM memory_journal WHERE ${conditions.join(' AND ')})
    `
        )
        .run(...params)
    return result.changes > 0
}
