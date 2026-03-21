/**
 * Team Analytics Tools - 2 tools
 *
 * Tools: team_get_statistics, team_get_cross_project_insights
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_NOT_CONFIGURED } from './helpers.js'
import {
    TeamGetStatisticsSchema,
    TeamGetStatisticsSchemaMcp,
    TeamStatisticsOutputSchema,
    TeamCrossProjectInsightsSchema,
    TeamCrossProjectInsightsSchemaMcp,
    TeamCrossProjectInsightsOutputSchema,
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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const { group_by } = TeamGetStatisticsSchema.parse(params)
                    const stats = teamDb.getStatistics(group_by)

                    // Author breakdown
                    let authors: { author: string; count: number }[] = []
                    try {
                        const authorResult = teamDb.executeRawQuery(
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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
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
                    const projectsResult = teamDb.executeRawQuery(
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
                    const projectNumbers = projects.map(
                        (p) => p['project_number'] as number
                    )
                    if (projectNumbers.length > 0) {
                        const tagPlaceholders = projectNumbers.map(() => '?').join(',')
                        const allTagsResult = teamDb.executeRawQuery(
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
                    const cutoffDate = new Date(
                        Date.now() - INACTIVE_THRESHOLD_DAYS * MS_PER_DAY
                    )
                        .toISOString()
                        .split('T')[0]
                    const inactiveResult = teamDb.executeRawQuery(
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
                    const distribution = projects
                        .slice(0, 5)
                        .map((p: Record<string, unknown>) => ({
                            project_number: p['project_number'] as number,
                            percentage: (
                                ((p['entry_count'] as number) / totalEntries) *
                                100
                            ).toFixed(1),
                        }))

                    return {
                        project_count: projects.length,
                        total_entries: totalEntries,
                        projects: projects.map((p) => ({
                            ...p,
                            top_tags:
                                projectTags[p['project_number'] as number] ?? [],
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
    ]
}
