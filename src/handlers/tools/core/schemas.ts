import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { ENTRY_TYPES, EntryOutputSchema, relaxedNumber } from '../schemas.js'

// ============================================================================
// Shared Constants
// ============================================================================
const MAX_SEARCH_LIMIT = 500

// ============================================================================
// Core Schemas
// ============================================================================

export const CreateEntrySchema = z.object({
    entry_type: z.enum(ENTRY_TYPES).optional().default('journal'),
    content: z.string().min(1),
    tags: z.array(z.string()).optional(),
})

export const CreateEntrySchemaMcp = z.object({
    entry_type: z.string().optional().default('journal'),
    content: z.string().min(1),
    tags: z.array(z.string()).optional(),
})

export const CreateEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        id: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const CreateEntryMinimalSchema = z.object({
    content: z.string().min(1),
})

export const CreateEntryMinimalSchemaMcp = z.object({
    content: z.string().min(1),
})

export const GetEntryByIdSchema = z.object({
    id: z.number(),
})

export const GetEntryByIdSchemaMcp = z.object({
    id: relaxedNumber().describe('The numeric ID of the entry to retrieve'),
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
})

export const GetRecentEntriesSchemaMcp = z.object({
    limit: relaxedNumber()
        .optional()
        .default(10)
        .describe(`Maximum entries to return (max ${String(MAX_SEARCH_LIMIT)})`),
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
        tags: z.array(z.string()).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TestSimpleSchema = z.object({
    echo: z.string(),
})

export const TestSimpleOutputSchema = z
    .object({
        message: z.string().optional(),
        timestamp: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
