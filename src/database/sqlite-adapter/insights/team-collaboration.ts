import type { NativeConnectionManager } from '../native-connection.js'
import { logger } from '../../../utils/logger.js'
import { effectiveWorkspace } from '../../workspace-scope.js'
import { isMissingColumnError, isMissingTableError } from '../schema-errors.js'
import { bucketInParams } from '../row-helpers.js'

function canonicalAuthorExpr(tableAlias: string, fallback = "'unknown'"): string {
    // Use `COLLATE NOCASE` matching `idx_author_aliases_alias` so SQLite uses an index lookup.
    const sub = `(SELECT aa.canonical_author FROM author_aliases aa WHERE aa.alias = ${tableAlias}.author COLLATE NOCASE AND (aa.workspace_id IS NULL OR aa.workspace_id = ${tableAlias}.workspace_id) ORDER BY aa.workspace_id IS NULL ASC LIMIT 1)`
    return fallback !== ''
        ? `COALESCE(${sub}, ${tableAlias}.author, ${fallback})`
        : `COALESCE(${sub}, ${tableAlias}.author)`
}

export function getAuthorStatistics(
    connection: NativeConnectionManager,
    workspaceId?: string,
    projectNumber?: number
): { author: string; count: number }[] {
    let authors: { author: string; count: number }[] = []
    try {
        const scopeId = effectiveWorkspace(workspaceId)
        const wsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
        const hasProject = typeof projectNumber === 'number' && Number.isFinite(projectNumber)
        const projFilter = hasProject ? ' AND mj.project_number = ?' : ''
        const params: unknown[] = [
            ...(scopeId !== '*' ? [scopeId] : []),
            ...(hasProject ? [projectNumber] : []),
        ]
        const authorExpr = canonicalAuthorExpr('mj')
        const authorResult = connection.exec(
            `SELECT ${authorExpr} as author, COUNT(*) as count
             FROM memory_journal mj
             WHERE mj.deleted_at IS NULL${wsFilter}${projFilter}
             GROUP BY ${authorExpr}
             ORDER BY count DESC`,
            params
        )
        if (authorResult[0]) {
            authors = authorResult[0].values.map((row: unknown[]) => ({
                author: row[0] as string,
                count: row[1] as number,
            }))
        }
    } catch (error: unknown) {
        if (!isMissingSchemaError(error)) {
            throw error
        }
        logger.warning('Author statistics unavailable: schema is missing a table or column', {
            module: 'team-collaboration',
            error: String(error),
        })
    }
    return authors
}

function isMissingSchemaError(error: unknown): boolean {
    return isMissingTableError(error) || isMissingColumnError(error)
}

export function getAuthorsForEntries(
    connection: NativeConnectionManager,
    entryIds: number[]
): Map<number, string | null> {
    const authorMap = new Map<number, string | null>()
    if (entryIds.length === 0) return authorMap

    const db = connection.getNativeDb()
    const authorExpr = canonicalAuthorExpr('mj', '')
    try {
        for (const { placeholders, params } of bucketInParams(entryIds)) {
            const rows = db
                .prepare(
                    `SELECT mj.id as id, ${authorExpr} as author
                     FROM memory_journal mj
                     WHERE mj.id IN (${placeholders})`
                )
                .all(...params) as { id: number; author: string | null }[]
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
        sql += ` AND ${alias}.project_number = ?`
        params.push(scope.projectNumber)
    }
    return { sql, params }
}

/** Author activity heatmap bucketed by week, quarter or month. */
function queryAuthorActivity(
    connection: NativeConnectionManager,
    scope: CollabScope,
    limit: number,
    period: string
): { author: string; period: string; entryCount: number }[] {
    const clause = scopeClause('mj', scope)
    const authorExpr = canonicalAuthorExpr('mj')

    const dateExpression =
        period === 'week'
            ? `strftime('%Y-W%W', timestamp)`
            : period === 'quarter'
              ? `strftime('%Y-Q', timestamp) || CAST(((CAST(strftime('%m', timestamp) AS INTEGER) + 2) / 3) AS INTEGER)`
              : `strftime('%Y-%m', timestamp)`

    const activityResult = connection.exec(
        `SELECT
            ${authorExpr} AS author,
            ${dateExpression} AS period,
            COUNT(*) AS entry_count
        FROM memory_journal mj
        WHERE mj.deleted_at IS NULL${clause.sql}
        GROUP BY ${authorExpr}, period
        ORDER BY period DESC, entry_count DESC
        LIMIT ?`,
        [...clause.params, limit * 10]
    )
    const authorActivity =
        activityResult[0]?.values.map((row: unknown[]) => ({
            author: row[0] as string,
            period: row[1] as string,
            entryCount: row[2] as number,
        })) ?? []

    return authorActivity
}

/** Links between entries written by different (alias-resolved) authors. */
function queryCrossAuthorLinks(
    connection: NativeConnectionManager,
    scope: CollabScope,
    limit: number
): { fromAuthor: string; toAuthor: string; linkCount: number }[] {
    const c1 = scopeClause('m1', scope)
    const c2 = scopeClause('m2', scope)
    const fromExpr = canonicalAuthorExpr('m1')
    const toExpr = canonicalAuthorExpr('m2')
    const crossLinkResult = connection.exec(
        `SELECT
            ${fromExpr} AS from_author,
            ${toExpr} AS to_author,
            COUNT(*) AS link_count
        FROM relationships r
        JOIN memory_journal m1 ON r.from_entry_id = m1.id
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL AND m1.workspace_id = m2.workspace_id${c1.sql}${c2.sql}
            AND ${fromExpr} != ${toExpr}
        GROUP BY from_author, to_author
        ORDER BY link_count DESC
        LIMIT ?`,
        [...c1.params, ...c2.params, limit]
    )
    const crossAuthorLinks =
        crossLinkResult[0]?.values.map((row: unknown[]) => ({
            fromAuthor: row[0] as string,
            toAuthor: row[1] as string,
            linkCount: row[2] as number,
        })) ?? []

    return crossAuthorLinks
}

/** Authors ranked by inbound links. */
function queryImpactFactor(
    connection: NativeConnectionManager,
    scope: CollabScope,
    limit: number
): { author: string; inboundLinks: number }[] {
    const c1 = scopeClause('m1', scope)
    const c2 = scopeClause('m2', scope)
    const authorExpr = canonicalAuthorExpr('m2')
    const impactResult = connection.exec(
        `SELECT
            ${authorExpr} AS author,
            COUNT(*) AS inbound_links
        FROM relationships r
        JOIN memory_journal m1 ON r.from_entry_id = m1.id
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL AND m1.workspace_id = m2.workspace_id${c1.sql}${c2.sql}
        GROUP BY ${authorExpr}
        ORDER BY inbound_links DESC
        LIMIT ?`,
        [...c1.params, ...c2.params, limit]
    )
    const impactFactor =
        impactResult[0]?.values.map((row: unknown[]) => ({
            author: row[0] as string,
            inboundLinks: row[1] as number,
        })) ?? []

    return impactFactor
}

/** Distinct author and entry totals. */
function queryCollaborationTotals(
    connection: NativeConnectionManager,
    scope: CollabScope
): { totalAuthors: number; totalEntries: number } {
    const clause = scopeClause('mj', scope)
    const authorExpr = canonicalAuthorExpr('mj')
    const totalsResult = connection.exec(
        `SELECT
            COUNT(DISTINCT ${authorExpr}) AS total_authors,
            COUNT(*) AS total_entries
        FROM memory_journal mj
        WHERE mj.deleted_at IS NULL${clause.sql}`,
        clause.params
    )
    const totalAuthors = (totalsResult[0]?.values[0]?.[0] as number | undefined) ?? 0
    const totalEntries = (totalsResult[0]?.values[0]?.[1] as number | undefined) ?? 0
    return { totalAuthors, totalEntries }
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

    const authorActivity = queryAuthorActivity(connection, scope, options.limit, options.period)
    const crossAuthorLinks = queryCrossAuthorLinks(connection, scope, options.limit)
    const impactFactor = queryImpactFactor(connection, scope, options.limit)
    const { totalAuthors, totalEntries } = queryCollaborationTotals(connection, scope)

    return {
        totalAuthors,
        totalEntries,
        authorActivity,
        crossAuthorLinks,
        impactFactor,
    }
}

export const getTeamCollaborationMatrix = getTeamCollaborationMetrics
