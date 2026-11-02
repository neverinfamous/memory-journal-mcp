import { z } from 'zod'
import {
    ENTRY_TYPES,
    RelationshipOutputSchema,
    relaxedNumber,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    StrictProjectNumberSchema,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { TeamEntryOutputSchema } from './core-search-schemas.js'

/** team_get_statistics — strict */
export const TeamGetStatisticsSchema = z.object({
    group_by: z.enum(['day', 'week', 'month']).optional().default('week'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

/** team_get_statistics — relaxed */
export const TeamGetStatisticsSchemaMcp = z.object({
    group_by: z.string().optional().default('week'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

const normalizeTeamLinkRelationshipType = (val: unknown): unknown =>
    val === 'resolves'
        ? 'resolved'
        : val === 'relates_to'
          ? 'references'
          : val === 'depends_on'
            ? 'blocked_by'
            : val

/** team_link_entries — strict */
export const TeamLinkEntriesSchema = z.object({
    from_entry_id: z.number(),
    to_entry_id: z.number(),
    relationship_type: z.preprocess(
        normalizeTeamLinkRelationshipType,
        z
            .enum([
                'evolves_from',
                'references',
                'implements',
                'clarifies',
                'response_to',
                'blocked_by',
                'resolved',
                'caused',
            ])
            .optional()
            .default('references')
    ),
    description: z.string().optional(),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
})

/** team_link_entries — relaxed */
export const TeamLinkEntriesSchemaMcp = z
    .object({
        from_entry_id: relaxedNumber().optional(),
        to_entry_id: relaxedNumber().optional(),
        from: relaxedNumber().optional(),
        to: relaxedNumber().optional(),
        from_id: relaxedNumber().optional(),
        to_id: relaxedNumber().optional(),
        source_id: relaxedNumber().optional(),
        target_id: relaxedNumber().optional(),
        relationship_type: z.string().optional().default('references'),
        type: z.string().optional(),
        rel: z.string().optional(),
        description: z.string().optional(),
        message: z.string().optional(),
        text: z.string().optional(),
        project_number: relaxedNumber().optional(),
        workspace_id: z
            .string()
            .optional()
            .describe(
                'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
            ),
    })
    .transform((data) => {
        const rawRel = data.type ?? data.rel ?? data.relationship_type ?? 'references'
        const normalizedRel = normalizeTeamLinkRelationshipType(rawRel) as string
        return {
            from_entry_id: data.from_entry_id ?? data.from_id ?? data.from ?? data.source_id,
            to_entry_id: data.to_entry_id ?? data.to_id ?? data.to ?? data.target_id,
            relationship_type: normalizedRel,
            description: data.description ?? data.message ?? data.text,
            project_number: data.project_number,
            workspace_id: data.workspace_id,
        }
    })

/** team_visualize_relationships — strict */
export const TeamVisualizeRelationshipsSchema = z.object({
    entry_id: z.number().optional(),
    tag: z.string().optional(),
    depth: z.number().min(1).max(5).optional().default(2),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

/** team_visualize_relationships — relaxed */
export const TeamVisualizeRelationshipsSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    tag: z.string().optional(),
    depth: relaxedNumber().optional().default(2),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

export const TeamStatisticsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        totalEntries: z.number().optional(),
        periodEntries: z.number().optional(),
        entryTypes: z.record(z.string(), z.number()).optional(),
        topTags: z.array(z.object({ name: z.string(), count: z.number() })).optional(),
        authors: z.array(z.object({ author: z.string(), count: z.number() })).optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamLinkEntriesOutputSchema = z
    .object({
        success: z.boolean().optional(),
        relationship: RelationshipOutputSchema.optional(),
        duplicate: z.boolean().optional().describe('True if relationship already existed'),
        message: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamVisualizeOutputSchema = z
    .object({
        success: z.boolean().optional(),
        mermaid: z.string().optional(),
        nodeCount: z.number().optional(),
        edgeCount: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

function preprocessSemanticSearchQuery(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) }
        let modified = false
        for (const key of ['q', 'text', 'message', 'description']) {
            if (key in obj && !('query' in obj)) {
                obj['query'] = obj[key]
                Reflect.deleteProperty(obj, key)
                modified = true
                break
            }
        }
        return modified ? obj : val
    }
    return val
}

/** team_semantic_search — strict */
export const TeamSemanticSearchSchema = z.preprocess(
    preprocessSemanticSearchQuery,
    z.object({
        query: z.string().optional(),
        entry_id: z.number().optional().describe('Find entries related to this entry ID'),
        limit: z.number().max(500).optional().default(10),
        similarity_threshold: z.number().optional().default(0.25),
        tags: z.array(z.string()).optional(),
        entry_type: z.enum(ENTRY_TYPES).optional(),
        start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        hint_on_empty: z
            .boolean()
            .optional()
            .default(true)
            .describe('Include hint when no results found (default: true)'),
        project_number: StrictProjectNumberSchema,
        workspace_id: z.string().optional(),
        issue_number: z.number().optional().describe('Filter results by GitHub issue number'),
        pr_number: z.number().optional().describe('Filter results by GitHub PR number'),
        workflow_run_id: z
            .number()
            .optional()
            .describe('Filter results by GitHub Actions workflow run ID'),
        include_archived: z.boolean().optional().default(false),
    })
)

/** team_semantic_search — relaxed */
export const TeamSemanticSearchSchemaMcp = z.preprocess(
    preprocessSemanticSearchQuery,
    z.object({
        query: z.string().optional(),
        entry_id: relaxedNumber().optional().describe('Find entries related to this entry ID'),
        limit: relaxedNumber().optional().default(10),
        similarity_threshold: relaxedNumber().optional().default(0.25),
        tags: z.array(z.string()).optional(),
        entry_type: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        hint_on_empty: z
            .boolean()
            .optional()
            .default(true)
            .describe('Include hint when no results found (default: true)'),
        project_number: relaxedNumber().optional(),
        workspace_id: z
            .string()
            .optional()
            .describe(
                'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
            ),
        issue_number: relaxedNumber().optional().describe('Filter results by GitHub issue number'),
        pr_number: relaxedNumber().optional().describe('Filter results by GitHub PR number'),
        workflow_run_id: relaxedNumber()
            .optional()
            .describe('Filter results by GitHub Actions workflow run ID'),
        include_archived: z.boolean().optional().default(false),
    })
)

/** team_add_to_vector_index — strict */
export const TeamAddToVectorIndexSchema = z.object({
    entry_id: z.number(),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
})

/** team_add_to_vector_index — relaxed */
export const TeamAddToVectorIndexSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    project_number: relaxedNumber().optional(),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

const TeamSemanticEntryOutputSchema = TeamEntryOutputSchema.extend({
    similarity: z.number(),
})

export const TeamSemanticSearchOutputSchema = z
    .object({
        query: z.string().optional(),
        entryId: z.number().optional(),
        entries: z.array(TeamSemanticEntryOutputSchema).optional(),
        count: z.number().optional(),
        hint: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamVectorStatsOutputSchema = z
    .object({
        available: z.boolean(),
        error: z.string().optional(),
        itemCount: z.number().optional(),
        modelName: z.string().optional(),
        dimensions: z.number().optional(),
        success: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamRebuildVectorIndexOutputSchema = z
    .object({
        success: z.boolean().optional(),
        partial: z.boolean().optional(),
        entriesIndexed: z.number().optional(),
        failedEntries: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamAddToVectorIndexOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entryId: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/** team_get_cross_project_insights — strict */
export const TeamCrossProjectInsightsSchema = z.object({
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
    limit: z.number().max(500).optional().default(100).describe('Max projects to return'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

/** team_get_cross_project_insights — relaxed */
export const TeamCrossProjectInsightsSchemaMcp = z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    min_entries: relaxedNumber().optional().describe('Minimum entries to include project'),
    limit: relaxedNumber().optional().describe('Max projects to return'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

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
export const TeamCollaborationMatrixSchema = z.object({
    period: z
        .enum(['week', 'month', 'quarter'])
        .optional()
        .default('month')
        .describe('Time granularity for the activity heatmap'),
    limit: z.number().max(100).optional().default(20).describe('Max authors to include'),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

/** team_get_collaboration_matrix — relaxed */
export const TeamCollaborationMatrixSchemaMcp = z.object({
    period: z.string().optional().default('month'),
    limit: relaxedNumber().optional().default(20),
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
