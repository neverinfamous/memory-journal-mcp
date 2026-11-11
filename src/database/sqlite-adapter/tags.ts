import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'
import { ResourceNotFoundError, QueryError } from '../../types/errors.js'
import type { Tag } from '../../types/index.js'
import type { NativeConnectionManager } from './native-connection.js'
import { effectiveWorkspace } from '../workspace-scope.js'

export class TagsManager {
    private ctx: NativeConnectionManager

    constructor(ctx: NativeConnectionManager) {
        this.ctx = ctx
    }

    private get db(): Database {
        return this.ctx.getNativeDb()
    }

    linkTagsToEntry(entryId: number, tagNames: string[]): void {
        if (tagNames.length === 0) return

        const linkOp = this.db.transaction(() => {
            const db = this.db
            const uniqueTags = Array.from(new Set(tagNames.filter((t) => t.length > 0)))
            if (uniqueTags.length === 0) return

            const insertPlaceholders = uniqueTags.map(() => '(?, 0)').join(', ')
            db.prepare(
                `INSERT OR IGNORE INTO tags (name, usage_count) VALUES ${insertPlaceholders}`
            ).run(...uniqueTags)

            const selectPlaceholders = uniqueTags.map(() => '?').join(', ')
            const rows = db
                .prepare(`SELECT id, name FROM tags WHERE name IN (${selectPlaceholders})`)
                .all(...uniqueTags) as { id: number; name: string }[]

            const tagIds = rows.map((r) => r.id)
            if (tagIds.length === 0) return

            const insertLinkStmt = db.prepare(
                'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)'
            )
            const newlyLinkedTagIds: number[] = []
            for (const tagId of tagIds) {
                const res = insertLinkStmt.run(entryId, tagId)
                if (res.changes > 0) {
                    newlyLinkedTagIds.push(tagId)
                }
            }

            if (newlyLinkedTagIds.length > 0) {
                const updatePlaceholders = newlyLinkedTagIds.map(() => '?').join(', ')
                db.prepare(
                    `UPDATE tags SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id IN (${updatePlaceholders})`
                ).run(...newlyLinkedTagIds)
            }
        })

        linkOp()
    }

    getTagsForEntry(entryId: number): string[] {
        const rows = this.db
            .prepare(
                `SELECT t.name FROM tags t
                 JOIN entry_tags et ON t.id = et.tag_id
                 WHERE et.entry_id = ?`
            )
            .all(entryId) as { name: string }[]

        return rows.map((r) => r.name)
    }

    batchGetTagsForEntries(ids: number[]): Map<number, string[]> {
        const tagMap = new Map<number, string[]>()
        if (ids.length === 0) return tagMap

        const CHUNK_SIZE = 900
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE)
            const placeholders = chunk.map(() => '?').join(', ')
            const rows = this.db
                .prepare(
                    `SELECT et.entry_id, t.name
                     FROM entry_tags et
                     JOIN tags t ON et.tag_id = t.id
                     WHERE et.entry_id IN (${placeholders})`
                )
                .all(...chunk) as { entry_id: number; name: string }[]

            for (const row of rows) {
                const existing = tagMap.get(row.entry_id)
                if (existing) {
                    existing.push(row.name)
                } else {
                    tagMap.set(row.entry_id, [row.name])
                }
            }
        }
        return tagMap
    }

    listTags(workspaceId?: string): Tag[] {
        const wsId = effectiveWorkspace(workspaceId)
        if (wsId !== '*') {
            const hasDeletedAt =
                this.db
                    .prepare(
                        "SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'deleted_at'"
                    )
                    .get() !== undefined
            const rows = this.db
                .prepare(
                    `SELECT t.id, t.name, COUNT(et.entry_id) as usage_count
                     FROM tags t
                     JOIN entry_tags et ON t.id = et.tag_id
                     JOIN memory_journal mj ON et.entry_id = mj.id
                     WHERE mj.workspace_id = ?${hasDeletedAt ? ' AND mj.deleted_at IS NULL' : ''}
                     GROUP BY t.id, t.name
                     HAVING COUNT(et.entry_id) > 0
                     ORDER BY usage_count DESC`
                )
                .all(wsId) as { id: number; name: string; usage_count: number }[]

            return rows.map((r) => ({ id: r.id, name: r.name, usageCount: r.usage_count }))
        }

        const rows = this.db
            .prepare(
                'SELECT id, name, COALESCE(usage_count, 0) as usage_count FROM tags WHERE COALESCE(usage_count, 0) > 0 ORDER BY usage_count DESC'
            )
            .all() as { id: number; name: string; usage_count: number }[]

        return rows.map((r) => ({ id: r.id, name: r.name, usageCount: r.usage_count }))
    }

    mergeTags(
        sourceTag: string,
        targetTag: string,
        workspaceId?: string,
        projectNumber?: number
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        const db = this.db

        const mergeOp = db.transaction(() => {
            const { sourceTagId, targetTagId } = this.prepareMergeTags(sourceTag, targetTag)

            // Select only valid entries (join ensures no orphans).
            // A positive project number still applies when workspace is '*'.
            const scopeId = effectiveWorkspace(workspaceId)
            const scopedWorkspace = scopeId === '*' ? undefined : scopeId
            const scopedProject =
                typeof projectNumber === 'number' && projectNumber > 0 ? projectNumber : undefined
            const conditions = ['et.tag_id = ?']
            const selectParams: unknown[] = [sourceTagId]
            if (scopedWorkspace !== undefined) {
                conditions.push('mj.workspace_id = ?')
                selectParams.push(scopedWorkspace)
            }
            if (scopedProject !== undefined) {
                conditions.push('mj.project_number = ?')
                selectParams.push(scopedProject)
            }
            const entryRows = db
                .prepare(
                    `SELECT et.entry_id FROM entry_tags et
                     JOIN memory_journal mj ON et.entry_id = mj.id
                     WHERE ${conditions.join(' AND ')}`
                )
                .all(...selectParams) as { entry_id: number }[]
            const entryIds = entryRows.map((r) => r.entry_id)

            // Pre-fetch entries already linked to targetTag in one query (O(1) vs O(N))
            const existingRows = db
                .prepare('SELECT entry_id FROM entry_tags WHERE tag_id = ?')
                .all(targetTagId) as { entry_id: number }[]
            const existingEntryIds = new Set(existingRows.map((r) => r.entry_id))

            // Filter to only entries that need linking
            const newEntryIds = entryIds.filter((id) => !existingEntryIds.has(id))

            if (newEntryIds.length > 0) {
                const placeholders = newEntryIds.map(() => '(?, ?)').join(', ')
                const params = newEntryIds.flatMap((entryId) => [entryId, targetTagId])
                db.prepare(
                    `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${placeholders}`
                ).run(...params)
            }

            if (newEntryIds.length > 0) {
                db.prepare('UPDATE tags SET usage_count = usage_count + ? WHERE id = ?').run(
                    newEntryIds.length,
                    targetTagId
                )
            }

            const sourceDeleted = this.detachSourceTag(
                sourceTagId,
                entryIds,
                scopedWorkspace,
                scopedProject
            )

            return { entriesUpdated: newEntryIds.length, sourceDeleted }
        })

        const result = mergeOp()

        this.ctx.scheduleSave()
        logger.info('Tags merged', {
            module: 'SqliteAdapter',
            operation: 'mergeTags',
            context: { sourceTag, targetTag, entriesUpdated: result.entriesUpdated },
        })

        return result
    }

    /** Resolve (creating the target if needed) tag ids and purge orphaned entry_tags links. */
    private prepareMergeTags(
        sourceTag: string,
        targetTag: string
    ): { sourceTagId: number; targetTagId: number } {
        const db = this.db
        const sourceRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(sourceTag) as
            | { id: number }
            | undefined
        if (!sourceRow) throw new ResourceNotFoundError('Tag', sourceTag)
        const sourceTagId = sourceRow.id

        db.prepare('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)').run(targetTag)
        const targetRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(targetTag) as
            | { id: number }
            | undefined
        if (!targetRow) throw new QueryError(`Failed to get or create target tag: ${targetTag}`)
        const targetTagId = targetRow.id

        // Clean orphaned entry_tags (entries permanently deleted but links remain)
        for (const tagId of [sourceTagId, targetTagId]) {
            db.prepare(
                `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id NOT IN (SELECT id FROM memory_journal)`
            ).run(tagId)
        }
        return { sourceTagId, targetTagId }
    }

    /**
     * Remove the source tag from the merged entries (all entries when unscoped), then delete
     * the source tag if no links remain. Returns whether the source tag was deleted.
     * A positive project number keeps the detach inside that project, including when workspace is '*'.
     */
    private detachSourceTag(
        sourceTagId: number,
        entryIds: number[],
        scopedWorkspace: string | undefined,
        scopedProject: number | undefined
    ): boolean {
        const db = this.db
        const scoped = scopedWorkspace !== undefined || scopedProject !== undefined
        if (scoped && entryIds.length > 0) {
            const idPlaceholders = entryIds.map(() => '?').join(', ')
            const params: unknown[] = [sourceTagId, ...entryIds]
            let projectClause = ''
            if (scopedProject !== undefined) {
                projectClause =
                    ' AND entry_id IN (SELECT id FROM memory_journal WHERE project_number = ?)'
                params.push(scopedProject)
            }
            db.prepare(
                `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id IN (${idPlaceholders})${projectClause}`
            ).run(...params)
            db.prepare('UPDATE tags SET usage_count = MAX(0, usage_count - ?) WHERE id = ?').run(
                entryIds.length,
                sourceTagId
            )
        } else if (!scoped) {
            db.prepare('DELETE FROM entry_tags WHERE tag_id = ?').run(sourceTagId)
        }

        const remaining = db
            .prepare('SELECT COUNT(*) as count FROM entry_tags WHERE tag_id = ?')
            .get(sourceTagId) as { count: number }
        const sourceDeleted = remaining.count === 0
        if (sourceDeleted) {
            db.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId)
        }
        return sourceDeleted
    }
}
