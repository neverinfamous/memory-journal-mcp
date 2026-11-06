import type { Anchor, AnchorStatus } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

export function insertAnchors(context: EntriesSharedContext, entryId: number, anchors?: { anchorPath: string; anchorType: string }[]): void {
    if (!anchors || anchors.length === 0) return

    const { db } = context
    const stmt = db.prepare(`
        INSERT INTO entry_anchors (entry_id, anchor_path, anchor_type, status, last_checked_at)
        VALUES (?, ?, ?, 'pending', NULL)
    `)
    
    const insertMany = db.transaction((anchorsList: { anchorPath: string; anchorType: string }[]) => {
        for (const a of anchorsList) {
            stmt.run(entryId, a.anchorPath, a.anchorType)
        }
    })
    
    insertMany(anchors)
}

export function getAnchorsByEntryId(context: EntriesSharedContext, entryId: number): Anchor[] {
    const { db } = context
    const stmt = db.prepare(`
        SELECT id, entry_id as entryId, anchor_path as anchorPath, anchor_type as anchorType, status, last_checked_at as lastCheckedAt
        FROM entry_anchors
        WHERE entry_id = ?
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
    workspaceId?: string
): boolean {
    const { db } = context
    const scope = effectiveWorkspace(workspaceId)
    if (scope !== '*') {
        const result = db
            .prepare(
                `
        UPDATE entry_anchors
        SET status = ?, last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ?)
    `
            )
            .run(status, id, scope)
        return result.changes > 0
    }
    const result = db.prepare(`
        UPDATE entry_anchors 
        SET status = ?, last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, id)
    return result.changes > 0
}
