/**
 * Cross-Group Output Schemas for Tool Handlers
 */

import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { MAX_CONTENT_LENGTH } from './constants-and-primitives.js'

export const BatchResultOutputSchema = z
    .object({
        success: z.boolean().optional(),
        count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a journal entry in output responses.
 * Uses camelCase to match actual database output format.
 */
export const EntryOutputSchema = z
    .object({
        id: z.number(),
        content: z.string().max(MAX_CONTENT_LENGTH),
        entryType: z.string(),
        isPersonal: z.boolean(),
        timestamp: z.string(),
        tags: z.array(z.string()).optional(),
        significanceType: z.string().nullable().optional(),
        autoContext: z
            .string()
            .nullable()
            .optional()
            .describe('@deprecated Use author and flagMetadata instead'),
        author: z.string().nullable().optional(),
        flagMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
        deletedAt: z.string().nullable().optional(),
        isArchived: z.boolean().optional(),
        projectNumber: z.number().nullable().optional(),
        projectName: z
            .string()
            .optional()
            .describe('Injected repository or project name resolved from projectRegistry'),
        projectOwner: z.string().nullable().optional(),
        issueNumber: z.number().nullable().optional(),
        issueUrl: z.string().nullable().optional(),
        prNumber: z.number().nullable().optional(),
        prUrl: z.string().nullable().optional(),
        prStatus: z.string().nullable().optional(),
        workflowRunId: z.number().nullable().optional(),
        workflowName: z.string().nullable().optional(),
        workflowStatus: z.string().nullable().optional(),
        workspaceId: z.string().optional().describe('Workspace isolation identifier'),
        source: z.enum(['personal', 'team']).optional(),
        importanceScore: z
            .number()
            .optional()
            .describe('Importance score (0.0-1.0), present when sort_by=importance'),
        trustScore: z.number().optional(),
        impactScore: z.number().optional(),
        validationStatus: z.string().optional(),
        version: z.number().optional(),
        sessionId: z.string().nullable().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for list of entries with count.
 * Used by get_recent_entries, search_entries, search_by_date_range.
 */
export const EntriesListOutputSchema = z
    .object({
        entries: z.array(EntryOutputSchema).optional(),
        count: z.number().optional(),
        searchMode: z.string().optional(),
        degraded: z
            .boolean()
            .optional()
            .describe(
                'True if the search degraded to a slower fallback method due to infrastructure failure'
            ),
        next_cursor: z.string().optional().describe('Cursor for the next page of results'),
        highlights: z
            .array(z.object({ id: z.number(), snippet: z.string() }))
            .optional()
            .describe('FTS5 search snippets when include_highlights is true'),
        facets: z
            .object({
                tags: z.array(z.object({ name: z.string(), count: z.number() })),
                entryTypes: z.array(z.object({ name: z.string(), count: z.number() })),
            })
            .optional()
            .describe('Distribution counts when include_facets is true'),
        suggestions: z
            .array(z.string())
            .optional()
            .describe('Fuzzy matches when fuzzy_match=true and no exact results were found'),
        correctedQuery: z
            .string()
            .optional()
            .describe('The corrected query when auto_correct=true and a confident match was found'),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a single entry revision (snapshot).
 */
export const EntryRevisionOutputSchema = z
    .object({
        id: z.number(),
        entryId: z.number(),
        revisionNumber: z.number(),
        contentSnapshot: z.string(),
        changedAt: z.string(),
        changedBy: z.string().nullable().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a list of entry revisions.
 */
export const EntryHistoryListOutputSchema = z
    .object({
        revisions: z.array(EntryRevisionOutputSchema).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a relationship between entries.
 */
export const RelationshipOutputSchema = z
    .object({
        id: z.number(),
        fromEntryId: z.number(),
        toEntryId: z.number(),
        relationshipType: z.string(),
        description: z.string().nullable().optional(),
        createdAt: z.string(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Importance score breakdown schema.
 */
export const ImportanceBreakdownSchema = z.object({
    significance: z.number(),
    relationships: z.number(),
    causal: z.number(),
    recency: z.number(),
})

/**
 * Tag with usage count.
 */
export const TagOutputSchema = z
    .object({
        name: z.string(),
        count: z.number().nullable(),
    })
    .extend(ErrorFieldsMixin.shape)
