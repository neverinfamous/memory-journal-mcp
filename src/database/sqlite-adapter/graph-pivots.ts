/**
 * Graph Pivot Queries
 *
 * Recency-scoped, token-cheap relationship-graph queries used by the briefing
 * (`↔N` degree suffixes, active threads, 14-day unlinked rate, commit→entry refs)
 * and the `memory://graph/{+repo}` neighborhood resource.
 *
 * [INVARIANT] Every query excludes soft-deleted endpoints and, when a concrete
 * workspace is supplied (not '*'), requires BOTH endpoints to live in it.
 */

import type { Database } from 'better-sqlite3'
import { effectiveWorkspace } from '../workspace-scope.js'

export interface ActiveThreadRow {
    entryId: number
    entryType: string
    content: string
    recentLinks: number
}

export interface RecentLinkageStats {
    recentEntries: number
    unlinkedEntries: number
}

export interface NeighborhoodNode {
    id: number
    entryType: string
    content: string
    timestamp: string
}

export interface NeighborhoodEdge {
    from: number
    to: number
    type: string
}

export interface RecentNeighborhood {
    nodes: NeighborhoodNode[]
    edges: NeighborhoodEdge[]
    unlinkedIds: number[]
    recentEntries: number
}

interface ScopeInfo {
    scoped: boolean
    id: string
}

function scopeOf(workspaceId: string | undefined): ScopeInfo {
    const id = effectiveWorkspace(workspaceId)
    return { scoped: id !== '*', id }
}

/** SQL predicate: entry alias `alias` has at least one live (in-scope) peer. */
function linkedPredicate(alias: string, scoped: boolean): string {
    const peerWs = scoped ? ' AND p.workspace_id = ?' : ''
    return `(EXISTS (SELECT 1 FROM relationships r JOIN memory_journal p ON p.id = r.to_entry_id
                     WHERE r.from_entry_id = ${alias}.id AND r.to_entry_id != r.from_entry_id
                       AND p.deleted_at IS NULL${peerWs})
          OR EXISTS (SELECT 1 FROM relationships r JOIN memory_journal p ON p.id = r.from_entry_id
                     WHERE r.to_entry_id = ${alias}.id AND r.from_entry_id != r.to_entry_id
                       AND p.deleted_at IS NULL${peerWs}))`
}

/**
 * Count live, in-scope relationship endpoints for each requested entry id.
 * Entries with no links map to 0 so callers can render an orphan marker.
 */
export function queryRelationshipDegrees(
    db: Database,
    entryIds: readonly number[],
    workspaceId?: string
): Map<number, number> {
    const result = new Map<number, number>()
    const ids = [...new Set(entryIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (ids.length === 0) return result
    const { scoped, id: ws } = scopeOf(workspaceId)
    const peerWs = scoped ? ' AND p.workspace_id = ?' : ''
    const rows = db
        .prepare(
            `WITH ids(id) AS (SELECT CAST(value AS INTEGER) FROM json_each(?))
             SELECT ids.id AS entry_id,
                    (SELECT COUNT(*) FROM relationships r JOIN memory_journal p ON p.id = r.to_entry_id
                      WHERE r.from_entry_id = ids.id AND r.to_entry_id != r.from_entry_id
                        AND p.deleted_at IS NULL${peerWs})
                  + (SELECT COUNT(*) FROM relationships r JOIN memory_journal p ON p.id = r.from_entry_id
                      WHERE r.to_entry_id = ids.id AND r.from_entry_id != r.to_entry_id
                        AND p.deleted_at IS NULL${peerWs}) AS degree
             FROM ids`
        )
        .all(...(scoped ? [JSON.stringify(ids), ws, ws] : [JSON.stringify(ids)])) as {
        entry_id: number
        degree: number
    }[]
    for (const row of rows) result.set(row.entry_id, row.degree)
    return result
}

/**
 * Hubs of recent activity: entries (of any age) ranked by how many of their links
 * touch an entry created on/after `sinceIso`. Requires >= 2 such links so single
 * commit→note pairs don't crowd out real threads.
 */
export function queryActiveThreads(
    db: Database,
    sinceIso: string,
    limit: number,
    workspaceId?: string
): ActiveThreadRow[] {
    const { scoped, id: ws } = scopeOf(workspaceId)
    const recentWs = scoped ? ' AND workspace_id = ?' : ''
    const hubWs = scoped ? ' AND m.workspace_id = ?' : ''
    const peerWs = scoped ? ' AND p.workspace_id = ?' : ''
    const params: unknown[] = scoped ? [ws, sinceIso, ws, ws, limit] : [sinceIso, limit]
    const rows = db
        .prepare(
            `WITH recent AS (
                 SELECT id FROM memory_journal
                 WHERE deleted_at IS NULL${recentWs} AND julianday(timestamp) >= julianday(?)
             ),
             edges AS (
                 SELECT from_entry_id AS hub, to_entry_id AS peer FROM relationships WHERE from_entry_id != to_entry_id
                 UNION ALL
                 SELECT to_entry_id AS hub, from_entry_id AS peer FROM relationships WHERE from_entry_id != to_entry_id
             )
             SELECT e.hub AS entry_id, m.entry_type AS entry_type, m.content AS content, COUNT(*) AS recent_links
             FROM edges e
             JOIN memory_journal m ON m.id = e.hub AND m.deleted_at IS NULL${hubWs}
             JOIN memory_journal p ON p.id = e.peer AND p.deleted_at IS NULL${peerWs}
             WHERE e.hub IN (SELECT id FROM recent) OR e.peer IN (SELECT id FROM recent)
             GROUP BY e.hub
             HAVING COUNT(*) >= 2
             ORDER BY recent_links DESC, e.hub DESC
             LIMIT ?`
        )
        .all(...params) as {
        entry_id: number
        entry_type: string
        content: string
        recent_links: number
    }[]
    return rows.map((r) => ({
        entryId: r.entry_id,
        entryType: r.entry_type,
        content: r.content,
        recentLinks: r.recent_links,
    }))
}

/** Count entries created on/after `sinceIso` and how many of them have zero live links. */
export function queryRecentLinkageStats(
    db: Database,
    sinceIso: string,
    workspaceId?: string
): RecentLinkageStats {
    const { scoped, id: ws } = scopeOf(workspaceId)
    const entryWs = scoped ? ' AND e.workspace_id = ?' : ''
    // Bind order: linkedPredicate peer workspace (x2), outer workspace, window start.
    const params: unknown[] = scoped ? [ws, ws, ws, sinceIso] : [sinceIso]
    const row = db
        .prepare(
            `SELECT COUNT(*) AS recent,
                    COALESCE(SUM(CASE WHEN ${linkedPredicate('e', scoped)} THEN 0 ELSE 1 END), 0) AS unlinked
             FROM memory_journal e
             WHERE e.deleted_at IS NULL${entryWs} AND julianday(e.timestamp) >= julianday(?)`
        )
        .get(...params) as { recent: number; unlinked: number } | undefined
    return { recentEntries: row?.recent ?? 0, unlinkedEntries: row?.unlinked ?? 0 }
}

/**
 * Map commit SHAs (full or abbreviated, case-insensitive) to the earliest live entry whose
 * `auto_context.commits` contains them. The earliest entry is normally the commit narrative,
 * which is more specific than a later session summary listing the same SHA.
 */
export function queryEntryIdsByCommitShas(
    db: Database,
    shas: readonly string[],
    workspaceId?: string
): Map<string, number> {
    const result = new Map<string, number>()
    const wanted = [...new Set(shas.map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{7,40}$/.test(s)))]
    if (wanted.length === 0) return result
    const { scoped, id: ws } = scopeOf(workspaceId)
    const entryWs = scoped ? ' AND workspace_id = ?' : ''
    const params: unknown[] = scoped ? [ws, JSON.stringify(wanted)] : [JSON.stringify(wanted)]
    const rows = db
        .prepare(
            `WITH ctx AS MATERIALIZED (
                 SELECT id, auto_context FROM memory_journal
                 WHERE deleted_at IS NULL${entryWs}
                   AND auto_context IS NOT NULL AND auto_context LIKE '%"commits"%'
                   AND json_valid(auto_context) AND json_type(auto_context, '$.commits') = 'array'
             )
             SELECT s.value AS wanted, MIN(ctx.id) AS entry_id
             FROM ctx, json_each(ctx.auto_context, '$.commits') j, json_each(?) s
             WHERE j.type = 'text' AND substr(lower(j.value), 1, length(s.value)) = s.value
             GROUP BY s.value`
        )
        .all(...params) as { wanted: string; entry_id: number }[]
    for (const row of rows) result.set(row.wanted, row.entry_id)
    return result
}

/**
 * Compact recent neighborhood: edges touching an entry created on/after `sinceIso`
 * (newest relationships first, capped at `edgeLimit`), their endpoint nodes, and
 * recent entries with zero live links.
 */
export function queryRecentNeighborhood(
    db: Database,
    sinceIso: string,
    edgeLimit: number,
    workspaceId?: string
): RecentNeighborhood {
    const { scoped, id: ws } = scopeOf(workspaceId)
    const recentWs = scoped ? ' AND workspace_id = ?' : ''
    const endpointWs = scoped ? ' AND mf.workspace_id = ? AND mt.workspace_id = ?' : ''
    const edgeRows = db
        .prepare(
            `WITH recent AS (
                 SELECT id FROM memory_journal
                 WHERE deleted_at IS NULL${recentWs} AND julianday(timestamp) >= julianday(?)
             )
             SELECT r.from_entry_id AS from_id, r.to_entry_id AS to_id, r.relationship_type AS type
             FROM relationships r
             JOIN memory_journal mf ON mf.id = r.from_entry_id AND mf.deleted_at IS NULL
             JOIN memory_journal mt ON mt.id = r.to_entry_id AND mt.deleted_at IS NULL
             WHERE r.from_entry_id != r.to_entry_id${endpointWs}
               AND (r.from_entry_id IN (SELECT id FROM recent) OR r.to_entry_id IN (SELECT id FROM recent))
             ORDER BY r.id DESC
             LIMIT ?`
        )
        .all(...(scoped ? [ws, sinceIso, ws, ws, edgeLimit] : [sinceIso, edgeLimit])) as {
        from_id: number
        to_id: number
        type: string
    }[]
    const edges = edgeRows.map((r) => ({ from: r.from_id, to: r.to_id, type: r.type }))
    const nodeIds = [...new Set(edges.flatMap((e) => [e.from, e.to]))]
    const nodes =
        nodeIds.length === 0
            ? []
            : (
                  db
                      .prepare(
                          `SELECT id, entry_type, content, timestamp FROM memory_journal
                           WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
                           ORDER BY id DESC`
                      )
                      .all(JSON.stringify(nodeIds)) as {
                      id: number
                      entry_type: string
                      content: string
                      timestamp: string
                  }[]
              ).map((r) => ({
                  id: r.id,
                  entryType: r.entry_type,
                  content: r.content,
                  timestamp: r.timestamp,
              }))

    const entryWs = scoped ? ' AND e.workspace_id = ?' : ''
    const unlinkedRows = db
        .prepare(
            `SELECT e.id AS id FROM memory_journal e
             WHERE e.deleted_at IS NULL${entryWs} AND julianday(e.timestamp) >= julianday(?)
               AND NOT ${linkedPredicate('e', scoped)}
             ORDER BY e.id DESC`
        )
        .all(...(scoped ? [ws, sinceIso, ws, ws] : [sinceIso])) as { id: number }[]
    const stats = queryRecentLinkageStats(db, sinceIso, workspaceId)
    return {
        nodes,
        edges,
        unlinkedIds: unlinkedRows.map((r) => r.id),
        recentEntries: stats.recentEntries,
    }
}

/** ISO timestamp `days` days before now (UTC). */
export function isoDaysAgo(days: number, now: number = Date.now()): string {
    return new Date(now - Math.max(0, days) * 86_400_000).toISOString()
}

/**
 * Live in-scope entries (created on/after `sinceIso`) sharing at least one anchor path with
 * `entryId`, ranked by shared-anchor count then recency. Used for write-time link suggestions.
 */
export function queryEntriesSharingAnchors(
    db: Database,
    entryId: number,
    sinceIso: string,
    limit: number,
    workspaceId?: string
): { entryId: number; entryType: string; content: string; sharedAnchors: number }[] {
    const { scoped, id: ws } = scopeOf(workspaceId)
    const entryWs = scoped ? ' AND m.workspace_id = ?' : ''
    const mineWs = scoped ? ' AND me.workspace_id = ?' : ''
    const rows = db
        .prepare(
            `SELECT m.id AS entry_id, m.entry_type AS entry_type, m.content AS content,
                    COUNT(DISTINCT other.anchor_path) AS shared
             FROM entry_anchors mine
             JOIN memory_journal me ON me.id = mine.entry_id AND me.deleted_at IS NULL${mineWs}
             JOIN entry_anchors other ON other.anchor_path = mine.anchor_path AND other.entry_id != mine.entry_id
             JOIN memory_journal m ON m.id = other.entry_id AND m.deleted_at IS NULL${entryWs}
             WHERE mine.entry_id = ? AND julianday(m.timestamp) >= julianday(?)
             GROUP BY m.id
             ORDER BY shared DESC, m.id DESC
             LIMIT ?`
        )
        .all(...(scoped ? [ws, ws, entryId, sinceIso, limit] : [entryId, sinceIso, limit])) as {
        entry_id: number
        entry_type: string
        content: string
        shared: number
    }[]
    return rows.map((r) => ({
        entryId: r.entry_id,
        entryType: r.entry_type,
        content: r.content,
        sharedAnchors: r.shared,
    }))
}
