import type { Anchor, AnchorStatus } from '../../../types/index.js'
import type { EntriesSharedContext } from './shared.js'

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

export function updateAnchorStatus(context: EntriesSharedContext, id: number, status: AnchorStatus): void {
    const { db } = context
    db.prepare(`
        UPDATE entry_anchors 
        SET status = ?, last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, id)
}
