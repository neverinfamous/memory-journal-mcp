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
    entry_type: z.string().optional().default('personal_reflection'),
    content: z.string().min(1),
    tags: z.array(z.string()).optional(),
    is_personal: z.boolean().optional().default(true),
    significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
    project_number: relaxedNumber().optional(),
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
})

export const GetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().describe('The numeric ID of the entry to retrieve'),
})

export const EntryByIdOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: EntryOutputSchema.optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const GetRecentEntriesSchema = z.object({
    limit: z.number().min(1).max(MAX_SEARCH_LIMIT).optional().default(10),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
})

export const GetRecentEntriesSchemaMcp = z.object({
    limit: relaxedNumber()
        .optional()
        .default(10)
        .describe(`Maximum entries to return (max ${String(MAX_SEARCH_LIMIT)})`),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
})

// ============================================================================
// History Schemas
// ============================================================================

export const GetEntryHistorySchema = z.object({
    id: z.number(),
})

export const GetEntryHistorySchemaMcp = z.object({
    id: relaxedNumber().describe('The numeric ID of the entry'),
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
