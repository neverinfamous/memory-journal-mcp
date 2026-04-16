import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'
import { ResourceNotFoundError, QueryError } from '../../types/errors.js'
import type { Tag } from '../../types/index.js'
import type { NativeConnectionManager } from './native-connection.js'

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
        const db = this.db

        const insertPlaceholders = tagNames.map(() => '(?, 0)').join(', ')
        db.prepare(
            `INSERT OR IGNORE INTO tags (name, usage_count) VALUES ${insertPlaceholders}`
        ).run(...tagNames)

        const selectPlaceholders = tagNames.map(() => '?').join(', ')
        const rows = db
            .prepare(`SELECT id, name FROM tags WHERE name IN (${selectPlaceholders})`)
            .all(...tagNames) as { id: number; name: string }[]

        const tagIds = rows.map((r) => r.id)
        if (tagIds.length === 0) return

        const linkPlaceholders = tagIds.map(() => '(?, ?)').join(', ')
        const linkParams = tagIds.flatMap((tagId) => [entryId, tagId])
        db.prepare(
            `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${linkPlaceholders}`
        ).run(...linkParams)

        const updatePlaceholders = tagIds.map(() => '?').join(', ')
        db.prepare(
            `UPDATE tags
             SET usage_count = (
                 SELECT COUNT(*)
                 FROM entry_tags et
                 WHERE et.tag_id = tags.id
             )
             WHERE id IN (${updatePlaceholders})`
        ).run(...tagIds)
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

        const placeholders = ids.map(() => '?').join(', ')
        const rows = this.db
            .prepare(
                `SELECT et.entry_id, t.name
                 FROM entry_tags et
                 JOIN tags t ON et.tag_id = t.id
                 WHERE et.entry_id IN (${placeholders})`
            )
            .all(...ids) as { entry_id: number; name: string }[]

        for (const row of rows) {
            const existing = tagMap.get(row.entry_id)
            if (existing) {
                existing.push(row.name)
            } else {
                tagMap.set(row.entry_id, [row.name])
            }
        }
        return tagMap
    }

    listTags(): Tag[] {
        const rows = this.db
            .prepare(
                'SELECT id, name, COALESCE(usage_count, 0) as usage_count FROM tags WHERE COALESCE(usage_count, 0) > 0 ORDER BY usage_count DESC'
            )
            .all() as { id: number; name: string; usage_count: number }[]

        return rows.map((r) => ({ id: r.id, name: r.name, usageCount: r.usage_count }))
    }

    mergeTags(
        sourceTag: string,
        targetTag: string
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        const db = this.db

        const mergeOp = db.transaction(() => {
            const sourceRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(sourceTag) as
                | { id: number }
                | undefined
            if (!sourceRow) throw new ResourceNotFoundError('Tag', sourceTag)
            const sourceTagId = sourceRow.id

            db.prepare('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)').run(
                targetTag
            )
            const targetRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(targetTag) as
                | { id: number }
                | undefined
            if (!targetRow) throw new QueryError(`Failed to get or create target tag: ${targetTag}`)
            const targetTagId = targetRow.id

            // Clean orphaned entry_tags (entries permanently deleted but links remain)
            db.prepare(
                `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id NOT IN (SELECT id FROM memory_journal)`
            ).run(sourceTagId)
            db.prepare(
                `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id NOT IN (SELECT id FROM memory_journal)`
            ).run(targetTagId)

            // Select only valid entries (join ensures no orphans)
            const entryRows = db
                .prepare(
                    `SELECT et.entry_id FROM entry_tags et
                     JOIN memory_journal mj ON et.entry_id = mj.id
                     WHERE et.tag_id = ?`
                )
                .all(sourceTagId) as { entry_id: number }[]
            const entryIds = entryRows.map((r) => r.entry_id)

            // Pre-fetch entries already linked to targetTag in one query (O(1) vs O(N))
            const existingRows = db
                .prepare('SELECT entry_id FROM entry_tags WHERE tag_id = ?')
                .all(targetTagId) as { entry_id: number }[]
            const existingEntryIds = new Set(existingRows.map((r) => r.entry_id))

            // Filter to only entries that need linking
            const newEntryIds = entryIds.filter((id) => !existingEntryIds.has(id))
            const entriesUpdated = newEntryIds.length

            if (newEntryIds.length > 0) {
                const placeholders = newEntryIds.map(() => '(?, ?)').join(', ')
                const params = newEntryIds.flatMap((entryId) => [entryId, targetTagId])
                db.prepare(
                    `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${placeholders}`
                ).run(...params)
            }

            if (entriesUpdated > 0) {
                db.prepare('UPDATE tags SET usage_count = usage_count + ? WHERE id = ?').run(
                    entriesUpdated,
                    targetTagId
                )
            }

            db.prepare('DELETE FROM entry_tags WHERE tag_id = ?').run(sourceTagId)
            db.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId)

            return { entriesUpdated, sourceDeleted: true }
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
}
