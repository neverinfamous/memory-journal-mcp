/**
 * Analytics Tool Group - 2 tools
 *
 * Tools: get_statistics, get_cross_project_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import {
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    TagOutputSchema,
    relaxedNumber,
} from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// Named constants (magic value extraction)
const INACTIVE_THRESHOLD_DAYS = 7

// ============================================================================
// Output Schemas
// ============================================================================

const StatisticsOutputSchema = z
    .object({
        groupBy: z.string().optional(),
        totalEntries: z.number().optional(),
        entriesByType: z.record(z.string(), z.number()).optional(),
        entriesByPeriod: z
            .array(
                z.object({
                    period: z.string(),
                    count: z.number(),
                })
            )
            .optional(),
        decisionDensity: z
            .array(
                z.object({
                    period: z.string(),
                    significantCount: z.number(),
                })
            )
            .optional(),
        relationshipComplexity: z
            .object({
                totalRelationships: z.number(),
                avgPerEntry: z.number(),
            })
            .optional(),
        activityTrend: z
            .object({
                currentPeriod: z.string(),
                previousPeriod: z.string(),
                growthPercent: z.number().nullable(),
            })
            .optional(),
        causalMetrics: z
            .object({
                blocked_by: z.number(),
                resolved: z.number(),
                caused: z.number(),
            })
            .optional(),
        dateRange: z
            .object({
                startDate: z.string(),
                endDate: z.string(),
            })
            .optional(),
        projectBreakdown: z
            .array(
                z.object({
                    project_number: z.number(),
                    entry_count: z.number(),
                })
            )
            .optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const ProjectSummaryOutputSchema = z
    .object({
        project_number: z.number(),
        entry_count: z.number(),
        first_entry: z.string(),
        last_entry: z.string(),
        active_days: z.number(),
        top_tags: z.array(TagOutputSchema),
    })
    .extend(ErrorFieldsMixin.shape)

const CrossProjectInsightsOutputSchema = z
    .object({
        project_count: z.number().optional(),
        total_entries: z.number().optional(),
        projects: z.array(ProjectSummaryOutputSchema).optional(),
        inactive_projects: z
            .array(
                z.object({
                    project_number: z.number(),
                    last_entry_date: z.string(),
                })
            )
            .optional(),
        inactiveThresholdDays: z.number().optional(),
        time_distribution: z
            .array(
                z.object({
                    project_number: z.number(),
                    percentage: z.string(),
                })
            )
            .optional(),
        message: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
const GetStatisticsSchema = z.object({
    group_by: z.enum(['day', 'week', 'month']).optional().default('week'),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    project_breakdown: z.boolean().optional().default(false),
})

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const GetStatisticsSchemaMcp = z.object({
    group_by: z.string().optional().default('week'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    project_breakdown: z.boolean().optional().default(false),
})

/** Strict schema — used inside handler for structured Zod errors */
const CrossProjectInsightsInputSchema = z.object({
    start_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Start date (YYYY-MM-DD)'),
    end_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('End date (YYYY-MM-DD)'),
    min_entries: z.number().optional().default(3).describe('Minimum entries to include project'),
})

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const CrossProjectInsightsInputSchemaMcp = z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    min_entries: relaxedNumber()
        .optional()
        .default(3)
        .describe('Minimum entries to include project'),
})

// ============================================================================
// Tool Definitions
// ============================================================================

export function getAnalyticsTools(context: ToolContext): ToolDefinition[] {
    const { db } = context
    return [
        {
            name: 'get_statistics',
            title: 'Get Statistics',
            description:
                'Get journal statistics and analytics (Phase 2: includes project breakdown)',
            group: 'analytics',
            inputSchema: GetStatisticsSchemaMcp,
            outputSchema: StatisticsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    const { group_by, start_date, end_date, project_breakdown } =
                        GetStatisticsSchema.parse(params)
                    const stats = db.getStatistics(
                        group_by,
                        start_date,
                        end_date,
                        project_breakdown
                    )
                    return { success: true, ...(stats as object), groupBy: group_by }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'get_cross_project_insights',
            title: 'Get Cross-Project Insights',
            description: 'Analyze patterns across all GitHub Projects tracked in journal entries',
            group: 'analytics',
            inputSchema: CrossProjectInsightsInputSchemaMcp,
            outputSchema: CrossProjectInsightsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (params: unknown) => {
                try {
                    const input = CrossProjectInsightsInputSchema.parse(params)

                    const results = db.getCrossProjectInsights({
                        startDate: input.start_date,
                        endDate: input.end_date,
                        minEntries: input.min_entries,
                        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
                    })

                    if (results.projects.length === 0) {
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

                    // Calculate time distribution
                    const totalEntries = results.projects.reduce(
                        (sum: number, p: Record<string, unknown>) =>
                            sum + (p['entry_count'] as number),
                        0
                    )
                    const distribution = results.projects
                        .slice(0, 5)
                        .map((p: Record<string, unknown>) => ({
                            project_number: p['project_number'] as number,
                            percentage: (
                                ((p['entry_count'] as number) / totalEntries) *
                                100
                            ).toFixed(1),
                        }))

                    return {
                        success: true,
                        project_count: results.projects.length,
                        total_entries: totalEntries,
                        projects: results.projects,
                        inactive_projects: results.inactiveProjects,
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
