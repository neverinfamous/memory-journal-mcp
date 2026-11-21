import type { NativeConnectionManager } from '../native-connection.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { bucketInParams } from '../row-helpers.js'

export { visualizeRelationships, getRecentGraphRelationships } from './cross-project-graph.js'

interface InsightsOptions {
    startDate?: string
    endDate?: string
    minEntries: number
    inactiveThresholdDays: number
    workspaceId?: string
    projectNumber?: number
}

function buildInsightsFilterState(options: InsightsOptions): {
    where: string
    sqlParams: unknown[]
    scopeId: string
    wsFilter: string
    wsParams: unknown[]
    startBound: string | undefined
    endBound: string | undefined
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

    return { where, sqlParams, scopeId, wsFilter, wsParams, startBound, endBound }
}

export function getCrossProjectInsights(
    connection: NativeConnectionManager,
    options: InsightsOptions
): {
    projects: Record<string, unknown>[]
    inactiveProjects: { project_number: number; last_entry_date: string }[]
} {
    const { where, sqlParams, scopeId, wsFilter, wsParams, startBound, endBound } =
        buildInsightsFilterState(options)

    const db = connection.getNativeDb()
    const projects = db
        .prepare(
            `
        SELECT project_number, COUNT(*) as entry_count,
               SUBSTR(MIN(timestamp), 1, 10) as first_entry,
               SUBSTR(MAX(timestamp), 1, 10) as last_entry,
               COUNT(DISTINCT SUBSTR(timestamp, 1, 10)) as active_days
        FROM memory_journal ${where}
        GROUP BY project_number
        HAVING entry_count >= ?
        ORDER BY entry_count DESC
        `
        )
        .all(...sqlParams, options.minEntries) as Record<string, unknown>[]

    attachTopTags(connection, projects, scopeId, startBound, endBound)

    const inactiveProjects =
        startBound === undefined && endBound === undefined && options.minEntries <= 1
            ? deriveInactiveProjectsFromSummary(projects, options.inactiveThresholdDays)
            : queryInactiveProjects(
                  connection,
                  options.inactiveThresholdDays,
                  wsFilter,
                  wsParams
              )

    return { projects, inactiveProjects }
}

function deriveInactiveProjectsFromSummary(
    projects: Record<string, unknown>[],
    inactiveThresholdDays: number
): { project_number: number; last_entry_date: string }[] {
    const cutoffDate = new Date(Date.now() - inactiveThresholdDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
    const inactive: { project_number: number; last_entry_date: string }[] = []
    for (const p of projects) {
        const pn = p['project_number']
        const lastEntry = p['last_entry']
        if (typeof pn === 'number' && typeof lastEntry === 'string' && lastEntry < cutoffDate) {
            inactive.push({ project_number: pn, last_entry_date: lastEntry })
        }
    }
    return inactive
}

/** Attach each project's top 5 tags as `top_tags`. */
function attachTopTags(
    connection: NativeConnectionManager,
    projects: Record<string, unknown>[],
    scopeId: string,
    startDate?: string,
    endDate?: string
): void {
    if (projects.length === 0) return

    const uniqueProjectNumbers = Array.from(
        new Set(projects.map((p) => p['project_number'] as number))
    )
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
    const tagMap = new Map<number, { name: string; count: number }[]>()
    const nativeDb = connection.getNativeDb()

    const TOP_TAG_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 450] as const

    for (const { placeholders, params } of bucketInParams(uniqueProjectNumbers, TOP_TAG_BUCKETS)) {
        const tagRows = nativeDb
            .prepare(
                `
            SELECT mj.project_number as project_number, t.name as name, COUNT(*) as count
            FROM memory_journal mj
            JOIN entry_tags et ON mj.id = et.entry_id
            JOIN tags t ON et.tag_id = t.id
            WHERE mj.deleted_at IS NULL AND mj.project_number IN (${placeholders})${mjWsFilter}${dateFilter}
            GROUP BY mj.project_number, t.name
            ORDER BY count DESC
            `
            )
            .all(...params, ...wsOnly, ...dateParams) as {
            project_number: number
            name: string
            count: number
        }[]
        for (const row of tagRows) {
            const list = tagMap.get(row.project_number) ?? []
            list.push({ name: row.name, count: row.count })
            tagMap.set(row.project_number, list)
        }
    }

    for (const p of projects) {
        p['top_tags'] = (tagMap.get(p['project_number'] as number) ?? []).slice(0, 5)
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

    return connection
        .getNativeDb()
        .prepare(
            `
        SELECT project_number, MAX(SUBSTR(timestamp, 1, 10)) as last_entry_date
        FROM memory_journal
        WHERE deleted_at IS NULL AND project_number IS NOT NULL${wsFilter}
        GROUP BY project_number
        HAVING last_entry_date < ?
        `
        )
        .all(...wsParams, cutoffDate) as { project_number: number; last_entry_date: string }[]
}
