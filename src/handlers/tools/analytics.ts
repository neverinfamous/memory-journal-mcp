/**
 * Analytics Tool Group - 2 tools
 *
 * Tools: get_statistics, get_cross_project_insights
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerErrorResponse } from '../../utils/error-helpers.js'
import { DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE, TagOutputSchema, relaxedNumber } from './schemas.js'
import { ErrorResponseFields } from './error-response-fields.js'

// Named constants (magic value extraction)
const INACTIVE_THRESHOLD_DAYS = 7
const MS_PER_DAY = 86_400_000
const MAX_TAGS_PER_PROJECT = 5

// ============================================================================
// Output Schemas
// ============================================================================

const StatisticsOutputSchema = z.object({
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
}).extend(ErrorResponseFields.shape)

const ProjectSummaryOutputSchema = z.object({
    project_number: z.number(),
    entry_count: z.number(),
    first_entry: z.string(),
    last_entry: z.string(),
    active_days: z.number(),
    top_tags: z.array(TagOutputSchema),
}).extend(ErrorResponseFields.shape)

const CrossProjectInsightsOutputSchema = z.object({
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
}).extend(ErrorResponseFields.shape)

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
    min_entries: relaxedNumber().optional().default(3).describe('Minimum entries to include project'),
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
            annotations: { readOnlyHint: true, idempotentHint: true },
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
                    return { ...(stats as object), groupBy: group_by }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
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
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (params: unknown) => {
                try {
                    const input = CrossProjectInsightsInputSchema.parse(params)

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
                    const projectsResult = db.executeRawQuery(
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
                        [...sqlParams, input.min_entries]
                    )

                    if (!projectsResult[0] || projectsResult[0].values.length === 0) {
                        return {
                            project_count: 0,
                            total_entries: 0,
                            projects: [],
                            inactive_projects: [],
                            inactiveThresholdDays: 7,
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
                    const projectNumbers = projects.map((p) => p['project_number'] as number)
                    if (projectNumbers.length > 0) {
                        const tagPlaceholders = projectNumbers.map(() => '?').join(',')
                        const allTagsResult = db.executeRawQuery(
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
                            // Partition rows by project_number, keeping top 5 per project
                            for (const row of allTagsResult[0].values) {
                                const projNum = row[0] as number
                                const tagEntry = { name: row[1] as string, count: row[2] as number }
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
                    const inactiveResult = db.executeRawQuery(
                        `
                        SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
                        FROM memory_journal
                        WHERE deleted_at IS NULL AND project_number IS NOT NULL
                        GROUP BY project_number
                        HAVING last_entry_date < ?
                    `,
                        [cutoffDate]
                    )

                    const inactiveProjects =
                        inactiveResult[0]?.values.map((row: unknown[]) => ({
                            project_number: row[0] as number,
                            last_entry_date: row[1] as string,
                        })) ?? []

                    // Calculate time distribution
                    const totalEntries = projects.reduce(
                        (sum: number, p: Record<string, unknown>) => sum + (p['entry_count'] as number),
                        0
                    )
                    const distribution = projects.slice(0, 5).map((p: Record<string, unknown>) => ({
                        project_number: p['project_number'] as number,
                        percentage: (((p['entry_count'] as number) / totalEntries) * 100).toFixed(
                            1
                        ),
                    }))

                    return {
                        project_count: projects.length,
                        total_entries: totalEntries,
                        projects: projects.map((p) => ({
                            ...p,
                            top_tags: projectTags[p['project_number'] as number] ?? [],
                        })),
                        inactive_projects: inactiveProjects,
                        inactiveThresholdDays: 7,
                        time_distribution: distribution,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
