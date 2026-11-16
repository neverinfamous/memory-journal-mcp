import { z } from 'zod'
import { relaxedNumber, StrictProjectNumberSchema } from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'

export const TeamProjectSummaryOutputSchema = z
    .object({
        project_number: z.number(),
        entry_count: z.number(),
        first_entry: z.string(),
        last_entry: z.string(),
        active_days: z.number(),
        top_tags: z.array(z.object({ name: z.string(), count: z.number() })),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamCrossProjectInsightsOutputSchema = z
    .object({
        project_count: z.number().optional(),
        total_entries: z.number().optional(),
        projects: z.array(TeamProjectSummaryOutputSchema).optional(),
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

/** team_get_collaboration_matrix — strict */
export const TeamCollaborationMatrixSchema = z
    .object({
        period: z
            .enum(['week', 'month', 'quarter'])
            .optional()
            .default('month')
            .describe('Time granularity for the activity heatmap'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(20)
            .describe('Max authors to include'),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z
            .string()
            .optional()
            .describe(
                'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
            ),
    })
    .strict()

/** team_get_collaboration_matrix — relaxed */
export const TeamCollaborationMatrixSchemaMcp = z.object({
    period: z.string().optional().default('month').describe('Time granularity: week, month, or quarter'),
    limit: relaxedNumber()
        .optional()
        .default(20)
        .describe('Max authors to include (1-100, default: 20)'),
    project_number: relaxedNumber().optional().describe('Project number to scope matrix to'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

export const TeamCollaborationMatrixOutputSchema = z
    .object({
        success: z.boolean().optional(),
        totalAuthors: z.number().optional(),
        totalEntries: z.number().optional(),
        authorActivity: z
            .array(
                z.object({
                    author: z.string(),
                    period: z.string(),
                    entryCount: z.number(),
                })
            )
            .optional(),
        crossAuthorLinks: z
            .array(
                z.object({
                    fromAuthor: z.string(),
                    toAuthor: z.string(),
                    linkCount: z.number(),
                })
            )
            .optional(),
        impactFactor: z
            .array(
                z.object({
                    author: z.string(),
                    inboundLinks: z.number(),
                })
            )
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
