import type { Database } from 'better-sqlite3'
import type { Relationship, RelationshipType } from '../../types/index.js'
import { ResourceNotFoundError } from '../../types/errors.js'
import type { NativeConnectionManager } from './native-connection.js'
import { effectiveWorkspace } from '../workspace-scope.js'

export class RelationshipsManager {
    private ctx: NativeConnectionManager

    constructor(ctx: NativeConnectionManager) {
        this.ctx = ctx
    }

    private get db(): Database {
        return this.ctx.getNativeDb()
    }

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string,
        workspaceId?: string
    ): Relationship {
        const db = this.db

        // Workspace enforcement: when workspaceId is provided (and not '*'), both endpoints
        // must belong to that workspace. When omitted, both endpoints must share the same workspace.
        const scoped = workspaceId !== undefined && workspaceId !== '*'
        const wsStmt = db.prepare(
            `SELECT workspace_id FROM memory_journal WHERE id = ? AND deleted_at IS NULL${scoped ? ' AND workspace_id = ?' : ''}`
        )
        const getWs = (entryId: number): { workspace_id: string } | undefined =>
            (scoped ? wsStmt.get(entryId, workspaceId) : wsStmt.get(entryId)) as
                | { workspace_id: string }
                | undefined
        const fromRow = getWs(fromEntryId)
        if (!fromRow) {
            throw new ResourceNotFoundError('Entry', String(fromEntryId))
        }
        const toRow = getWs(toEntryId)
        if (!toRow || (workspaceId === undefined && fromRow.workspace_id !== toRow.workspace_id)) {
            throw new ResourceNotFoundError('Entry', String(toEntryId))
        }

        const result = db
            .prepare(
                `INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type, description)
                 VALUES (?, ?, ?, ?)`
            )
            .run(fromEntryId, toEntryId, relationshipType, description ?? null)

        const id = result.lastInsertRowid as number

        this.ctx.scheduleSave()

        return {
            id,
            fromEntryId,
            toEntryId,
            relationshipType,
            description: description ?? null,
            createdAt: new Date().toISOString(),
        }
    }

    /**
     * Relationships touching an entry. When `workspaceId` is provided (and not '*'), only
     * relationships whose both endpoints are in that workspace are returned.
     */
    getRelationships(entryId: number, workspaceId?: string): Relationship[] {
        const scopeId = effectiveWorkspace(workspaceId)
        const scoped = scopeId !== '*'
        const rows = this.db
            .prepare(
                `SELECT id, from_entry_id as fromEntryId, to_entry_id as toEntryId,
                        relationship_type as relationshipType, description, created_at as createdAt
                 FROM relationships
                 WHERE (from_entry_id = ? OR to_entry_id = ?)${
                     scoped
                         ? ` AND from_entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ?)
                             AND to_entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ?)`
                         : ''
                 }`
            )
            .all(...(scoped ? [entryId, entryId, scopeId, scopeId] : [entryId, entryId])) as {
            id: number
            fromEntryId: number
            toEntryId: number
            relationshipType: RelationshipType
            description: string | null
            createdAt: string
        }[]

        return rows
    }

    getRelationshipsForEntries(
        entryIds: number[],
        workspaceId?: string
    ): Map<number, Relationship[]> {
        const result = new Map<number, Relationship[]>()
        if (entryIds.length === 0) return result
        const scopeId = effectiveWorkspace(workspaceId)
        const scoped = scopeId !== '*'
        const wsClause = scoped
            ? ` AND from_entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ?)
                AND to_entry_id IN (SELECT id FROM memory_journal WHERE workspace_id = ?)`
            : ''
        const wsParams: unknown[] = scoped ? [scopeId, scopeId] : []

        for (const id of entryIds) {
            result.set(id, [])
        }

        const seenRelIds = new Set<number>()
        const chunkSize = 100
        for (let i = 0; i < entryIds.length; i += chunkSize) {
            const chunk = entryIds.slice(i, i + chunkSize)
            const marks = chunk.map(() => '?').join(', ')
            const rows = this.db
                .prepare(
                    `SELECT id, from_entry_id as fromEntryId, to_entry_id as toEntryId,
                            relationship_type as relationshipType, description, created_at as createdAt
                     FROM relationships
                     WHERE (from_entry_id IN (${marks}) OR to_entry_id IN (${marks}))${wsClause}`
                )
                .all(...chunk, ...chunk, ...wsParams) as {
                id: number
                fromEntryId: number
                toEntryId: number
                relationshipType: RelationshipType
                description: string | null
                createdAt: string
            }[]

            for (const row of rows) {
                if (seenRelIds.has(row.id)) continue
                seenRelIds.add(row.id)

                const rel = {
                    id: row.id,
                    fromEntryId: row.fromEntryId,
                    toEntryId: row.toEntryId,
                    relationshipType: row.relationshipType,
                    description: row.description,
                    createdAt: row.createdAt,
                }
                const fromList = result.get(row.fromEntryId)
                if (fromList) {
                    fromList.push(rel)
                }
                if (row.fromEntryId !== row.toEntryId) {
                    const toList = result.get(row.toEntryId)
                    if (toList) {
                        toList.push(rel)
                    }
                }
            }
        }

        return result
    }

    /**
     * Get the top relationship hubs — entries with the most connections.
     * Used by the briefing resource to surface knowledge graph highlights.
     */
    getRelationshipHubs(
        limit: number,
        workspaceId?: string
    ): { entryId: number; content: string; totalLinks: number }[] {
        const scopeId = effectiveWorkspace(workspaceId)
        const wsFilter = scopeId !== '*' ? ' AND m.workspace_id = ?' : ''
        const params: unknown[] = scopeId !== '*' ? [scopeId, limit] : [limit]
        const rows = this.db
            .prepare(
                `SELECT counts.entry_id, SUM(counts.link_count) as total_links, m.content
                 FROM (
                     SELECT from_entry_id as entry_id, COUNT(*) as link_count FROM relationships GROUP BY from_entry_id
                     UNION ALL
                     SELECT to_entry_id as entry_id, COUNT(*) as link_count FROM relationships GROUP BY to_entry_id
                 ) counts
                 JOIN memory_journal m ON counts.entry_id = m.id
                 WHERE m.deleted_at IS NULL${wsFilter}
                 GROUP BY counts.entry_id
                 ORDER BY total_links DESC
                 LIMIT ?`
            )
            .all(...params) as { entry_id: number; total_links: number; content: string }[]

        return rows.map((row) => ({
            entryId: row.entry_id,
            totalLinks: row.total_links,
            content: row.content,
        }))
    }

    /**
     * Count entries with no relationships (orphans).
     * Used by the briefing resource to compute orphan ratio.
     */
    getOrphanCount(workspaceId?: string): number {
        let filter = ''
        const params: unknown[] = []
        const scopeId = effectiveWorkspace(workspaceId)
        if (scopeId !== '*') {
            filter = ' AND e.workspace_id = ?'
            params.push(scopeId)
        }

        const row = this.db
            .prepare(
                `SELECT COUNT(*) as orphan_count
                 FROM memory_journal e
                 WHERE e.deleted_at IS NULL${filter} AND e.id NOT IN (
                     SELECT from_entry_id FROM relationships
                     UNION
                     SELECT to_entry_id FROM relationships
                 )`
            )
            .get(...params) as { orphan_count: number } | undefined

        return row?.orphan_count ?? 0
    }
}
