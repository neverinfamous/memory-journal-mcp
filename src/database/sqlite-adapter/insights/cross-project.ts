import type { NativeConnectionManager } from '../native-connection.js'
import { effectiveWorkspace } from '../../workspace-scope.js'

export { visualizeRelationships, getRecentGraphRelationships } from './cross-project-graph.js'

export function getCrossProjectInsights(
    connection: NativeConnectionManager,
    options: {
        startDate?: string
        endDate?: string
        minEntries: number
        inactiveThresholdDays: number
        workspaceId?: string
        projectNumber?: number
    }
): {
    projects: Record<string, unknown>[]
    inactiveProjects: { project_number: number; last_entry_date: string }[]
} {
    let where = 'WHERE deleted_at IS NULL AND project_number IS NOT NULL'
    const sqlParams: unknown[] = []
    const scopeId = effectiveWorkspace(options.workspaceId)
    let wsFilter = scopeId !== '*' ? ' AND workspace_id = ?' : ''
    const wsParams: unknown[] = scopeId !== '*' ? [scopeId] : []

    where += wsFilter
    sqlParams.push(...wsParams)
    if (options.projectNumber !== undefined) {
        where += ' AND project_number = ?'
        sqlParams.push(options.projectNumber)
        wsFilter += ' AND project_number = ?'
        wsParams.push(options.projectNumber)
    }

    let startBound: string | undefined
    let endBound: string | undefined
    if (options.startDate !== undefined && options.startDate.length > 0) {
        let start = options.startDate
        if (!start.includes('T')) start += 'T00:00:00.000Z'
        where += ' AND timestamp >= ?'
        sqlParams.push(start)
        startBound = start
    }
    if (options.endDate !== undefined && options.endDate.length > 0) {
        let end = options.endDate
        if (!end.includes('T')) end += 'T23:59:59.999Z'
        where += ' AND timestamp <= ?'
        sqlParams.push(end)
        endBound = end
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

    attachTopTags(connection, projects, scopeId, startBound, endBound)

    const inactiveProjects = queryInactiveProjects(
        connection,
        options.inactiveThresholdDays,
        wsFilter,
        wsParams
    )

    return { projects, inactiveProjects }
}

/** Attach each project's top 5 tags as `top_tags`. */
function attachTopTags(
    connection: NativeConnectionManager,
    projects: Record<string, unknown>[],
    scopeId: string,
    startDate?: string,
    endDate?: string
): void {
    if (projects.length > 0) {
        const projectNumbers = projects.map((p) => p['project_number'] as number)
        const placeholders = projectNumbers.map(() => '?').join(',')
        const mjWsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
        // [INVARIANT] Bind only the workspace param here; project filtering is already
        // expressed by the IN (...) list, so extra project params would overflow the binds.
        const wsOnly: unknown[] = scopeId !== '*' ? [scopeId] : []
        const dateClauses: string[] = []
        const dateParams: unknown[] = []
        if (startDate !== undefined) {
            dateClauses.push('AND mj.timestamp >= ?')
            dateParams.push(startDate)
        }
        if (endDate !== undefined) {
            dateClauses.push('AND mj.timestamp <= ?')
            dateParams.push(endDate)
        }
        const dateFilter = dateClauses.length > 0 ? ` ${dateClauses.join(' ')}` : ''
        const tagsResult = connection.exec(
            `
            SELECT mj.project_number, t.name, COUNT(*) as count
            FROM memory_journal mj
            JOIN entry_tags et ON mj.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
            WHERE mj.deleted_at IS NULL AND mj.project_number IN (${placeholders})${mjWsFilter}${dateFilter}
            GROUP BY mj.project_number, t.name
            ORDER BY count DESC
            `,
            [...projectNumbers, ...wsOnly, ...dateParams]
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
    }
}

/** Projects whose last entry is older than the inactivity threshold. */
function queryInactiveProjects(
    connection: NativeConnectionManager,
    inactiveThresholdDays: number,
    wsFilter: string,
    wsParams: unknown[]
): { project_number: number; last_entry_date: string }[] {
    const msPerDay = 86_400_000
    const cutoffDate = new Date(Date.now() - inactiveThresholdDays * msPerDay)
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
    return inactiveProjects
}
