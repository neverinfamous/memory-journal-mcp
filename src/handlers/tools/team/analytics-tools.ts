/**
 * Team Analytics Tools - 3 tools
 *
 * Tools: team_get_statistics, team_get_cross_project_insights, team_get_collaboration_matrix
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { logger } from '../../../utils/logger.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import {
    TEAM_DB_ERROR_RESPONSE,
    missingTeamProjectNumberError,
    resolveTeamProjectNumber,
} from './helpers.js'
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

function executeTeamGetStatistics(
    teamDb: NonNullable<ToolContext['teamDb']>,
    context: ToolContext,
    params: unknown
): unknown {
    const { group_by, project_number, workspace_id } = TeamGetStatisticsSchema.parse(params)
    const wsId = resolveWorkspaceId(workspace_id, project_number, context.config)
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const hasActiveRegistry = registry !== undefined && Object.keys(registry).length > 0
    const alignedProject =
        resolveTeamProjectNumber(context, wsId, project_number, workspace_id) ?? undefined
    if ((wsId === '*' || hasActiveRegistry) && alignedProject === undefined) {
        return missingTeamProjectNumberError(
            'Missing project_number. Cross-tenant statistics without project_number are not allowed.'
        )
    }
    const stats = teamDb.getStatistics(group_by, undefined, undefined, undefined, wsId, alignedProject)

    let authors: { author: string; count: number }[] = []
    let authorStatsError: string | undefined
    try {
        authors = teamDb
            .getAuthorStatistics(wsId, alignedProject)
            .map((item) => ({ ...item, author: sanitizeAuthor(item.author) }))
    } catch (err) {
        authorStatsError = err instanceof Error ? err.message : String(err)
        logger.debug('Failed to fetch team author statistics', { error: err })
    }

    return {
        success: authorStatsError === undefined,
        ...stats,
        authors,
        ...(authorStatsError !== undefined
            ? { warning: `Author statistics failed: ${authorStatsError}` }
            : {}),
    }
}

function executeTeamGetCrossProjectInsights(
    teamDb: NonNullable<ToolContext['teamDb']>,
    context: ToolContext,
    params: unknown
): unknown {
    const input = TeamCrossProjectInsightsSchema.parse(params)
    if (
        input.start_date !== undefined &&
        input.end_date !== undefined &&
        input.start_date > input.end_date
    ) {
        throw new ValidationError('start_date cannot be after end_date')
    }
    const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const hasActiveRegistry = registry !== undefined && Object.keys(registry).length > 0
    const alignedProject =
        resolveTeamProjectNumber(context, wsId, input.project_number, input.workspace_id) ??
        undefined
    if ((wsId === '*' || hasActiveRegistry) && alignedProject === undefined) {
        return missingTeamProjectNumberError(
            'Missing project_number. Cross-tenant cross-project insights without project_number are not allowed.'
        )
    }

    const insights = teamDb.getCrossProjectInsights({
        startDate: input.start_date,
        endDate: input.end_date,
        minEntries: input.min_entries,
        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
        workspaceId: wsId,
        ...(alignedProject !== undefined ? { projectNumber: alignedProject } : {}),
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

    const limitedProjects = insights.projects.slice(0, input.limit)
    const limitedInactive = insights.inactiveProjects.slice(0, input.limit)
    const totalEntries = limitedProjects.reduce(
        (sum: number, p: Record<string, unknown>) =>
            sum + (typeof p['entry_count'] === 'number' ? p['entry_count'] : 0),
        0
    )
    const distribution = limitedProjects.slice(0, 5).map((p: Record<string, unknown>) => {
        const entryCount = typeof p['entry_count'] === 'number' ? p['entry_count'] : 0
        return {
            project_number: typeof p['project_number'] === 'number' ? p['project_number'] : 0,
            percentage: (totalEntries > 0 ? (entryCount / totalEntries) * 100 : 0).toFixed(1),
        }
    })

    return {
        success: true,
        project_count: limitedProjects.length,
        total_entries: totalEntries,
        projects: limitedProjects,
        inactive_projects: limitedInactive,
        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
        time_distribution: distribution,
    }
}

function executeTeamGetCollaborationMatrix(
    teamDb: NonNullable<ToolContext['teamDb']>,
    context: ToolContext,
    params: unknown
): unknown {
    const { period, limit, project_number, workspace_id } =
        TeamCollaborationMatrixSchema.parse(params)
    const workspaceId = resolveWorkspaceId(workspace_id, project_number, context.config)
    const registry = activeProjectRegistry(context.config?.projectRegistry)
    const hasActiveRegistry = registry !== undefined && Object.keys(registry).length > 0
    const projectNumber =
        resolveTeamProjectNumber(context, workspaceId, project_number, workspace_id) ?? undefined
    if ((workspaceId === '*' || hasActiveRegistry) && projectNumber === undefined) {
        return missingTeamProjectNumberError(
            'Missing project_number. Cross-tenant collaboration matrices without project_number are not allowed.'
        )
    }
    const rawMatrix = teamDb.getTeamCollaborationMatrix({
        period,
        limit,
        workspaceId,
        ...(projectNumber !== undefined ? { projectNumber } : {}),
    })

    const matrix = {
        ...rawMatrix,
        authorActivity: rawMatrix.authorActivity.map((item) => ({
            ...item,
            author: sanitizeAuthor(item.author),
        })),
        crossAuthorLinks: rawMatrix.crossAuthorLinks.map((item) => ({
            ...item,
            fromAuthor: sanitizeAuthor(item.fromAuthor),
            toAuthor: sanitizeAuthor(item.toAuthor),
        })),
        impactFactor: rawMatrix.impactFactor.map((item) => ({
            ...item,
            author: sanitizeAuthor(item.author),
        })),
    }

    return {
        success: true,
        ...matrix,
    }
}

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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamGetStatistics(teamDb, context, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_get_cross_project_insights',
            title: 'Team Cross-Project Insights',
            description:
                'Analyze patterns across all GitHub Projects tracked in team entries. Use for architecture planning. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamCrossProjectInsightsSchemaMcp,
            outputSchema: TeamCrossProjectInsightsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamGetCrossProjectInsights(teamDb, context, params)
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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamGetCollaborationMatrix(teamDb, context, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
