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

                    let authors: { author: string; count: number }[] = []
                    try {
                        authors = teamDb.getAuthorStatistics()
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

                    const insights = teamDb.getCrossProjectInsights({
                        startDate: input.start_date,
                        endDate: input.end_date,
                        minEntries: input.min_entries,
                        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
                    })

                    if (insights.projects.length === 0) {
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

                    // Apply limit after fetching from cross project insights
                    const limitedProjects = insights.projects.slice(0, input.limit)
                    const limitedInactive = insights.inactiveProjects.slice(0, input.limit)

                    const totalEntries = limitedProjects.reduce(
                        (sum: number, p: Record<string, unknown>) =>
                            sum + (p['entry_count'] as number),
                        0
                    )
                    const distribution = limitedProjects.slice(0, 5).map((p: Record<string, unknown>) => ({
                        project_number: p['project_number'] as number,
                        percentage: (((p['entry_count'] as number) / totalEntries) * 100).toFixed(1),
                    }))

                    return {
                        success: true,
                        project_count: limitedProjects.length,
                        total_entries: totalEntries,
                        projects: limitedProjects,
                        inactive_projects: limitedInactive,
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

                    const matrix = teamDb.getTeamCollaborationMatrix({ period, limit })

                    return {
                        success: true,
                        ...matrix,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
