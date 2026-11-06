import type { NativeConnectionManager } from '../native-connection.js'

export function getAuthorStatistics(
    connection: NativeConnectionManager,
    workspaceId?: string
): { author: string; count: number }[] {
    let authors: { author: string; count: number }[] = []
    try {
        const scopeId = workspaceId ?? 'default'
        const wsFilter = scopeId !== '*' ? ' AND mj.workspace_id = ?' : ''
        const params: unknown[] = scopeId !== '*' ? [scopeId] : []
        const authorResult = connection.exec(
            `SELECT COALESCE(aa.canonical_author, mj.author, 'unknown') as author, COUNT(*) as count
             FROM memory_journal mj
             LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias) AND (aa.workspace_id IS NULL OR aa.workspace_id = mj.workspace_id)
             WHERE mj.deleted_at IS NULL${wsFilter}
             GROUP BY COALESCE(aa.canonical_author, mj.author, 'unknown')
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
        if (
            !(error instanceof Error) ||
            (!error.message.includes('no such column') && !error.message.includes('no such table'))
        ) {
            throw error
        }
    }
    return authors
}

export function getAuthorsForEntries(
    connection: NativeConnectionManager,
    entryIds: number[]
): Map<number, string | null> {
    const authorMap = new Map<number, string | null>()
    if (entryIds.length === 0) return authorMap

    const placeholders = entryIds.map(() => '?').join(',')
    try {
        const authorResult = connection.exec(
            `SELECT mj.id, COALESCE(aa.canonical_author, mj.author) as author
             FROM memory_journal mj
             LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias) AND (aa.workspace_id IS NULL OR aa.workspace_id = mj.workspace_id)
             WHERE mj.id IN (${placeholders})`,
            entryIds
        )
        if (authorResult[0]) {
            authorResult[0].values.forEach((row: unknown[]) => {
                authorMap.set(row[0] as number, row[1] as string | null)
            })
        }
    } catch (error: unknown) {
        if (
            !(error instanceof Error) ||
            (!error.message.includes('no such column') && !error.message.includes('no such table'))
        ) {
            throw error
        }
    }
    return authorMap
}

export function getTeamCollaborationMetrics(
    connection: NativeConnectionManager,
    options: { period: string; limit: number; workspaceId?: string }
): {
    totalAuthors: number
    totalEntries: number
    authorActivity: { author: string; period: string; entryCount: number }[]
    crossAuthorLinks: { fromAuthor: string; toAuthor: string; linkCount: number }[]
    impactFactor: { author: string; inboundLinks: number }[]
} {
    const limit = options.limit
    const period = options.period
    const scopeId = options.workspaceId ?? 'default'
    const scoped = scopeId !== '*'
    const workspaceId = scoped ? scopeId : undefined

    const dateExpression =
        period === 'week'
            ? `strftime('%Y-W%W', timestamp)`
            : period === 'quarter'
              ? `strftime('%Y-Q', timestamp) || CAST(((CAST(strftime('%m', timestamp) AS INTEGER) + 2) / 3) AS INTEGER)`
              : `strftime('%Y-%m', timestamp)`

    // Author activity heatmap
    const activityResult = connection.exec(
        `SELECT
            COALESCE(aa.canonical_author, mj.author, 'unknown') AS author,
            ${dateExpression} AS period,
            COUNT(*) AS entry_count
        FROM memory_journal mj
        LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias) AND (aa.workspace_id IS NULL OR aa.workspace_id = mj.workspace_id)
        WHERE mj.deleted_at IS NULL${scoped ? ' AND mj.workspace_id = ?' : ''}
        GROUP BY COALESCE(aa.canonical_author, mj.author, 'unknown'), period
        ORDER BY period DESC, entry_count DESC
        LIMIT ?`,
        scoped ? [workspaceId, limit * 10] : [limit * 10]
    )
    const authorActivity =
        activityResult[0]?.values.map((row: unknown[]) => ({
            author: row[0] as string,
            period: row[1] as string,
            entryCount: row[2] as number,
        })) ?? []

    // Cross-author linking
    const crossLinkResult = connection.exec(
        `SELECT
            COALESCE(aa1.canonical_author, m1.author, 'unknown') AS from_author,
            COALESCE(aa2.canonical_author, m2.author, 'unknown') AS to_author,
            COUNT(*) AS link_count
        FROM relationships r
        JOIN memory_journal m1 ON r.from_entry_id = m1.id
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        LEFT JOIN author_aliases aa1 ON LOWER(m1.author) = LOWER(aa1.alias) AND (aa1.workspace_id IS NULL OR aa1.workspace_id = m1.workspace_id)
        LEFT JOIN author_aliases aa2 ON LOWER(m2.author) = LOWER(aa2.alias) AND (aa2.workspace_id IS NULL OR aa2.workspace_id = m2.workspace_id)
        WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL${scoped ? ' AND m1.workspace_id = ? AND m2.workspace_id = ?' : ''}
            AND COALESCE(aa1.canonical_author, m1.author, 'unknown') != COALESCE(aa2.canonical_author, m2.author, 'unknown')
        GROUP BY from_author, to_author
        ORDER BY link_count DESC
        LIMIT ?`,
        scoped ? [workspaceId, workspaceId, limit] : [limit]
    )
    const crossAuthorLinks =
        crossLinkResult[0]?.values.map((row: unknown[]) => ({
            fromAuthor: row[0] as string,
            toAuthor: row[1] as string,
            linkCount: row[2] as number,
        })) ?? []

    // Impact factor
    const impactResult = connection.exec(
        `SELECT
            COALESCE(aa2.canonical_author, m2.author, 'unknown') AS author,
            COUNT(*) AS inbound_links
        FROM relationships r
        JOIN memory_journal m2 ON r.to_entry_id = m2.id
        LEFT JOIN author_aliases aa2 ON LOWER(m2.author) = LOWER(aa2.alias) AND (aa2.workspace_id IS NULL OR aa2.workspace_id = m2.workspace_id)
        WHERE m2.deleted_at IS NULL${scoped ? ' AND m2.workspace_id = ?' : ''}
        GROUP BY COALESCE(aa2.canonical_author, m2.author, 'unknown')
        ORDER BY inbound_links DESC
        LIMIT ?`,
        scoped ? [workspaceId, limit] : [limit]
    )
    const impactFactor =
        impactResult[0]?.values.map((row: unknown[]) => ({
            author: row[0] as string,
            inboundLinks: row[1] as number,
        })) ?? []

    // Totals
    const totalsResult = connection.exec(
        `SELECT
            COUNT(DISTINCT COALESCE(aa.canonical_author, mj.author, 'unknown')) AS total_authors,
            COUNT(*) AS total_entries
        FROM memory_journal mj
        LEFT JOIN author_aliases aa ON LOWER(mj.author) = LOWER(aa.alias) AND (aa.workspace_id IS NULL OR aa.workspace_id = mj.workspace_id)
        WHERE mj.deleted_at IS NULL${scoped ? ' AND mj.workspace_id = ?' : ''}`,
        scoped ? [workspaceId] : []
    )
    const totalAuthors = (totalsResult[0]?.values[0]?.[0] as number | undefined) ?? 0
    const totalEntries = (totalsResult[0]?.values[0]?.[1] as number | undefined) ?? 0

    return {
        totalAuthors,
        totalEntries,
        authorActivity,
        crossAuthorLinks,
        impactFactor,
    }
}

export const getTeamCollaborationMatrix = getTeamCollaborationMetrics
