import { logger } from '../../utils/logger.js'
import { ResourceNotFoundError, QueryError } from '../../types/errors.js'
import type { Tag } from '../../types/index.js'
import type { IDatabaseConnection } from '../core/interfaces.js'

export class TagsManager {
    constructor(private ctx: IDatabaseConnection) {}

    linkTagsToEntry(entryId: number, tagNames: string[]): void {
        if (tagNames.length === 0) return
        const db = this.ctx

        const insertPlaceholders = tagNames.map(() => '(?, 0)').join(', ')
        db.run(`INSERT OR IGNORE INTO tags (name, usage_count) VALUES ${insertPlaceholders}`, tagNames)

        const selectPlaceholders = tagNames.map(() => '?').join(', ')
        const result = db.exec(`SELECT id, name FROM tags WHERE name IN (${selectPlaceholders})`, tagNames)

        const tagIds: number[] = []
        for (const row of result[0]?.values ?? []) {
            tagIds.push(row[0] as number)
        }
        if (tagIds.length === 0) return

        const linkPlaceholders = tagIds.map(() => '(?, ?)').join(', ')
        const linkParams = tagIds.flatMap((tagId) => [entryId, tagId])
        db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${linkPlaceholders}`, linkParams)

        const updatePlaceholders = tagIds.map(() => '?').join(', ')
        db.run(`UPDATE tags SET usage_count = usage_count + 1 WHERE id IN (${updatePlaceholders})`, tagIds)
    }

    getTagsForEntry(entryId: number): string[] {
        const db = this.ctx
        const result = db.exec(
            `
            SELECT t.name FROM tags t
            JOIN entry_tags et ON t.id = et.tag_id
            WHERE et.entry_id = ?
        `,
            [entryId]
        )
        if (result.length === 0) return []
        return (result[0]?.values ?? []).map((v: unknown[]) => v[0] as string)
    }

    batchGetTagsForEntries(ids: number[]): Map<number, string[]> {
        const tagMap = new Map<number, string[]>()
        if (ids.length === 0) return tagMap

        const db = this.ctx
        const placeholders = ids.map(() => '?').join(', ')
        const result = db.exec(
            `SELECT et.entry_id, t.name
             FROM entry_tags et
             JOIN tags t ON et.tag_id = t.id
             WHERE et.entry_id IN (${placeholders})`,
            ids
        )

        for (const row of result[0]?.values ?? []) {
            const entryId = row[0] as number
            const tagName = row[1] as string
            const existing = tagMap.get(entryId)
            if (existing) {
                existing.push(tagName)
            } else {
                tagMap.set(entryId, [tagName])
            }
        }
        return tagMap
    }

    listTags(): Tag[] {
        const db = this.ctx
        const result = db.exec('SELECT id, name, COALESCE(usage_count, 0) as usage_count FROM tags WHERE COALESCE(usage_count, 0) > 0 ORDER BY usage_count DESC')
        if (result.length === 0) return []
        return (result[0]?.values ?? []).map((v) => ({ id: v[0] as number, name: v[1] as string, usageCount: v[2] as number }))
    }

    mergeTags(sourceTag: string, targetTag: string): { entriesUpdated: number; sourceDeleted: boolean } {
        const db = this.ctx
        const sourceResult = db.exec('SELECT id FROM tags WHERE name = ?', [sourceTag])
        const sourceTagId = sourceResult[0]?.values[0]?.[0] as number | undefined
        if (sourceTagId === undefined) throw new ResourceNotFoundError('Tag', sourceTag)

        db.run('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)', [targetTag])
        const targetResult = db.exec('SELECT id FROM tags WHERE name = ?', [targetTag])
        const targetTagId = targetResult[0]?.values[0]?.[0] as number | undefined
        if (targetTagId === undefined) throw new QueryError(`Failed to get or create target tag: ${targetTag}`)

        const entriesResult = db.exec('SELECT entry_id FROM entry_tags WHERE tag_id = ?', [sourceTagId])
        const entryIds = entriesResult[0]?.values.map((v) => v[0] as number) ?? []
        // Pre-fetch entries already linked to targetTag in one query (O(1) vs O(N))
        const existingResult = db.exec(
            'SELECT entry_id FROM entry_tags WHERE tag_id = ?',
            [targetTagId]
        )
        const existingEntryIds = new Set(
            (existingResult[0]?.values ?? []).map((v) => v[0] as number)
        )

        // Filter to only entries that need linking
        const newEntryIds = entryIds.filter((id) => !existingEntryIds.has(id))
        const entriesUpdated = newEntryIds.length

        if (newEntryIds.length > 0) {
            const placeholders = newEntryIds.map(() => '(?, ?)').join(', ')
            const params = newEntryIds.flatMap((entryId) => [entryId, targetTagId])
            db.run(
                `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${placeholders}`,
                params
            )
        }

        if (entriesUpdated > 0) {
            db.run('UPDATE tags SET usage_count = usage_count + ? WHERE id = ?', [entriesUpdated, targetTagId])
        }

        db.run('DELETE FROM entry_tags WHERE tag_id = ?', [sourceTagId])
        db.run('DELETE FROM tags WHERE id = ?', [sourceTagId])

        this.ctx.scheduleSave()
        logger.info('Tags merged', { module: 'SqliteAdapter', operation: 'mergeTags', context: { sourceTag, targetTag, entriesUpdated } })

        return { entriesUpdated, sourceDeleted: true }
    }
}
