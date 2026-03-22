/**
 * Team Tool Schemas
 *
 * Input and output Zod schemas for all 20 team tools.
 * Follows dual-schema pattern: relaxed (MCP SDK) + strict (handler).
 */

import { z } from 'zod'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    MAX_CONTENT_LENGTH,
    EntryOutputSchema,
    RelationshipOutputSchema,
    TagOutputSchema,
    relaxedNumber,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
} from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

// ============================================================================
// Shared Team Entry Output
// ============================================================================

export const TeamEntryOutputSchema = EntryOutputSchema.extend({
    author: z.string().nullable().optional(),
})

// ============================================================================
// Core Tool Schemas
// ============================================================================

/** team_create_entry — strict */
export const TeamCreateEntrySchema = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    author: z.string().optional(),
})

/** team_create_entry — relaxed for MCP SDK */
export const TeamCreateEntrySchemaMcp = z.object({
    content: z.string().min(1).max(MAX_CONTENT_LENGTH),
    entry_type: z.string().optional().default('personal_reflection'),
    tags: z.array(z.string()).optional().default([]),
    significance_type: z.string().optional(),
    project_number: relaxedNumber().optional(),
    project_owner: z.string().optional(),
    issue_number: relaxedNumber().optional(),
    issue_url: z.string().optional(),
    pr_number: relaxedNumber().optional(),
    pr_url: z.string().optional(),
    pr_status: z.string().optional(),
    author: z.string().optional(),
})

/** team_get_recent — strict */
export const TeamGetRecentSchema = z.object({
    limit: z.number().max(500).optional().default(10),
})

/** team_get_recent — relaxed */
export const TeamGetRecentSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(10),
})

/** team_search — strict */
export const TeamSearchSchema = z.object({
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(10),
})

/** team_search — relaxed */
export const TeamSearchSchemaMcp = z.object({
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber().optional().default(10),
})

/** team_get_entry_by_id — strict */
export const TeamGetEntryByIdSchema = z.object({
    entry_id: z.number(),
    include_relationships: z.boolean().optional().default(true),
})

/** team_get_entry_by_id — relaxed */
export const TeamGetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber(),
    include_relationships: z.boolean().optional().default(true),
})

// ============================================================================
// Search Tool Schemas
// ============================================================================

/** team_search_by_date_range — strict */
export const TeamSearchByDateRangeSchema = z.object({
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(50),
})

/** team_search_by_date_range — relaxed */
export const TeamSearchByDateRangeSchemaMcp = z.object({
    start_date: z.string().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().describe('End date (YYYY-MM-DD)'),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber().optional().default(50),
})

// ============================================================================
// Admin Tool Schemas
// ============================================================================

/** team_update_entry — strict */
export const TeamUpdateEntrySchema = z.object({
    entry_id: z.number(),
    content: z.string().min(1).max(MAX_CONTENT_LENGTH).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
})

/** team_update_entry — relaxed */
export const TeamUpdateEntrySchemaMcp = z.object({
    entry_id: relaxedNumber(),
    content: z.string().optional(),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
})

/** team_delete_entry — strict */
export const TeamDeleteEntrySchema = z.object({
    entry_id: z.number(),
})

/** team_delete_entry — relaxed */
export const TeamDeleteEntrySchemaMcp = z.object({
    entry_id: relaxedNumber(),
})

/** team_merge_tags — strict */
export const TeamMergeTagsSchema = z.object({
    source_tag: z.string().min(1),
    target_tag: z.string().min(1),
})

// ============================================================================
// Analytics Tool Schemas
// ============================================================================

/** team_get_statistics — strict */
export const TeamGetStatisticsSchema = z.object({
    group_by: z.enum(['day', 'week', 'month']).optional().default('week'),
})

/** team_get_statistics — relaxed */
export const TeamGetStatisticsSchemaMcp = z.object({
    group_by: z.string().optional().default('week'),
})

// ============================================================================
// Relationship Tool Schemas
// ============================================================================

/** team_link_entries — strict */
export const TeamLinkEntriesSchema = z.object({
    from_entry_id: z.number(),
    to_entry_id: z.number(),
    relationship_type: z
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
        .default('references'),
    description: z.string().optional(),
})

/** team_link_entries — relaxed */
export const TeamLinkEntriesSchemaMcp = z.object({
    from_entry_id: relaxedNumber(),
    to_entry_id: relaxedNumber(),
    relationship_type: z.string().optional().default('references'),
    description: z.string().optional(),
})

/** team_visualize_relationships — strict */
export const TeamVisualizeRelationshipsSchema = z.object({
    entry_id: z.number().optional(),
    tag: z.string().optional(),
    depth: z.number().min(1).max(5).optional().default(2),
})

/** team_visualize_relationships — relaxed */
export const TeamVisualizeRelationshipsSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    tag: z.string().optional(),
    depth: relaxedNumber().optional().default(2),
})

// ============================================================================
// Export Tool Schemas
// ============================================================================

/** team_export_entries — strict */
export const TeamExportEntriesSchema = z.object({
    format: z.enum(['json', 'markdown']).optional().default('json'),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(5000).optional().default(100),
})

/** team_export_entries — relaxed */
export const TeamExportEntriesSchemaMcp = z.object({
    format: z.string().optional().default('json'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber().optional().default(100),
})

// ============================================================================
// Backup Tool Schemas
// ============================================================================

/** team_backup — strict */
export const TeamBackupSchema = z.object({
    name: z.string().optional(),
})

// ============================================================================
// Output Schemas
// ============================================================================

export const TeamCreateOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        author: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamEntriesListOutputSchema = z
    .object({
        entries: z.array(TeamEntryOutputSchema).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamEntryDetailOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        relationships: z.array(RelationshipOutputSchema).optional(),
        importance: z
            .object({
                score: z.number(),
                breakdown: z
                    .object({
                        significance: z.number(),
                        relationships: z.number(),
                        causal: z.number(),
                        recency: z.number(),
                    })
                    .optional(),
            })
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamTagsListOutputSchema = z
    .object({
        success: z.boolean().optional(),
        tags: z.array(TagOutputSchema).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamUpdateOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamDeleteOutputSchema = z
    .object({
        success: z.boolean().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamMergeTagsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        message: z.string().optional(),
        entriesUpdated: z.number().optional(),
        sourceDeleted: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

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

export const TeamExportOutputSchema = z
    .object({
        success: z.boolean().optional(),
        format: z.string().optional(),
        data: z.string().optional(),
        count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamBackupOutputSchema = z
    .object({
        success: z.boolean().optional(),
        message: z.string().optional(),
        filename: z.string().optional(),
        path: z.string().optional(),
        sizeBytes: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamBackupsListOutputSchema = z
    .object({
        success: z.boolean().optional(),
        backups: z
            .array(
                z.object({
                    filename: z.string(),
                    path: z.string(),
                    sizeBytes: z.number(),
                    createdAt: z.string(),
                })
            )
            .optional(),
        total: z.number().optional(),
        backupsDirectory: z.string().optional(),
        hint: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Vector Tool Schemas
// ============================================================================

/** team_semantic_search — strict */
export const TeamSemanticSearchSchema = z.object({
    query: z.string(),
    limit: z.number().max(500).optional().default(10),
    similarity_threshold: z.number().optional().default(0.25),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
})

/** team_semantic_search — relaxed */
export const TeamSemanticSearchSchemaMcp = z.object({
    query: z.string(),
    limit: relaxedNumber().optional().default(10),
    similarity_threshold: relaxedNumber().optional().default(0.25),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
})

/** team_add_to_vector_index — strict */
export const TeamAddToVectorIndexSchema = z.object({
    entry_id: z.number(),
})

/** team_add_to_vector_index — relaxed */
export const TeamAddToVectorIndexSchemaMcp = z.object({
    entry_id: relaxedNumber(),
})

// ============================================================================
// Vector Output Schemas
// ============================================================================

const TeamSemanticEntryOutputSchema = TeamEntryOutputSchema.extend({
    similarity: z.number(),
})

export const TeamSemanticSearchOutputSchema = z
    .object({
        query: z.string().optional(),
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

// ============================================================================
// Cross-Project Insights Schemas
// ============================================================================

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
})

/** team_get_cross_project_insights — relaxed */
export const TeamCrossProjectInsightsSchemaMcp = z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    min_entries: relaxedNumber()
        .optional()
        .default(3)
        .describe('Minimum entries to include project'),
    limit: relaxedNumber().optional().default(100).describe('Max projects to return'),
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
