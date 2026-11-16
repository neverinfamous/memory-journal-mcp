import type { NativeConnectionManager } from '../native-connection.js'
import type { QueryResult } from '../../core/interfaces.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

/** Select the entries to render in the relationship graph (by connected entry, tags, or all linked). */
function queryGraphEntries(
    connection: NativeConnectionManager,
    options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
        projectNumber?: number
    },
    scopeId: string
): QueryResult[] {
    const wsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
    const wsParam = scopeId !== '*' ? [scopeId] : []
    // [INTENT] Traversal must not hop through soft-deleted, foreign-workspace, or cross-project entries.
    const nxWsFilter = scopeId !== '*' ? ' AND nx.workspace_id = ?' : ''
    const projSql = options.projectNumber !== undefined ? ' AND mj.project_number = ?' : ''
    const nxProjFilter = options.projectNumber !== undefined ? ' AND nx.project_number = ?' : ''
    const projParam = options.projectNumber !== undefined ? [options.projectNumber] : []
    const hasRelType = options.relationshipType !== undefined && options.relationshipType.length > 0
    const relTypeSql = hasRelType ? ' AND r.relationship_type = ?' : ''
    const relTypeParam = hasRelType ? [options.relationshipType] : []

    const tags = options.tags ?? []
    const hasTags = tags.length > 0
    const tagPlaceholders = hasTags ? tags.map(() => '?').join(',') : ''
    const tagSubquery = hasTags
        ? ` AND mj.id IN (
                  SELECT et.entry_id FROM entry_tags et
                  JOIN tags t ON et.tag_id = t.id
                  WHERE LOWER(t.name) IN (${tagPlaceholders})
              )`
        : ''
    const tagParams = tags.map((t) => t.trim().toLowerCase())
    const toPeerScope = `${scopeId !== '*' ? ' AND mj_to.workspace_id = ?' : ''}${options.projectNumber !== undefined ? ' AND mj_to.project_number = ?' : ''}`
    const fromPeerScope = `${scopeId !== '*' ? ' AND mj_from.workspace_id = ?' : ''}${options.projectNumber !== undefined ? ' AND mj_from.project_number = ?' : ''}`

    if (options.entryId !== undefined) {
        return connection.exec(
            `
            WITH RECURSIVE connected_entries(id, distance) AS (
                SELECT id, 0 FROM memory_journal mj WHERE mj.id = ? AND mj.deleted_at IS NULL${wsFilter}${projSql}
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
                WHERE ce.distance < ? AND nx.deleted_at IS NULL${nxWsFilter}${nxProjFilter}${relTypeSql}
            )
            SELECT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            JOIN connected_entries ce ON mj.id = ce.id
            WHERE mj.deleted_at IS NULL${wsFilter}${projSql}${tagSubquery}
            GROUP BY mj.id
            ORDER BY MIN(ce.distance) ASC, mj.id DESC
            LIMIT ?
        `,
            [
                options.entryId,
                ...wsParam,
                ...projParam,
                options.depth,
                ...wsParam,
                ...projParam,
                ...relTypeParam,
                ...wsParam,
                ...projParam,
                ...tagParams,
                options.limit,
            ]
        )
    }
    const relPeerFilter = hasRelType
        ? `
              AND mj.id IN (
                  SELECT DISTINCT r.from_entry_id FROM relationships r
                  JOIN memory_journal mj_to ON r.to_entry_id = mj_to.id
                  WHERE mj_to.deleted_at IS NULL${toPeerScope}${relTypeSql}
                  UNION
                  SELECT DISTINCT r.to_entry_id FROM relationships r
                  JOIN memory_journal mj_from ON r.from_entry_id = mj_from.id
                  WHERE mj_from.deleted_at IS NULL${fromPeerScope}${relTypeSql}
              )`
        : ''
    if (hasTags) {
        return connection.exec(
            `
            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            WHERE mj.deleted_at IS NULL${wsFilter}${projSql}${tagSubquery}${relPeerFilter}
            ORDER BY mj.id DESC
            LIMIT ?
        `,
            [
                ...wsParam,
                ...projParam,
                ...tagParams,
                ...(hasRelType
                    ? [
                          ...wsParam,
                          ...projParam,
                          ...relTypeParam,
                          ...wsParam,
                          ...projParam,
                          ...relTypeParam,
                      ]
                    : []),
                options.limit,
            ]
        )
    }
    return connection.exec(
        `
            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            WHERE mj.deleted_at IS NULL${wsFilter}${projSql}
              AND mj.id IN (
                  SELECT DISTINCT r.from_entry_id FROM relationships r
                  JOIN memory_journal mj_to ON r.to_entry_id = mj_to.id
                  WHERE mj_to.deleted_at IS NULL${toPeerScope}${relTypeSql}
                  UNION
                  SELECT DISTINCT r.to_entry_id FROM relationships r
                  JOIN memory_journal mj_from ON r.from_entry_id = mj_from.id
                  WHERE mj_from.deleted_at IS NULL${fromPeerScope}${relTypeSql}
              )
            ORDER BY mj.id DESC
            LIMIT ?
        `,
        [
            ...wsParam,
            ...projParam,
            ...wsParam,
            ...projParam,
            ...relTypeParam,
            ...wsParam,
            ...projParam,
            ...relTypeParam,
            options.limit,
        ]
    )
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
    const entriesResult = queryGraphEntries(connection, options, scopeId)

    const nodes: {
        id: string | number
        label: string
        group: string
        metadata: { is_personal: boolean; content: string }
    }[] = []
    if (entriesResult[0] && entriesResult[0].values.length > 0) {
        const cols = entriesResult[0].columns
        for (const row of entriesResult[0].values) {
            nodes.push({
                id: row[cols.indexOf('id')] as number,
                group: row[cols.indexOf('entry_type')] as string,
                label: `Node ${String(row[cols.indexOf('id')])}`,
                metadata: {
                    content: row[cols.indexOf('content')] as string,
                    is_personal: Boolean(row[cols.indexOf('is_personal')]),
                },
            })
        }
    }

    const edges = nodes.length > 0 ? queryGraphEdges(connection, nodes, options.relationshipType) : []

    return { nodes, edges }
}

/** Fetch relationship edges among the given nodes, optionally filtered by type. */
function queryGraphEdges(
    connection: NativeConnectionManager,
    nodes: { id: string | number }[],
    relationshipType: string | undefined
): { from: string | number; to: string | number; label: string; type: string }[] {
    const edges: { from: string | number; to: string | number; label: string; type: string }[] = []
    const entryIds = nodes.map((n) => n.id as number)
    const placeholders = entryIds.map(() => '?').join(',')

    let relsQuery = `
            SELECT from_entry_id, to_entry_id, relationship_type
            FROM relationships
            WHERE from_entry_id IN (${placeholders})
              AND to_entry_id IN (${placeholders})
        `
    const relsParams: unknown[] = [...entryIds, ...entryIds]

    if (relationshipType !== undefined && relationshipType.length > 0) {
        relsQuery += ' AND relationship_type = ?'
        relsParams.push(relationshipType)
    }

    const relsResult = connection.exec(relsQuery, relsParams)
    if (relsResult[0]) {
        for (const row of relsResult[0].values) {
            edges.push({
                from: row[0] as number,
                to: row[1] as number,
                label: row[2] as string,
                type: row[2] as string,
            })
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
    const scopeId = effectiveWorkspace(workspaceId)
    const wsFilter = scopeId !== '*' ? ' AND e1.workspace_id = ? AND e2.workspace_id = ?' : ''
    const params: unknown[] = scopeId !== '*' ? [scopeId, scopeId, limit] : [limit]
    const rows = connection.exec(
        `
        SELECT
            r.from_entry_id, r.to_entry_id, r.relationship_type,
            e1.content as from_content,
            e2.content as to_content
        FROM relationships r
        JOIN memory_journal e1 ON r.from_entry_id = e1.id
        JOIN memory_journal e2 ON r.to_entry_id = e2.id
        WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL${wsFilter}
        ORDER BY r.created_at DESC
        LIMIT ?
    `,
        params
    )

    if (!rows[0] || rows[0].values.length === 0) return []

    const cols = rows[0].columns
    return rows[0].values.map((row) => ({
        from_entry_id: row[cols.indexOf('from_entry_id')] as number,
        to_entry_id: row[cols.indexOf('to_entry_id')] as number,
        relationship_type: row[cols.indexOf('relationship_type')] as string,
        from_content: row[cols.indexOf('from_content')] as string,
        to_content: row[cols.indexOf('to_content')] as string,
    }))
}
