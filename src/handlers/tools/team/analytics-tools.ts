/**
 * Team Analytics Tools - 3 tools
 *
 * Tools: team_get_statistics, team_get_cross_project_insights, team_get_collaboration_matrix
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import {
    TeamGetStatisticsSchema,
    TeamGetStatisticsSchemaMcp,
    TeamStatisticsOutputSchema,
    TeamCrossProjectInsightsSchema,
    TeamCrossProjectInsightsSchemaMcp,
    TeamCrossProjectInsightsOutputSchema,
    TeamCollaborationMatrixSchema,
    TeamCollaborationMatrixSchemaMcp,
    TeamCollaborationMatrixOutputSchema,
} from './schemas.js'

// Named constants (magic value extraction)
const INACTIVE_THRESHOLD_DAYS = 7
const MS_PER_DAY = 86_400_000
const MAX_TAGS_PER_PROJECT = 5

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAnalyticsTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_get_statistics',
            title: 'Get Team Statistics',
            description:
                'Get statistics for the team database including entry counts, types, top tags, and contributor breakdown. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamGetStatisticsSchemaMcp,
            outputSchema: TeamStatisticsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { group_by } = TeamGetStatisticsSchema.parse(params)
                    const stats = teamDb.getStatistics(group_by)

                    // Author breakdown
                    let authors: { author: string; count: number }[] = []
                    try {
                        const authorResult = teamDb._executeRawQueryUnsafe(
                            `SELECT COALESCE(author, 'unknown') as author, COUNT(*) as count
                             FROM memory_journal
                             WHERE deleted_at IS NULL
                             GROUP BY COALESCE(author, 'unknown')
                             ORDER BY count DESC`
                        )
                        if (authorResult[0]) {
                            authors = authorResult[0].values.map((row: unknown[]) => ({
                                author: row[0] as string,
                                count: row[1] as number,
                            }))
                        }
                    } catch {
                        // Author column may not exist yet
                    }

                    return {
                        success: true,
                        ...(stats as object),
                        authors,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_cross_project_insights',
            title: 'Team Cross-Project Insights',
            description:
                'Analyze patterns across all GitHub Projects tracked in team entries. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamCrossProjectInsightsSchemaMcp,
            outputSchema: TeamCrossProjectInsightsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = TeamCrossProjectInsightsSchema.parse(params)

                    // Build WHERE clause
                    let where = 'WHERE deleted_at IS NULL AND project_number IS NOT NULL'
                    const sqlParams: unknown[] = []

                    if (input.start_date) {
                        where += ' AND DATE(timestamp) >= DATE(?)'
                        sqlParams.push(input.start_date)
                    }
                    if (input.end_date) {
                        where += ' AND DATE(timestamp) <= DATE(?)'
                        sqlParams.push(input.end_date)
                    }

                    // Get active projects with stats
                    const projectsResult = teamDb._executeRawQueryUnsafe(
                        `
                        SELECT project_number, COUNT(*) as entry_count,
                               MIN(DATE(timestamp)) as first_entry,
                               MAX(DATE(timestamp)) as last_entry,
                               COUNT(DISTINCT DATE(timestamp)) as active_days
                        FROM memory_journal ${where}
                        GROUP BY project_number
                        HAVING entry_count >= ?
                        ORDER BY entry_count DESC
                        LIMIT ?
                    `,
                        [...sqlParams, input.min_entries, input.limit]
                    )

                    if (!projectsResult[0] || projectsResult[0].values.length === 0) {
                        return {
                            success: true,
                            project_count: 0,
                            total_entries: 0,
                            projects: [],
                            inactive_projects: [],
                            inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
                            time_distribution: [],
                            message: `No projects found with at least ${String(input.min_entries)} entries`,
                        }
                    }

                    const columns = projectsResult[0].columns
                    const projects = projectsResult[0].values.map((row: unknown[]) => {
                        const obj: Record<string, unknown> = {}
                        columns.forEach((col: string, i: number) => {
                            obj[col] = row[i]
                        })
                        return obj
                    })

                    // Get top tags per project (batch query instead of N+1)
                    const projectTags: Record<number, { name: string; count: number }[]> = {}
                    const projectNumbers = projects.map((p: Record<string, unknown>) => p['project_number'] as number)
                    if (projectNumbers.length > 0) {
                        const tagPlaceholders = projectNumbers.map(() => '?').join(',')
                        const allTagsResult = teamDb._executeRawQueryUnsafe(
                            `
                            SELECT m.project_number, t.name, COUNT(*) as count
                            FROM tags t
                            JOIN entry_tags et ON t.id = et.tag_id
                            JOIN memory_journal m ON et.entry_id = m.id
                            WHERE m.project_number IN (${tagPlaceholders}) AND m.deleted_at IS NULL
                            GROUP BY m.project_number, t.name
                            ORDER BY m.project_number, count DESC
                            `,
                            projectNumbers
                        )
                        if (allTagsResult[0]) {
                            for (const row of allTagsResult[0].values) {
                                const projNum = row[0] as number
                                const tagEntry = {
                                    name: row[1] as string,
                                    count: row[2] as number,
                                }
                                const existing = projectTags[projNum] ?? []
                                if (existing.length < MAX_TAGS_PER_PROJECT) {
                                    existing.push(tagEntry)
                                    projectTags[projNum] = existing
                                }
                            }
                        }
                    }

                    // Find inactive projects (last entry > threshold days ago)
                    const cutoffDate = new Date(Date.now() - INACTIVE_THRESHOLD_DAYS * MS_PER_DAY)
                        .toISOString()
                        .split('T')[0]
                    const inactiveResult = teamDb._executeRawQueryUnsafe(
                        `
                        SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
                        FROM memory_journal
                        WHERE deleted_at IS NULL AND project_number IS NOT NULL
                        GROUP BY project_number
                        HAVING last_entry_date < ?
                        ORDER BY last_entry_date DESC
                        LIMIT ?
                    `,
                        [cutoffDate, input.limit]
                    )

                    const inactiveProjects =
                        inactiveResult[0]?.values.map((row: unknown[]) => ({
                            project_number: row[0] as number,
                            last_entry_date: row[1] as string,
                        })) ?? []

                    // Calculate time distribution
                    const totalEntries = projects.reduce(
                        (sum: number, p: Record<string, unknown>) =>
                            sum + (p['entry_count'] as number),
                        0
                    )
                    const distribution = projects.slice(0, 5).map((p: Record<string, unknown>) => ({
                        project_number: p['project_number'] as number,
                        percentage: (((p['entry_count'] as number) / totalEntries) * 100).toFixed(
                            1
                        ),
                    }))

                    return {
                        success: true,
                        project_count: projects.length,
                        total_entries: totalEntries,
                        projects: projects.map((p: Record<string, unknown>) => ({
                            ...p,
                            top_tags: projectTags[p['project_number'] as number] ?? [],
                        })),
                        inactive_projects: inactiveProjects,
                        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
                        time_distribution: distribution,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_collaboration_matrix',
            title: 'Team Collaboration Matrix',
            description:
                'Analyze cross-author collaboration: activity heatmap per period, cross-linking patterns between authors, and impact factor (inbound links). Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamCollaborationMatrixSchemaMcp,
            outputSchema: TeamCollaborationMatrixOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const { period, limit } = TeamCollaborationMatrixSchema.parse(params)

                    // Date expression for period grouping
                    const dateExpression =
                        period === 'week'
                            ? `strftime('%Y-W%W', timestamp)`
                            : period === 'quarter'
                              ? `strftime('%Y-Q', timestamp) || CAST(((CAST(strftime('%m', timestamp) AS INTEGER) + 2) / 3) AS INTEGER)`
                              : `strftime('%Y-%m', timestamp)`

                    // Author activity heatmap
                    const activityResult = teamDb._executeRawQueryUnsafe(
                        `SELECT
                            COALESCE(author, 'unknown') AS author,
                            ${dateExpression} AS period,
                            COUNT(*) AS entry_count
                        FROM memory_journal
                        WHERE deleted_at IS NULL
                        GROUP BY author, period
                        ORDER BY period DESC, entry_count DESC
                        LIMIT ?`,
                        [limit * 10] // Up to 10 periods per author
                    )
                    const authorActivity =
                        activityResult[0]?.values.map((row: unknown[]) => ({
                            author: row[0] as string,
                            period: row[1] as string,
                            entryCount: row[2] as number,
                        })) ?? []

                    // Cross-author linking
                    const crossLinkResult = teamDb._executeRawQueryUnsafe(
                        `SELECT
                            COALESCE(m1.author, 'unknown') AS from_author,
                            COALESCE(m2.author, 'unknown') AS to_author,
                            COUNT(*) AS link_count
                        FROM relationships r
                        JOIN memory_journal m1 ON r.from_entry_id = m1.id
                        JOIN memory_journal m2 ON r.to_entry_id = m2.id
                        WHERE m1.deleted_at IS NULL AND m2.deleted_at IS NULL
                            AND COALESCE(m1.author, 'unknown') != COALESCE(m2.author, 'unknown')
                        GROUP BY from_author, to_author
                        ORDER BY link_count DESC
                        LIMIT ?`,
                        [limit]
                    )
                    const crossAuthorLinks =
                        crossLinkResult[0]?.values.map((row: unknown[]) => ({
                            fromAuthor: row[0] as string,
                            toAuthor: row[1] as string,
                            linkCount: row[2] as number,
                        })) ?? []

                    // Impact factor
                    const impactResult = teamDb._executeRawQueryUnsafe(
                        `SELECT
                            COALESCE(m2.author, 'unknown') AS author,
                            COUNT(*) AS inbound_links
                        FROM relationships r
                        JOIN memory_journal m2 ON r.to_entry_id = m2.id
                        WHERE m2.deleted_at IS NULL
                        GROUP BY author
                        ORDER BY inbound_links DESC
                        LIMIT ?`,
                        [limit]
                    )
                    const impactFactor =
                        impactResult[0]?.values.map((row: unknown[]) => ({
                            author: row[0] as string,
                            inboundLinks: row[1] as number,
                        })) ?? []

                    // Totals
                    const totalsResult = teamDb._executeRawQueryUnsafe(
                        `SELECT
                            COUNT(DISTINCT COALESCE(author, 'unknown')) AS total_authors,
                            COUNT(*) AS total_entries
                        FROM memory_journal
                        WHERE deleted_at IS NULL`
                    )
                    const totalAuthors =
                        (totalsResult[0]?.values[0]?.[0] as number | undefined) ?? 0
                    const totalEntries =
                        (totalsResult[0]?.values[0]?.[1] as number | undefined) ?? 0

                    return {
                        success: true,
                        totalAuthors,
                        totalEntries,
                        authorActivity,
                        crossAuthorLinks,
                        impactFactor,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
