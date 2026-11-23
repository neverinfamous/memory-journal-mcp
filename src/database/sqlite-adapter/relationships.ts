import type { Database } from 'better-sqlite3'
import type { Relationship, RelationshipType } from '../../types/index.js'
import { ResourceNotFoundError } from '../../types/errors.js'
import type { NativeConnectionManager } from './native-connection.js'
import { effectiveWorkspace } from '../workspace-scope.js'
import { bucketInParams, DUAL_IN_PARAM_BUCKETS, runImmediateWriteTx } from './row-helpers.js'
import {
    queryActiveThreads,
    queryEntriesSharingAnchors,
    queryEntryIdsByCommitShas,
    queryRecentLinkageStats,
    queryRecentNeighborhood,
    queryRelationshipDegrees,
    type ActiveThreadRow,
    type RecentLinkageStats,
    type RecentNeighborhood,
} from './graph-pivots.js'

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

        // [INVARIANT] A supplied workspace, including '', scopes both endpoints ('' is default).
        // Omitted workspace stays unscoped so both endpoints must share one workspace. '*' stays unscoped.
        const scopeId = workspaceId === undefined ? undefined : effectiveWorkspace(workspaceId)
        const scoped = scopeId !== undefined && scopeId !== '*'
        const performInsert = (): number => {
            const wsStmt = db.prepare(
                `SELECT workspace_id FROM memory_journal WHERE id = ? AND deleted_at IS NULL${scoped ? ' AND workspace_id = ?' : ''}`
            )
            const getWs = (entryId: number): { workspace_id: string } | undefined =>
                (scoped ? wsStmt.get(entryId, scopeId) : wsStmt.get(entryId)) as
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

            return result.lastInsertRowid as number
        }
        const id =
            typeof db.transaction === 'function'
                ? runImmediateWriteTx(db, performInsert)
                : performInsert()

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
        const peerFilter = scoped
            ? 'mf.deleted_at IS NULL AND mt.deleted_at IS NULL AND mf.workspace_id = ? AND mt.workspace_id = ?'
            : 'mf.deleted_at IS NULL AND mt.deleted_at IS NULL'
        const buildParams = (first: unknown[]): unknown[] => (scoped ? [...first, scopeId, scopeId] : first)
        const rows = this.db
            .prepare(
                `SELECT r.id, r.from_entry_id as fromEntryId, r.to_entry_id as toEntryId,
                        r.relationship_type as relationshipType, r.description, r.created_at as createdAt
                 FROM relationships r
                 CROSS JOIN memory_journal mf ON mf.id = r.from_entry_id
                 CROSS JOIN memory_journal mt ON mt.id = r.to_entry_id
                 WHERE r.from_entry_id = ? AND ${peerFilter}
                 UNION ALL
                 SELECT r.id, r.from_entry_id as fromEntryId, r.to_entry_id as toEntryId,
                        r.relationship_type as relationshipType, r.description, r.created_at as createdAt
                 FROM relationships r
                 CROSS JOIN memory_journal mf ON mf.id = r.from_entry_id
                 CROSS JOIN memory_journal mt ON mt.id = r.to_entry_id
                 WHERE r.to_entry_id = ? AND r.from_entry_id != ? AND ${peerFilter}`
            )
            .all(...buildParams([entryId]), ...buildParams([entryId, entryId])) as {
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
        const wsFilter = scoped ? ' AND mf.workspace_id = ? AND mt.workspace_id = ?' : ''

        for (const id of entryIds) {
            result.set(id, [])
        }

        const seenRelIds = new Set<number>()
        for (const { placeholders, params } of bucketInParams(entryIds, DUAL_IN_PARAM_BUCKETS)) {
            const sql = `SELECT r.id, r.from_entry_id as fromEntryId, r.to_entry_id as toEntryId,
                                r.relationship_type as relationshipType, r.description, r.created_at as createdAt
                         FROM relationships r
                         CROSS JOIN memory_journal mf ON mf.id = r.from_entry_id
                         CROSS JOIN memory_journal mt ON mt.id = r.to_entry_id
                         WHERE r.from_entry_id IN (${placeholders})
                           AND mf.deleted_at IS NULL AND mt.deleted_at IS NULL${wsFilter}
                         UNION ALL
                         SELECT r.id, r.from_entry_id as fromEntryId, r.to_entry_id as toEntryId,
                                r.relationship_type as relationshipType, r.description, r.created_at as createdAt
                         FROM relationships r
                         CROSS JOIN memory_journal mf ON mf.id = r.from_entry_id
                         CROSS JOIN memory_journal mt ON mt.id = r.to_entry_id
                         WHERE r.to_entry_id IN (${placeholders})
                           AND mf.deleted_at IS NULL AND mt.deleted_at IS NULL${wsFilter}`
            const wsParams = scoped ? [scopeId, scopeId] : []
            const rows = this.db
                .prepare(sql)
                .all(...params, ...wsParams, ...params, ...wsParams) as {
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
        const scoped = scopeId !== '*'
        const peerFilter = scoped
            ? 'endpoint.deleted_at IS NULL AND peer.deleted_at IS NULL AND endpoint.workspace_id = ? AND peer.workspace_id = ?'
            : 'endpoint.deleted_at IS NULL AND peer.deleted_at IS NULL'
        const linkFrom = `SELECT r.from_entry_id as entry_id, COUNT(*) as link_count
               FROM relationships r
               JOIN memory_journal endpoint ON endpoint.id = r.from_entry_id
               JOIN memory_journal peer ON peer.id = r.to_entry_id
               WHERE ${peerFilter} AND r.from_entry_id != r.to_entry_id
               GROUP BY r.from_entry_id`
        const linkTo = `SELECT r.to_entry_id as entry_id, COUNT(*) as link_count
               FROM relationships r
               JOIN memory_journal endpoint ON endpoint.id = r.to_entry_id
               JOIN memory_journal peer ON peer.id = r.from_entry_id
               WHERE ${peerFilter} AND r.from_entry_id != r.to_entry_id
               GROUP BY r.to_entry_id`
        const wsFilter = scoped ? ' AND m.workspace_id = ?' : ''
        const params: unknown[] = scoped
            ? [scopeId, scopeId, scopeId, scopeId, scopeId, limit]
            : [limit]
        const rows = this.db
            .prepare(
                `SELECT counts.entry_id, SUM(counts.link_count) as total_links, m.content
                 FROM (
                     ${linkFrom}
                     UNION ALL
                     ${linkTo}
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
        const scopeId = effectiveWorkspace(workspaceId)
        const scoped = scopeId !== '*'
        const filter = scoped ? ' AND e.workspace_id = ?' : ''
        const peerFilter = scoped ? ' AND p.workspace_id = ?' : ''
        const params: unknown[] = scoped ? [scopeId, scopeId, scopeId] : []

        const row = this.db
            .prepare(
                `SELECT COUNT(*) as orphan_count
                 FROM memory_journal e
                 WHERE e.deleted_at IS NULL${filter}
                   AND NOT EXISTS (
                       SELECT 1 FROM relationships r
                       JOIN memory_journal p ON p.id = r.to_entry_id
                       WHERE r.from_entry_id = e.id AND r.to_entry_id != r.from_entry_id AND p.deleted_at IS NULL${peerFilter}
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM relationships r
                       JOIN memory_journal p ON p.id = r.from_entry_id
                       WHERE r.to_entry_id = e.id AND r.from_entry_id != r.to_entry_id AND p.deleted_at IS NULL${peerFilter}
                   )`
            )
            .get(...params) as { orphan_count: unknown } | undefined

        return typeof row?.orphan_count === 'number' ? row.orphan_count : 0
    }

    // ------------------------------------------------------------------
    // Graph pivots (briefing + memory://graph) — see graph-pivots.ts
    // ------------------------------------------------------------------

    getRelationshipDegrees(entryIds: readonly number[], workspaceId?: string): Map<number, number> {
        return queryRelationshipDegrees(this.db, entryIds, workspaceId)
    }

    getActiveThreads(sinceIso: string, limit: number, workspaceId?: string): ActiveThreadRow[] {
        return queryActiveThreads(this.db, sinceIso, limit, workspaceId)
    }

    getRecentLinkageStats(sinceIso: string, workspaceId?: string): RecentLinkageStats {
        return queryRecentLinkageStats(this.db, sinceIso, workspaceId)
    }

    getEntryIdsByCommitShas(shas: readonly string[], workspaceId?: string): Map<string, number> {
        return queryEntryIdsByCommitShas(this.db, shas, workspaceId)
    }

    getRecentNeighborhood(sinceIso: string, edgeLimit: number, workspaceId?: string): RecentNeighborhood {
        return queryRecentNeighborhood(this.db, sinceIso, edgeLimit, workspaceId)
    }

    getEntriesSharingAnchors(
        entryId: number,
        sinceIso: string,
        limit: number,
        workspaceId?: string,
        projectNumber?: number
    ): { entryId: number; entryType: string; content: string; sharedAnchors: number }[] {
        return queryEntriesSharingAnchors(
            this.db,
            entryId,
            sinceIso,
            limit,
            workspaceId,
            projectNumber
        )
    }
}
