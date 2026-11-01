import type { NativeConnectionManager } from '../native-connection.js'
import type { QueryResult } from '../../core/interfaces.js'

export function getCrossProjectInsights(
    connection: NativeConnectionManager,
    options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
    }
): {
    projects: Record<string, unknown>[]
    inactiveProjects: { project_number: number; last_entry_date: string }[]
} {
    let where = 'WHERE deleted_at IS NULL AND project_number IS NOT NULL'
    const sqlParams: unknown[] = []
    const wsFilter =
        options.workspaceId !== undefined && options.workspaceId !== '*'
            ? ' AND workspace_id = ?'
            : ''
    const wsParams: unknown[] =
        options.workspaceId !== undefined && options.workspaceId !== '*'
            ? [options.workspaceId]
            : []

    where += wsFilter
    sqlParams.push(...wsParams)

    if (options.startDate !== undefined && options.startDate.length > 0) {
        where += ' AND DATE(timestamp) >= DATE(?)'
        sqlParams.push(options.startDate)
    }
    if (options.endDate !== undefined && options.endDate.length > 0) {
        where += ' AND DATE(timestamp) <= DATE(?)'
        sqlParams.push(options.endDate)
    }

    const projectsResult = connection.exec(
        `
        SELECT project_number, COUNT(*) as entry_count,
               MIN(DATE(timestamp)) as first_entry,
               MAX(DATE(timestamp)) as last_entry,
               COUNT(DISTINCT DATE(timestamp)) as active_days
        FROM memory_journal ${where}
        GROUP BY project_number
        HAVING entry_count >= ?
        ORDER BY entry_count DESC
        `,
        [...sqlParams, options.minEntries]
    )

    const projects: Record<string, unknown>[] = []
    if (projectsResult[0] && projectsResult[0].values.length > 0) {
        const columns = projectsResult[0].columns
        for (const row of projectsResult[0].values) {
            const obj: Record<string, unknown> = {}
            columns.forEach((col: string, i: number) => {
                obj[col] = row[i]
            })
            projects.push(obj)
        }
    }

    if (projects.length > 0) {
        const projectNumbers = projects.map((p) => p['project_number'] as number)
        const placeholders = projectNumbers.map(() => '?').join(',')
        const mjWsFilter =
            options.workspaceId !== undefined && options.workspaceId !== '*'
                ? ' AND mj.workspace_id = ?'
                : ''
        const tagsResult = connection.exec(
            `
            SELECT mj.project_number, t.name, COUNT(*) as count
            FROM memory_journal mj
            JOIN entry_tags et ON mj.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
            WHERE mj.deleted_at IS NULL AND mj.project_number IN (${placeholders})${mjWsFilter}
            GROUP BY mj.project_number, t.name
            ORDER BY count DESC
            `,
            [...projectNumbers, ...wsParams]
        )
        const tagMap = new Map<number, { name: string; count: number }[]>()
        if (tagsResult[0]) {
            for (const row of tagsResult[0].values) {
                const pNum = row[0] as number
                const list = tagMap.get(pNum) ?? []
                list.push({ name: row[1] as string, count: row[2] as number })
                tagMap.set(pNum, list)
            }
        }
        for (const p of projects) {
            p['top_tags'] = (tagMap.get(p['project_number'] as number) ?? []).slice(0, 5)
        }
    } else {
        for (const p of projects) {
            p['top_tags'] = []
        }
    }

    const msPerDay = 86_400_000
    const cutoffDate = new Date(Date.now() - options.inactiveThresholdDays * msPerDay)
        .toISOString()
        .split('T')[0]

    const inactiveResult = connection.exec(
        `
        SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
        FROM memory_journal
        WHERE deleted_at IS NULL AND project_number IS NOT NULL${wsFilter}
        GROUP BY project_number
        HAVING last_entry_date < ?
        `,
        [...wsParams, cutoffDate]
    )

    const inactiveProjects: { project_number: number; last_entry_date: string }[] = []
    if (inactiveResult[0]) {
        for (const row of inactiveResult[0].values) {
            inactiveProjects.push({
                project_number: row[0] as number,
                last_entry_date: row[1] as string,
            })
        }
    }

    return { projects, inactiveProjects }
}

export function visualizeRelationships(
    connection: NativeConnectionManager,
    options: {
        entryId?: number
        tags?: string[]
        relationshipType?: string
        depth: number
        limit: number
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
    let entriesResult: QueryResult[]

    if (options.entryId !== undefined) {
        entriesResult = connection.exec(
            `
            WITH RECURSIVE connected_entries(id, distance) AS (
                SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                UNION
                SELECT DISTINCT
                    CASE
                        WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                        ELSE r.from_entry_id
                    END,
                    ce.distance + 1
                FROM connected_entries ce
                JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                WHERE ce.distance < ?
            )
            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            JOIN connected_entries ce ON mj.id = ce.id
            WHERE mj.deleted_at IS NULL
            LIMIT ?
        `,
            [options.entryId, options.depth, options.limit]
        )
    } else if (options.tags !== undefined && options.tags.length > 0) {
        const placeholders = options.tags.map(() => '?').join(',')
        entriesResult = connection.exec(
            `
            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            WHERE mj.deleted_at IS NULL
              AND mj.id IN (
                  SELECT et.entry_id FROM entry_tags et
                  JOIN tags t ON et.tag_id = t.id
                  WHERE t.name IN (${placeholders})
              )
            LIMIT ?
        `,
            [...options.tags, options.limit]
        )
    } else {
        entriesResult = connection.exec(
            `
            SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
            FROM memory_journal mj
            WHERE mj.deleted_at IS NULL
              AND mj.id IN (
                  SELECT DISTINCT from_entry_id FROM relationships
                  UNION
                  SELECT DISTINCT to_entry_id FROM relationships
              )
            ORDER BY mj.id DESC
            LIMIT ?
        `,
            [options.limit]
        )
    }

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

    const edges: { from: string | number; to: string | number; label: string; type: string }[] = []
    if (nodes.length > 0) {
        const entryIds = nodes.map((n) => n.id as number)
        const placeholders = entryIds.map(() => '?').join(',')

        let relsQuery = `
            SELECT from_entry_id, to_entry_id, relationship_type
            FROM relationships
            WHERE from_entry_id IN (${placeholders})
              AND to_entry_id IN (${placeholders})
        `
        const relsParams: unknown[] = [...entryIds, ...entryIds]

        if (options.relationshipType !== undefined && options.relationshipType.length > 0) {
            relsQuery += ' AND relationship_type = ?'
            relsParams.push(options.relationshipType)
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
    }

    return { nodes, edges }
}

export function getRecentGraphRelationships(
    connection: NativeConnectionManager,
    limit: number
): {
    from_entry_id: number
    to_entry_id: number
    relationship_type: string
    from_content: string
    to_content: string
}[] {
    const rows = connection.exec(
        `
        SELECT
            r.from_entry_id, r.to_entry_id, r.relationship_type,
            e1.content as from_content,
            e2.content as to_content
        FROM relationships r
        JOIN memory_journal e1 ON r.from_entry_id = e1.id
        JOIN memory_journal e2 ON r.to_entry_id = e2.id
        WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL
        ORDER BY r.created_at DESC
        LIMIT ?
    `,
        [limit]
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
