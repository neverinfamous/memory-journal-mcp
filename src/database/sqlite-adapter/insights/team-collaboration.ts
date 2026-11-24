import type { NativeConnectionManager } from '../native-connection.js'
import { logger } from '../../../utils/logger.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { isMissingColumnError, isMissingTableError } from '../schema-errors.js'
import { bucketInParams } from '../row-helpers.js'

function canonicalAuthorExpr(authorCol: string, wsCol: string, fallback = "'unknown'"): string {
    // [INTENT] `ORDER BY aa.workspace_id DESC` places matching non-null workspace rows before NULL
    // shared rows using `sqlite_autoindex_author_aliases_1(alias, workspace_id)` with zero temp B-tree.
    const sub = `(SELECT aa.canonical_author FROM author_aliases aa WHERE aa.alias = ${authorCol} COLLATE NOCASE AND (aa.workspace_id IS NULL OR aa.workspace_id = ${wsCol}) ORDER BY aa.workspace_id DESC LIMIT 1)`
    return fallback !== ''
        ? `COALESCE(${sub}, ${authorCol}, ${fallback})`
        : `COALESCE(${sub}, ${authorCol})`
}

function isMissingSchemaError(error: unknown): boolean {
    return isMissingTableError(error) || isMissingColumnError(error)
}

export function getAuthorStatistics(
    connection: NativeConnectionManager,
    workspaceId?: string,
    projectNumber?: number
): { author: string; count: number }[] {
    try {
        if (projectNumber !== undefined && (!Number.isSafeInteger(projectNumber) || projectNumber <= 0)) {
            return []
        }
        const scopeId = effectiveWorkspace(workspaceId)
        const wsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
        const hasProject = projectNumber !== undefined
        const projFilter = hasProject ? ' AND mj.project_number = ?' : ''
        const params: unknown[] = [
            ...(scopeId !== '*' ? [scopeId] : []),
            ...(hasProject ? [projectNumber] : []),
        ]
        const authorExpr = canonicalAuthorExpr('raw.author', 'raw.workspace_id')
        const sql = `SELECT resolved.author, SUM(resolved.cnt) as count
             FROM (
                 SELECT ${authorExpr} as author, raw.cnt
                 FROM (
                     SELECT mj.author, mj.workspace_id, COUNT(*) as cnt
                     FROM memory_journal mj
                     WHERE mj.deleted_at IS NULL${wsFilter}${projFilter}
                     GROUP BY mj.author, mj.workspace_id
                 ) raw
             ) resolved
             GROUP BY resolved.author
             ORDER BY count DESC, resolved.author ASC`
        return connection
            .getNativeDb()
            .prepare<unknown[], { author: string; count: number }>(sql)
            .all(...params)
    } catch (error: unknown) {
        if (!isMissingSchemaError(error)) {
            throw error
        }
        logger.warning('Author statistics unavailable: schema is missing a table or column', {
            module: 'team-collaboration',
            error: String(error),
        })
        return []
    }
}

export function getAuthorsForEntries(
    connection: NativeConnectionManager,
    entryIds: number[]
): Map<number, string | null> {
    const authorMap = new Map<number, string | null>()
    if (entryIds.length === 0) return authorMap

    const db = connection.getNativeDb()
    const authorExpr = canonicalAuthorExpr('mj.author', 'mj.workspace_id', '')
    try {
        for (const { placeholders, params } of bucketInParams(entryIds)) {
            const rows = db
                .prepare<unknown[], { id: number; author: string | null }>(
                    `SELECT mj.id as id, ${authorExpr} as author
                     FROM memory_journal mj
                     WHERE mj.id IN (${placeholders})`
                )
                .all(...params)
            for (const row of rows) {
                authorMap.set(row.id, row.author)
            }
        }
    } catch (error: unknown) {
        if (!isMissingSchemaError(error)) {
            throw error
        }
        logger.warning('Entry author lookup unavailable: schema is missing a table or column', {
            module: 'team-collaboration',
            error: String(error),
        })
    }
    return authorMap
}

/** Workspace/project filter shared by collaboration queries. */
interface CollabScope {
    workspaceId: string | undefined
    projectNumber: number | undefined
}

/** [INTENT] Build `AND alias.workspace_id = ? AND alias.project_number = ?` fragments for a scope. */
function scopeClause(alias: string, scope: CollabScope): { sql: string; params: unknown[] } {
    let sql = ''
    const params: unknown[] = []
    if (scope.workspaceId !== undefined) {
        sql += ` AND ${alias}.workspace_id = ?`
        params.push(scope.workspaceId)
    }
    if (scope.projectNumber !== undefined) {
        if (!Number.isSafeInteger(scope.projectNumber) || scope.projectNumber <= 0) {
            sql += ' AND 1 = 0'
        } else {
            sql += ` AND ${alias}.project_number = ?`
            params.push(scope.projectNumber)
        }
    }
    return { sql, params }
}

/** Author activity heatmap + totals from a single memory_journal scan. */
function queryAuthorActivityAndTotals(
    connection: NativeConnectionManager,
    scope: CollabScope,
    limit: number,
    period: string
): {
    authorActivity: { author: string; period: string; entryCount: number }[]
    totalAuthors: number
    totalEntries: number
} {
    const clause = scopeClause('mj', scope)
    const authorExpr = canonicalAuthorExpr('raw.author', 'raw.workspace_id')

    const dateExpression =
        period === 'week'
            ? `strftime('%Y-W%W', mj.timestamp)`
            : period === 'quarter'
              ? `strftime('%Y-Q', mj.timestamp) || CAST(((CAST(strftime('%m', mj.timestamp) AS INTEGER) + 2) / 3) AS INTEGER)`
              : `strftime('%Y-%m', mj.timestamp)`

    const sql = `SELECT ${authorExpr} AS author, raw.period, SUM(raw.cnt) AS entryCount
        FROM (
            SELECT mj.author, mj.workspace_id, ${dateExpression} AS period, COUNT(*) AS cnt
            FROM memory_journal mj
            WHERE mj.deleted_at IS NULL${clause.sql}
            GROUP BY mj.author, mj.workspace_id, period
        ) raw
        GROUP BY author, raw.period
        ORDER BY raw.period DESC, entryCount DESC, author ASC`

    const rows = connection
        .getNativeDb()
        .prepare<unknown[], { author: string; period: string; entryCount: number }>(sql)
        .all(...clause.params)
    const distinctAuthors = new Set<string>()
    let totalEntries = 0
    for (const row of rows) {
        distinctAuthors.add(row.author)
        totalEntries += row.entryCount
    }
    return {
        authorActivity: rows.slice(0, Math.max(0, limit * 10)),
        totalAuthors: distinctAuthors.size,
        totalEntries,
    }
}

/** Cross-author links and inbound impact factor from a single relationships scan. */
function queryRelationshipMetrics(
    connection: NativeConnectionManager,
    scope: CollabScope,
    limit: number
): {
    crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
    impactFactor: { author: string; inboundLinks: number }[]
} {
    const c1 = scopeClause('m1', scope)
    const c2 = scopeClause('m2', scope)
    const fromExpr = canonicalAuthorExpr('raw.from_author_raw', 'raw.from_ws')
    const toExpr = canonicalAuthorExpr('raw.to_author_raw', 'raw.to_ws')
    const sql = `SELECT ${fromExpr} AS fromAuthor, ${toExpr} AS toAuthor, SUM(raw.edge_count) AS linkCount
        FROM (
            SELECT
                m1.author AS from_author_raw, m1.workspace_id AS from_ws,
                m2.author AS to_author_raw, m2.workspace_id AS to_ws,
                COUNT(*) AS edge_count
            FROM relationships r
            JOIN memory_journal m1 ON r.from_entry_id = m1.id
            JOIN memory_journal m2 ON r.to_entry_id = m2.id
            WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL AND r.from_entry_id != r.to_entry_id AND m1.workspace_id = m2.workspace_id${c1.sql}${c2.sql}
            GROUP BY m1.author, m1.workspace_id, m2.author, m2.workspace_id
        ) raw
        GROUP BY fromAuthor, toAuthor
        ORDER BY linkCount DESC, fromAuthor ASC, toAuthor ASC`

    const rows = connection
        .getNativeDb()
        .prepare<unknown[], { fromAuthor: string; toAuthor: string; linkCount: number }>(sql)
        .all(...c1.params, ...c2.params)

    const crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[] = []
    const inboundTotals = new Map<string, number>()
    for (const row of rows) {
        inboundTotals.set(row.toAuthor, (inboundTotals.get(row.toAuthor) ?? 0) + row.linkCount)
        if (row.fromAuthor !== row.toAuthor) {
            crossAuthorLinks.push(row)
        }
    }
    const impactFactor = Array.from(inboundTotals, ([author, inboundLinks]) => ({
        author,
        inboundLinks,
    }))
        .sort((a, b) => b.inboundLinks - a.inboundLinks || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0))
        .slice(0, limit)

    return {
        crossAuthorLinks: crossAuthorLinks.slice(0, limit),
        impactFactor,
    }
}

export function getTeamCollaborationMetrics(
    connection: NativeConnectionManager,
    options: { period: string; limit: number; workspaceId?: string; projectNumber?: number }
): {
    totalAuthors: number
    totalEntries: number
    authorActivity: { author: string; period: string; entryCount: number }[]
    crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
    impactFactor: { author: string; inboundLinks: number }[]
} {
    const scopeId = effectiveWorkspace(options.workspaceId)
    const scope: CollabScope = {
        workspaceId: scopeId !== '*' ? scopeId : undefined,
        projectNumber: options.projectNumber,
    }

    const { authorActivity, totalAuthors, totalEntries } = queryAuthorActivityAndTotals(
        connection,
        scope,
        options.limit,
        options.period
    )
    const { crossAuthorLinks, impactFactor } = queryRelationshipMetrics(
        connection,
        scope,
        options.limit
    )

    return {
        totalAuthors,
        totalEntries,
        authorActivity,
        crossAuthorLinks,
        impactFactor,
    }
}

export const getTeamCollaborationMatrix = getTeamCollaborationMetrics
