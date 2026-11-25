/**
 * Analytics Tool Group - 2 tools
 *
 * Tools: get_statistics, get_cross_project_insights
 */

import { z } from 'zod'
import type { ErrorResponse } from '../../types/error-types.js'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../utils/write-scope.js'
import {
    DATE_FORMAT_MESSAGE,
    isValidCalendarDate,
    TagOutputSchema,
    coerceIntString,
    relaxedNumber,
} from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// Named constants (magic value extraction)
const INACTIVE_THRESHOLD_DAYS = 7

const PROJECT_NUMBER_ERROR =
    'project_number must be a positive safe integer or positive integer string'

/**
 * A positive integer project_number selects/filters a project. Decimal integer strings are coerced.
 * Any other present value (0, negative, float, non-numeric) is rejected.
 */
function coerceAnalyticsProjectNumber(projectNumber: unknown): number | undefined {
    if (projectNumber === undefined) return undefined
    if (typeof projectNumber === 'number') {
        if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
            throw new ValidationError(PROJECT_NUMBER_ERROR)
        }
        return projectNumber
    }
    if (typeof projectNumber === 'string') {
        const trimmed = projectNumber.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === trimmed) {
                return parsed
            }
        }
    }
    throw new ValidationError(PROJECT_NUMBER_ERROR)
}

function formatCrossProjectInsightsResponse(
    results: ReturnType<ToolContext['db']['getCrossProjectInsights']>,
    minEntries: number
): Record<string, unknown> {
    if (results.projects.length === 0) {
        return {
            success: true,
            project_count: 0,
            total_entries: 0,
            projects: [],
            inactive_projects: [],
            inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
            time_distribution: [],
            message: `No projects found with at least ${String(minEntries)} entries`,
        }
    }

    const totalEntries = results.projects.reduce((sum: number, p: Record<string, unknown>) => {
        const count = p['entry_count']
        return sum + (typeof count === 'number' ? count : Number(count ?? 0))
    }, 0)

    const distribution = results.projects.slice(0, 5).map((p: Record<string, unknown>) => {
        const rawProjNum = p['project_number']
        const rawCount = p['entry_count']
        const projNum = typeof rawProjNum === 'number' ? rawProjNum : Number(rawProjNum ?? 0)
        const entryCount = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0)
        return {
            project_number: projNum,
            percentage: (totalEntries > 0 ? (entryCount / totalEntries) * 100 : 0).toFixed(1),
        }
    })

    return {
        success: true,
        project_count: results.projects.length,
        total_entries: totalEntries,
        projects: results.projects,
        inactive_projects: results.inactiveProjects,
        inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
        time_distribution: distribution,
    }
}

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
                density: z.number().optional(),
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
        relationshipBreakdown: z.record(z.string(), z.number()).optional(),
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
                    projectName: z.string().optional(),
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
        projectName: z.string().optional(),
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
                    projectName: z.string().optional(),
                    last_entry_date: z.string(),
                })
            )
            .optional(),
        inactiveThresholdDays: z.number().optional(),
        time_distribution: z
            .array(
                z.object({
                    project_number: z.number(),
                    projectName: z.string().optional(),
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
    start_date: z.string().refine(isValidCalendarDate, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().refine(isValidCalendarDate, DATE_FORMAT_MESSAGE).optional(),
    project_breakdown: z.boolean().optional().default(false),
    workspace_id: z.string().max(255).optional(),
    project_number: z.unknown().optional(), // Allow injected project_number
}).strict()

const STATISTICS_HINT_KEYS = ['timeframe', 'period', 'time'] as const

function isStatisticsArgRecord(params: unknown): params is Record<string, unknown> {
    return typeof params === 'object' && params !== null && !Array.isArray(params)
}

/** Map documented hint keys (timeframe, period, time) onto group_by before the strict parse. */
function omitNonStrictStatisticsKeys(params: unknown): unknown {
    if (!isStatisticsArgRecord(params)) return params
    const copy: Record<string, unknown> = { ...params }
    const definedHintVals: string[] = []
    for (const hintKey of STATISTICS_HINT_KEYS) {
        if (!(hintKey in copy) || copy[hintKey] === undefined) continue
        const raw = copy[hintKey]
        if (typeof raw !== 'string' || raw.trim() === '') return copy
        definedHintVals.push(raw.trim())
    }
    if (definedHintVals.length === 0) return copy
    if (definedHintVals.some((v) => v !== definedHintVals[0])) return copy
    if (typeof copy['group_by'] === 'string' && copy['group_by'].trim() !== definedHintVals[0]) {
        return copy
    }
    if (copy['group_by'] !== undefined && typeof copy['group_by'] !== 'string') return copy
    copy['group_by'] ??= definedHintVals[0]
    for (const hintKey of STATISTICS_HINT_KEYS) {
        Reflect.deleteProperty(copy, hintKey)
    }
    return copy
}

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const GetStatisticsSchemaMcp = z.object({
    group_by: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    project_breakdown: z.boolean().optional().default(false).describe('Set to true to return multi-project entry breakdown across all registered projects (workspace_id: "*").'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    project_number: z.unknown().optional().describe('Numeric project ID (or registered project name) used to resolve the workspace and filter statistics to that project. Use project_breakdown: true for a per-project breakdown.'),
    timeframe: z.unknown().optional().describe('Anti-Hallucination Hint: Use group_by instead of timeframe or period.'),
    period: z.unknown().optional().describe('Anti-Hallucination Hint: Use group_by instead of timeframe or period.'),
    time: z.unknown().optional().describe('Anti-Hallucination Hint: Use group_by instead of timeframe or time.'),
})

/** Strict schema — used inside handler for structured Zod errors */
const CrossProjectInsightsInputSchema = z.object({
    start_date: z
        .string()
        .refine(isValidCalendarDate, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Start date (YYYY-MM-DD)'),
    end_date: z
        .string()
        .refine(isValidCalendarDate, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('End date (YYYY-MM-DD)'),
    min_entries: z
        .preprocess(coerceIntString, z.number().int().min(1))
        .optional()
        .default(3)
        .describe('Minimum entries to include project'),
    workspace_id: z.string().max(255).optional(),
    project_number: z.unknown().optional(), // Allow injected project_number
}).strict()

/** Strip anti-hallucination hint fields before strict cross-project schema parsing. */
export function omitNonStrictCrossProjectKeys(params: unknown): unknown {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        return params
    }
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
        if (k !== 'query' && k !== 'limit') {
            cleaned[k] = v
        }
    }
    return cleaned
}

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
const CrossProjectInsightsInputSchemaMcp = z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    min_entries: relaxedNumber()
        .optional()
        .default(3)
        .describe('Minimum entries to include project'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    project_number: z.unknown().optional().describe('Optional GitHub project number to resolve workspace or narrow insights to a specific project.'),
    query: z.unknown().optional().describe('Anti-Hallucination Hint: get_cross_project_insights does not take a query. It analyzes all entries.'),
    limit: z.unknown().optional().describe('Anti-Hallucination Hint: get_cross_project_insights does not take a limit.'),
})

// ============================================================================
// Tool Definitions
// ============================================================================

function executeGetStatistics(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    try {
        const {
            group_by,
            start_date,
            end_date,
            project_breakdown,
            workspace_id,
            project_number,
        } = GetStatisticsSchema.parse(omitNonStrictStatisticsKeys(params))
        if (start_date !== undefined && end_date !== undefined && start_date > end_date) {
            throw new ValidationError(`Invalid date range: start_date (${start_date}) is after end_date (${end_date})`, {
                suggestion: 'Ensure start_date is before or equal to end_date',
            })
        }
        const resolvedProjectNumber = coerceAnalyticsProjectNumber(project_number)
        // [INTENT] M1: project_breakdown spans all registered projects, so default the
        // scope to '*' unless the caller named a workspace/project explicitly.
        const wsId =
            project_breakdown &&
            workspace_id === undefined &&
            resolvedProjectNumber === undefined
                ? '*'
                : resolveWorkspaceId(workspace_id, resolvedProjectNumber, context.config)
        const effectiveProjectFilter = alignedProjectFilter(
            wsId,
            resolvedProjectNumber,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const stats = context.db.getStatistics(
            group_by,
            start_date,
            end_date,
            project_breakdown,
            wsId,
            ...(effectiveProjectFilter !== undefined ? [effectiveProjectFilter] : [])
        )
        return { success: true, ...(stats as object), groupBy: group_by }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function executeGetCrossProjectInsights(
    params: unknown,
    context: ToolContext
): Record<string, unknown> | ErrorResponse {
    try {
        const input = CrossProjectInsightsInputSchema.parse(omitNonStrictCrossProjectKeys(params))
        if (
            input.start_date !== undefined &&
            input.end_date !== undefined &&
            input.start_date > input.end_date
        ) {
            throw new ValidationError(
                `Invalid date range: start_date (${input.start_date}) is after end_date (${input.end_date})`,
                { suggestion: 'Ensure start_date is before or equal to end_date' }
            )
        }
        const resolvedProjectNumber = coerceAnalyticsProjectNumber(input.project_number)
        // [INTENT] M1: cross-project insights span all projects unless workspace_id or
        // project_number is specified by the caller.
        const wsId =
            input.workspace_id === undefined && resolvedProjectNumber === undefined
                ? '*'
                : resolveWorkspaceId(input.workspace_id, resolvedProjectNumber, context.config)
        const effectiveProjectFilter = alignedProjectFilter(
            wsId,
            resolvedProjectNumber,
            activeProjectRegistry(context.config?.projectRegistry)
        )

        const results = context.db.getCrossProjectInsights({
            startDate: input.start_date,
            endDate: input.end_date,
            minEntries: input.min_entries,
            inactiveThresholdDays: INACTIVE_THRESHOLD_DAYS,
            workspaceId: wsId,
            ...(effectiveProjectFilter !== undefined
                ? { projectNumber: effectiveProjectFilter }
                : {}),
        })

        return formatCrossProjectInsightsResponse(results, input.min_entries)
    } catch (err) {
        return formatHandlerError(err)
    }
}

export function getAnalyticsTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_statistics',
            title: 'Get Statistics',
            description:
                'Get journal statistics and analytics (Phase 2: includes project breakdown)',
            group: 'analytics',
            inputSchema: GetStatisticsSchemaMcp,
            outputSchema: StatisticsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeGetStatistics(params, context),
        },
        {
            name: 'get_cross_project_insights',
            title: 'Get Cross-Project Insights',
            description:
                'Analyze patterns across all GitHub Projects tracked in journal entries. Use for architecture planning.',
            group: 'analytics',
            inputSchema: CrossProjectInsightsInputSchemaMcp,
            outputSchema: CrossProjectInsightsOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeGetCrossProjectInsights(params, context),
        },
    ]
}
