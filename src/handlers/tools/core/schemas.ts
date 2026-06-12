import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES, EntryOutputSchema, relaxedNumber } from '../schemas.js'

// ============================================================================
// Shared Constants
// ============================================================================
const MAX_SEARCH_LIMIT = 500

// ============================================================================
// Core Schemas
// ============================================================================

export const CreateEntrySchema = z.object({
    entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
    content: z.string().min(1),
    tags: z.array(z.string()).optional(),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    project_number: z.number().optional(),
    project_owner: z.string().optional(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
    pr_number: z.number().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.string().optional(),
    share_with_team: z.boolean().optional().default(false),
})

export const CreateEntrySchemaMcp = z.object({
    entry_type: z.string().optional().default('personal_reflection').describe(
        'Entry type. Use "retrospective" for session summaries, "bug_fix" for bugs, ' +
        '"feature_implementation" for features, "planning" for roadmaps, ' +
        '"technical_note" for implementation notes. Do NOT default to "personal_reflection" ' +
        'unless the entry is genuinely a personal note.'
    ),
    content: z.string().min(1).describe(
        'Markdown-formatted entry content. Use ## section headers to organize content. ' +
        'For session summaries (entry_type: "retrospective", tagged "session-summary"), ' +
        'MUST use EXACTLY: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session. ' +
        'Do NOT invent extra top-level sections for session summaries.'
    ),
    tags: z.array(z.string()).optional().describe(
        'Tags for categorization (kebab-case). Session summaries MUST include "session-summary". ' +
        'Add domain tags (e.g., "security", "performance") and activity tags (e.g., "refactor", "audit").'
    ),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    project_number: relaxedNumber().optional().describe(
        'REQUIRED. Numeric project ID (e.g., 1, 14). Find it in the briefing Config row ' +
        '(registry: repoName (#N)) or use get_statistics. Do NOT pass a repo name string.'
    ),
    project_owner: z.string().optional(),
    issue_number: relaxedNumber().optional(),
    issue_url: z.string().optional(),
    pr_number: relaxedNumber().optional(),
    pr_url: z.string().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: relaxedNumber().optional(),
    workflow_name: z.string().optional(),
    workflow_status: z.string().optional(),
    share_with_team: z.boolean().optional().default(false).describe('If true, saves a copy of this entry to the Team database (if configured) using your team alias'),
})

export const CreateEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        id: z.number().optional(),
        entry: EntryOutputSchema.optional(),
        sharedWithTeam: z.boolean().optional(),
        author: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GetEntryByIdSchema = z.object({
    entry_id: z.number(),
    include_relationships: z.boolean().optional().default(true),
})

export const GetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().describe('The numeric ID of the entry to retrieve'),
    include_relationships: z.boolean().optional().default(true).describe('If true, includes all linked relationships (causal, related) in the response'),
})

export const EntryByIdOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: EntryOutputSchema.optional(),
        relationships: z.any().optional(),
        importance: z.number().optional(),
        importanceBreakdown: z.any().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GetRecentEntriesSchema = z.object({
    limit: z.number().min(1).max(MAX_SEARCH_LIMIT).optional().default(10),
    is_personal: z.boolean().optional(),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    cursor: z.string().optional(),
    include_archived: z.boolean().optional().default(false),
})

export const GetRecentEntriesSchemaMcp = z.object({
    limit: relaxedNumber()
        .optional()
        .default(10)
        .describe(`Maximum entries to return (max ${String(MAX_SEARCH_LIMIT)})`),
    is_personal: z.boolean().optional(),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    cursor: z.string().optional(),
    include_archived: z.boolean().optional().default(false),
})

// ============================================================================
// History Schemas
// ============================================================================

export const GetEntryHistorySchema = z.object({
    entry_id: z.number(),
})

export const GetEntryHistorySchemaMcp = z.object({
    entry_id: relaxedNumber().describe('The numeric ID of the entry'),
})

export const GetEntryHistoryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        id: z.number().optional(),
        current: EntryOutputSchema.optional(),
        history: z
            .array(
                z.object({
                    revisionId: z.number(),
                    entryId: z.number(),
                    content: z.string(),
                    tags: z.array(z.string()).optional(),
                    createdAt: z.string(),
                    isArchive: z.boolean().optional(),
                })
            )
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Testing/Misc Schemas
// ============================================================================

export const TagsListOutputSchema = z
    .object({
        tags: z.array(z.object({ name: z.string(), count: z.number().optional() })).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TestSimpleSchema = z.object({
    message: z.string().optional().default('Hello'),
})

export const TestSimpleOutputSchema = z
    .object({
        message: z.string().optional(),
        timestamp: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
