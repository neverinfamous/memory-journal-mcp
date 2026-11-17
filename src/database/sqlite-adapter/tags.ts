import type { Database } from 'better-sqlite3'
import { logger } from '../../utils/logger.js'
import { ResourceNotFoundError, QueryError, ValidationError } from '../../types/errors.js'
import type { Tag } from '../../types/index.js'
import type { NativeConnectionManager } from './native-connection.js'
import { effectiveWorkspace } from '../workspace-scope.js'
import { TAG_ALIASES } from '../../codemode/normalizers/shared-utils.js'
import { bucketInParams } from './row-helpers.js'

const hasDeletedAtCache = new WeakMap<Database, boolean>()

const REVERSE_TAG_ALIASES = new Map<string, string[]>()
for (const [alias, canonical] of Object.entries(TAG_ALIASES)) {
    const key = canonical.toLowerCase()
    const list = REVERSE_TAG_ALIASES.get(key) ?? []
    list.push(alias.toLowerCase())
    REVERSE_TAG_ALIASES.set(key, list)
}

/** Expand tag filter inputs with lowercase equivalents and bidirectional TAG_ALIASES synonyms. */
export function expandTagFilterValues(tags: readonly string[]): string[] {
    const expanded = new Set<string>()
    for (const raw of tags) {
        const lower = raw.trim().toLowerCase()
        if (lower === '') continue
        expanded.add(lower)
        const forward = TAG_ALIASES[lower]
        if (forward !== undefined) {
            const canonical = forward.toLowerCase()
            expanded.add(canonical)
            for (const sib of REVERSE_TAG_ALIASES.get(canonical) ?? []) {
                expanded.add(sib)
            }
        }
        for (const rev of REVERSE_TAG_ALIASES.get(lower) ?? []) {
            expanded.add(rev)
        }
    }
    return Array.from(expanded)
}

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

        const runLink = (): void => {
            const db = this.db
            const uniqueTags = Array.from(new Set(tagNames.filter((t) => t.length > 0)))
            if (uniqueTags.length === 0) return

            const CHUNK_SIZE = 500
            const tagIds: number[] = []
            for (let i = 0; i < uniqueTags.length; i += CHUNK_SIZE) {
                const tagChunk = uniqueTags.slice(i, i + CHUNK_SIZE)
                const insertPlaceholders = tagChunk.map(() => '(?, 0)').join(', ')
                db.prepare(
                    `INSERT OR IGNORE INTO tags (name, usage_count) VALUES ${insertPlaceholders}`
                ).run(...tagChunk)
            }
            for (const { placeholders, params } of bucketInParams(uniqueTags)) {
                const rows = db
                    .prepare(`SELECT id FROM tags WHERE name IN (${placeholders})`)
                    .all(...params) as { id: number }[]
                for (const row of rows) tagIds.push(row.id)
            }
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

            for (const { placeholders, params } of bucketInParams(newlyLinkedTagIds)) {
                db.prepare(
                    `UPDATE tags SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id IN (${placeholders})`
                ).run(...params)
            }
        }

        if (this.db.inTransaction) {
            runLink()
        } else {
            this.db.transaction(runLink)()
        }
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

        for (const { placeholders, params } of bucketInParams(ids)) {
            const rows = this.db
                .prepare(
                    `SELECT et.entry_id, t.name
                     FROM entry_tags et
                     JOIN tags t ON et.tag_id = t.id
                     WHERE et.entry_id IN (${placeholders})`
                )
                .all(...params) as { entry_id: number; name: string }[]

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

    listTags(workspaceId?: string, projectNumber?: number): Tag[] {
        const wsId = effectiveWorkspace(workspaceId)
        const scopedProject =
            typeof projectNumber === 'number' && Number.isFinite(projectNumber)
                ? projectNumber
                : undefined
        let hasDeletedAt = hasDeletedAtCache.get(this.db)
        if (hasDeletedAt === undefined) {
            hasDeletedAt =
                this.db
                    .prepare(
                        "SELECT 1 FROM pragma_table_info('memory_journal') WHERE name = 'deleted_at'"
                    )
                    .get() !== undefined
            hasDeletedAtCache.set(this.db, hasDeletedAt)
        }
        const filters = [hasDeletedAt ? 'mj.deleted_at IS NULL' : '1 = 1']
        const params: unknown[] = []
        if (wsId !== '*') {
            filters.push('mj.workspace_id = ?')
            params.push(wsId)
        }
        if (scopedProject !== undefined) {
            filters.push('mj.project_number = ?')
            params.push(scopedProject)
        }
        const rows = this.db
            .prepare(
                `SELECT t.id, t.name, COUNT(et.entry_id) as usage_count
                 FROM tags t
                 JOIN entry_tags et ON t.id = et.tag_id
                 JOIN memory_journal mj ON et.entry_id = mj.id
                 WHERE ${filters.join(' AND ')}
                 GROUP BY t.id, t.name
                 HAVING COUNT(et.entry_id) > 0
                 ORDER BY usage_count DESC`
            )
            .all(...params) as { id: number; name: string; usage_count: number }[]

        return rows.map((r) => ({ id: r.id, name: r.name, usageCount: r.usage_count }))
    }

    mergeTags(
        sourceTag: string,
        targetTag: string,
        workspaceId?: string,
        projectNumber?: number
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        if (sourceTag.trim().toLowerCase() === targetTag.trim().toLowerCase()) {
            throw new ValidationError(
                `Cannot merge tag '${sourceTag}' into itself ('${targetTag}').`
            )
        }
        const scopeId = effectiveWorkspace(workspaceId)
        const scopedWorkspace = scopeId === '*' ? undefined : scopeId
        const scopedProject =
            typeof projectNumber === 'number' && Number.isFinite(projectNumber)
                ? projectNumber
                : undefined

        const mergeOp = this.db.transaction(() => {
            const sourceTagId = this.resolveSourceTagId(sourceTag)
            const entryIds = this.selectSourceTagEntryIds(
                sourceTagId,
                scopedWorkspace,
                scopedProject
            )
            if (
                (scopedWorkspace !== undefined || scopedProject !== undefined) &&
                entryIds.length === 0
            ) {
                throw new ResourceNotFoundError('Tag', sourceTag)
            }
            const targetTagId = this.ensureTargetTagId(sourceTagId, targetTag)
            const entriesUpdated = this.linkTargetTagToEntries(targetTagId, entryIds)
            const sourceDeleted = this.detachSourceTag(
                sourceTagId,
                entryIds,
                scopedWorkspace,
                scopedProject
            )
            return { entriesUpdated, sourceDeleted }
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

    /** Select non-deleted entry ids linked to `sourceTagId` within the optional scope. */
    private selectSourceTagEntryIds(
        sourceTagId: number,
        scopedWorkspace: string | undefined,
        scopedProject: number | undefined
    ): number[] {
        const conditions = ['et.tag_id = ?', 'mj.deleted_at IS NULL']
        const selectParams: unknown[] = [sourceTagId]
        if (scopedWorkspace !== undefined) {
            conditions.push('mj.workspace_id = ?')
            selectParams.push(scopedWorkspace)
        }
        if (scopedProject !== undefined) {
            conditions.push('mj.project_number = ?')
            selectParams.push(scopedProject)
        }
        const entryRows = this.db
            .prepare(
                `SELECT et.entry_id FROM entry_tags et
                 JOIN memory_journal mj ON et.entry_id = mj.id
                 WHERE ${conditions.join(' AND ')}`
            )
            .all(...selectParams) as { entry_id: number }[]
        return entryRows.map((r) => r.entry_id)
    }

    /** Link entries not already linked to `targetTagId` in 500-row chunks and update usage count. */
    private linkTargetTagToEntries(targetTagId: number, entryIds: number[]): number {
        const db = this.db
        const existingRows = db
            .prepare('SELECT entry_id FROM entry_tags WHERE tag_id = ?')
            .all(targetTagId) as { entry_id: number }[]
        const existingEntryIds = new Set(existingRows.map((r) => r.entry_id))
        const newEntryIds = entryIds.filter((id) => !existingEntryIds.has(id))
        if (newEntryIds.length === 0) return 0

        const CHUNK_SIZE = 500
        let insertedCount = 0
        for (let i = 0; i < newEntryIds.length; i += CHUNK_SIZE) {
            const chunk = newEntryIds.slice(i, i + CHUNK_SIZE)
            const placeholders = chunk.map(() => '(?, ?)').join(', ')
            const params = chunk.flatMap((entryId) => [entryId, targetTagId])
            insertedCount += db
                .prepare(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ${placeholders}`)
                .run(...params).changes
        }
        if (insertedCount > 0) {
            db.prepare('UPDATE tags SET usage_count = usage_count + ? WHERE id = ?').run(
                insertedCount,
                targetTagId
            )
        }
        return insertedCount
    }

    /** Resolve an existing source tag id and purge orphaned `entry_tags` links. */
    private resolveSourceTagId(sourceTag: string): number {
        const db = this.db
        const sourceRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(sourceTag) as
            | { id: number }
            | undefined
        if (!sourceRow) throw new ResourceNotFoundError('Tag', sourceTag)
        const sourceTagId = sourceRow.id
        db.prepare(
            `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id NOT IN (SELECT id FROM memory_journal)`
        ).run(sourceTagId)
        return sourceTagId
    }

    /** Ensure target tag exists after scope checks succeed and purge orphaned `entry_tags` links. */
    private ensureTargetTagId(sourceTagId: number, targetTag: string): number {
        const db = this.db
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
        return targetTagId
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
        if (entryIds.length > 0) {
            const scopeConds: string[] = []
            const scopeParams: unknown[] = []
            if (scopedWorkspace !== undefined && scopedWorkspace !== '*') {
                scopeConds.push('workspace_id = ?')
                scopeParams.push(scopedWorkspace)
            }
            if (scopedProject !== undefined) {
                scopeConds.push('project_number = ?')
                scopeParams.push(scopedProject)
            }
            const projectClause =
                scopeConds.length > 0
                    ? ` AND entry_id IN (SELECT id FROM memory_journal WHERE ${scopeConds.join(' AND ')})`
                    : ''

            const CHUNK_SIZE = 500
            let totalDeleted = 0
            for (let i = 0; i < entryIds.length; i += CHUNK_SIZE) {
                const chunk = entryIds.slice(i, i + CHUNK_SIZE)
                const idPlaceholders = chunk.map(() => '?').join(', ')
                const delResult = db
                    .prepare(
                        `DELETE FROM entry_tags WHERE tag_id = ? AND entry_id IN (${idPlaceholders})${projectClause}`
                    )
                    .run(sourceTagId, ...chunk, ...scopeParams)
                totalDeleted += delResult.changes
            }
            db.prepare('UPDATE tags SET usage_count = MAX(0, usage_count - ?) WHERE id = ?').run(
                totalDeleted,
                sourceTagId
            )
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
