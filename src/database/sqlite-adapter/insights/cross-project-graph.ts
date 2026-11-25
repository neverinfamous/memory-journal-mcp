import type { NativeConnectionManager } from '../native-connection.js'
import {
    bucketInParams,
    chunkedInPredicate,
    DUAL_IN_PARAM_BUCKETS,
    SCOPED_IN_PARAM_BUCKETS,
} from '../row-helpers.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { expandTagFilterValues } from '../tags.js'

interface GraphQueryOptions {
    entryId?: number
    tags?: string[]
    relationshipType?: string
    depth: number
    limit: number
    projectNumber?: number
}

interface GraphScopeFilters {
    wsFilter: string
    wsParam: string[]
    nxWsFilter: string
    projSql: string
    nxProjFilter: string
    projParam: number[]
    hasRelType: boolean
    relTypeSql: string
    relTypeParam: string[]
    hasTags: boolean
    tagSubquery: string
    tagParams: string[]
    toPeerScope: string
    fromPeerScope: string
}

function buildGraphScopeFilters(
    options: GraphQueryOptions,
    scopeId: string
): GraphScopeFilters {
    const wsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
    const wsParam = scopeId !== '*' ? [scopeId] : []
    // [INTENT] Traversal must not hop through soft-deleted, foreign-workspace, or cross-project entries.
    const nxWsFilter = scopeId !== '*' ? ' AND nx.workspace_id = ?' : ''
    const projSql = options.projectNumber !== undefined ? ' AND mj.project_number = ?' : ''
    const nxProjFilter = options.projectNumber !== undefined ? ' AND nx.project_number = ?' : ''
    const projParam = options.projectNumber !== undefined ? [options.projectNumber] : []
    const relType = options.relationshipType
    const hasRelType = relType !== undefined && relType.length > 0
    const relTypeSql = hasRelType ? ' AND r.relationship_type = ?' : ''
    const relTypeParam = hasRelType ? [relType] : []

    const expandedTags =
        options.tags !== undefined && options.tags.length > 0
            ? expandTagFilterValues(options.tags)
            : []
    const tagMembership = chunkedInPredicate(
        expandedTags,
        (placeholders) => `LOWER(t.name) IN (${placeholders})`,
        'OR'
    )
    const hasTags = tagMembership.sql.length > 0
    const tagParams = tagMembership.params
    const tagSubquery = hasTags
        ? ` AND mj.id IN (
                  SELECT et.entry_id FROM entry_tags et
                  JOIN tags t ON et.tag_id = t.id
                  WHERE ${tagMembership.sql}
              )`
        : ''
    const toPeerScope = `${scopeId !== '*' ? ' AND mj_to.workspace_id = ?' : ''}${options.projectNumber !== undefined ? ' AND mj_to.project_number = ?' : ''}`
    const fromPeerScope = `${scopeId !== '*' ? ' AND mj_from.workspace_id = ?' : ''}${options.projectNumber !== undefined ? ' AND mj_from.project_number = ?' : ''}`

    return {
        wsFilter,
        wsParam,
        nxWsFilter,
        projSql,
        nxProjFilter,
        projParam,
        hasRelType,
        relTypeSql,
        relTypeParam,
        hasTags,
        tagSubquery,
        tagParams,
        toPeerScope,
        fromPeerScope,
    }
}

function buildRelExistsClause(f: GraphScopeFilters): string {
    return `(
        EXISTS (
            SELECT 1 FROM relationships r
            JOIN memory_journal mj_to ON r.to_entry_id = mj_to.id
            WHERE r.from_entry_id = mj.id AND r.from_entry_id != r.to_entry_id AND mj_to.deleted_at IS NULL${f.toPeerScope}${f.relTypeSql}
        )
        OR EXISTS (
            SELECT 1 FROM relationships r
            JOIN memory_journal mj_from ON r.from_entry_id = mj_from.id
            WHERE r.to_entry_id = mj.id AND r.from_entry_id != r.to_entry_id AND mj_from.deleted_at IS NULL${f.fromPeerScope}${f.relTypeSql}
        )
    )`
}

function queryConnectedGraphEntries(
    connection: NativeConnectionManager,
    entryId: number,
    depth: number,
    limit: number,
    f: GraphScopeFilters
): GraphEntryRow[] {
    const sql = `
        WITH RECURSIVE connected_entries(id, distance) AS (
            SELECT id, 0 FROM memory_journal mj WHERE mj.id = ? AND mj.deleted_at IS NULL${f.wsFilter}${f.projSql}
            UNION
            SELECT DISTINCT
                CASE
                    WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                    ELSE r.from_entry_id
                END,
                ce.distance + 1
            FROM connected_entries ce
            JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
            JOIN memory_journal nx ON nx.id = CASE
                    WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                    ELSE r.from_entry_id
                END
            WHERE ce.distance < ? AND r.from_entry_id != r.to_entry_id AND nx.deleted_at IS NULL${f.nxWsFilter}${f.nxProjFilter}${f.relTypeSql}
        ),
        deduped_ce AS (
            SELECT id, MIN(distance) AS distance
            FROM connected_entries
            GROUP BY id
        )
        SELECT mj.id, mj.entry_type, mj.content, mj.is_personal
        FROM deduped_ce ce
        CROSS JOIN memory_journal mj ON mj.id = ce.id
        WHERE mj.deleted_at IS NULL${f.wsFilter}${f.projSql}${f.tagSubquery}
        ORDER BY ce.distance ASC, mj.id DESC
        LIMIT ?
    `
    return connection
        .getNativeDb()
        .prepare<unknown[], GraphEntryRow>(sql)
        .all(
            entryId,
            ...f.wsParam,
            ...f.projParam,
            depth,
            ...f.wsParam,
            ...f.projParam,
            ...f.relTypeParam,
            ...f.wsParam,
            ...f.projParam,
            ...f.tagParams,
            limit
        )
}

interface GraphEntryRow {
    id: number
    entry_type: string
    content: string
    is_personal: number
}

function queryTaggedGraphEntries(
    connection: NativeConnectionManager,
    limit: number,
    f: GraphScopeFilters
): GraphEntryRow[] {
    const relPeerFilter = f.hasRelType ? ` AND ${buildRelExistsClause(f)}` : ''
    const relPeerParams = f.hasRelType
        ? [...f.wsParam, ...f.projParam, ...f.relTypeParam, ...f.wsParam, ...f.projParam, ...f.relTypeParam]
        : []
    return connection
        .getNativeDb()
        .prepare<unknown[], GraphEntryRow>(
            `
        SELECT mj.id, mj.entry_type, mj.content, mj.is_personal
        FROM memory_journal mj
        WHERE mj.deleted_at IS NULL${f.wsFilter}${f.projSql}${f.tagSubquery}${relPeerFilter}
        ORDER BY mj.id DESC
        LIMIT ?
    `
        )
        .all(...f.wsParam, ...f.projParam, ...f.tagParams, ...relPeerParams, limit)
}

function queryAllLinkedGraphEntries(
    connection: NativeConnectionManager,
    limit: number,
    f: GraphScopeFilters
): GraphEntryRow[] {
    return connection
        .getNativeDb()
        .prepare<unknown[], GraphEntryRow>(
            `
        SELECT mj.id, mj.entry_type, mj.content, mj.is_personal
        FROM memory_journal mj
        WHERE mj.deleted_at IS NULL${f.wsFilter}${f.projSql}
          AND ${buildRelExistsClause(f)}
        ORDER BY mj.id DESC
        LIMIT ?
    `
        )
        .all(
            ...f.wsParam,
            ...f.projParam,
            ...f.wsParam,
            ...f.projParam,
            ...f.relTypeParam,
            ...f.wsParam,
            ...f.projParam,
            ...f.relTypeParam,
            limit
        )
}

/** Select the entries to render in the relationship graph (by connected entry, tags, or all linked). */
function queryGraphEntries(
    connection: NativeConnectionManager,
    options: GraphQueryOptions,
    scopeId: string
): GraphEntryRow[] {
    const f = buildGraphScopeFilters(options, scopeId)
    if (options.entryId !== undefined) {
        return queryConnectedGraphEntries(connection, options.entryId, options.depth, options.limit, f)
    }
    if (f.hasTags) {
        return queryTaggedGraphEntries(connection, options.limit, f)
    }
    return queryAllLinkedGraphEntries(connection, options.limit, f)
}

export function visualizeRelationships(
    connection: NativeConnectionManager,
    options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
        workspaceId?: string
        projectNumber?: number
    }
): {
    nodes: {
        id: string | number
        label: string
        group: string
        metadata?: Record<string, unknown>
    }[]
    edges: { from: string | number; to: string | number; label: string; type: string }[]
} {
    const scopeId = effectiveWorkspace(options.workspaceId)
    const entryRows = queryGraphEntries(connection, options, scopeId)

    const nodes: {
        id: number
        label: string
        group: string
        metadata: { is_personal: boolean; content: string }
    }[] = entryRows.map((row) => ({
        id: row.id,
        group: row.entry_type,
        label: `Node ${String(row.id)}`,
        metadata: {
            content: row.content,
            is_personal: Boolean(row.is_personal),
        },
    }))

    const edges = nodes.length > 0 ? queryGraphEdges(connection, nodes, options.relationshipType) : []

    return { nodes, edges }
}

/** Fetch relationship edges among the given nodes, optionally filtered by type. */
function queryGraphEdges(
    connection: NativeConnectionManager,
    nodes: { id: number }[],
    relationshipType: string | undefined
): { from: string | number; to: string | number; label: string; type: string }[] {
    const db = connection.getNativeDb()
    const entryIds = nodes.map((n) => n.id)
    const hasRelType = relationshipType !== undefined && relationshipType.length > 0
    const relTypeSql = hasRelType ? ' AND relationship_type = ?' : ''
    const relTypeParams = hasRelType ? [relationshipType] : []

    if (entryIds.length <= 240) {
        const chunk = bucketInParams(entryIds, DUAL_IN_PARAM_BUCKETS)[0]
        if (!chunk) return []
        const rows = db
            .prepare<
                unknown[],
                { from_entry_id: number; to_entry_id: number; relationship_type: string }
            >(
                `SELECT from_entry_id, to_entry_id, relationship_type
                 FROM relationships
                 WHERE from_entry_id IN (${chunk.placeholders})
                   AND to_entry_id IN (${chunk.placeholders})
                   AND from_entry_id != to_entry_id${relTypeSql}`
            )
            .all(...chunk.params, ...chunk.params, ...relTypeParams)
        return rows.map((row) => ({
            from: row.from_entry_id,
            to: row.to_entry_id,
            label: row.relationship_type,
            type: row.relationship_type,
        }))
    }

    const idSet = new Set(entryIds)
    const edges: { from: string | number; to: string | number; label: string; type: string }[] = []
    for (const { placeholders, params } of bucketInParams(entryIds, SCOPED_IN_PARAM_BUCKETS)) {
        const rows = db
            .prepare<
                unknown[],
                { from_entry_id: number; to_entry_id: number; relationship_type: string }
            >(
                `SELECT from_entry_id, to_entry_id, relationship_type
                 FROM relationships
                 WHERE from_entry_id IN (${placeholders})
                   AND from_entry_id != to_entry_id${relTypeSql}`
            )
            .all(...params, ...relTypeParams)
        for (const row of rows) {
            if (idSet.has(row.to_entry_id)) {
                edges.push({
                    from: row.from_entry_id,
                    to: row.to_entry_id,
                    label: row.relationship_type,
                    type: row.relationship_type,
                })
            }
        }
    }
    return edges
}

export function getRecentGraphRelationships(
    connection: NativeConnectionManager,
    limit: number,
    workspaceId?: string
): {
    from_entry_id: number
    to_entry_id: number
    relationship_type: string
    from_content: string
    to_content: string
}[] {
    const db = connection.getNativeDb()
    const scopeId = effectiveWorkspace(workspaceId)
    if (scopeId !== '*') {
        const hasRow = db
            .prepare('SELECT 1 FROM memory_journal WHERE deleted_at IS NULL AND workspace_id = ? LIMIT 1')
            .get(scopeId)
        if (hasRow === undefined) return []
    }
    const wsFilter = scopeId !== '*' ? ' AND e1.workspace_id = ? AND e2.workspace_id = ?' : ''
    const params: unknown[] = scopeId !== '*' ? [scopeId, scopeId, limit] : [limit]
    return db
        .prepare<
            unknown[],
            {
                from_entry_id: number
                to_entry_id: number
                relationship_type: string
                from_content: string
                to_content: string
            }
        >(
            `
        SELECT
            r.from_entry_id, r.to_entry_id, r.relationship_type,
            e1.content as from_content,
            e2.content as to_content
        FROM relationships r
        CROSS JOIN memory_journal e1 ON r.from_entry_id = e1.id
        CROSS JOIN memory_journal e2 ON r.to_entry_id = e2.id
        WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id${wsFilter}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?
    `
        )
        .all(...params)
}
