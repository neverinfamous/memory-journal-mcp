/**
 * Shared Zod Schemas for Tool Handlers
 *
 * Contains cross-group schemas used by multiple tool modules:
 * - EntryOutputSchema: used by core, search, export, admin
 * - EntriesListOutputSchema: used by search, core
 * - RelationshipOutputSchema: used by core, relationships
 * - TagOutputSchema: used by core, analytics
 * - ImportanceBreakdownSchema: used by core
 * - Shared constants: ENTRY_TYPES, SIGNIFICANCE_TYPES, DATE_FORMAT_REGEX
 *
 * Group-specific output schemas stay colocated with their group files.
 */

import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// ============================================================================
// Shared Constants
// ============================================================================

/**
 * Valid entry types (matches EntryType union in types/index.ts)
 */
export const ENTRY_TYPES = [
    'personal_reflection',
    'project_decision',
    'technical_achievement',
    'bug_fix',
    'feature_implementation',
    'code_review',
    'meeting_notes',
    'learning',
    'research',
    'planning',
    'retrospective',
    'standup',
    'technical_note',
    'development_note',
    'enhancement',
    'milestone',
    'flag',
    'system_integration_test',
    'test_entry',
    'other',
] as const

/**
 * Valid significance types (matches SignificanceType union in types/index.ts)
 */
export const SIGNIFICANCE_TYPES = [
    'milestone',
    'breakthrough',
    'technical_breakthrough',
    'decision',
    'lesson_learned',
    'blocker_resolved',
    'release',
] as const

/** Maximum content length for journal entries (chars) */
export const MAX_CONTENT_LENGTH = 50_000

/** Maximum entries returned by any single search query */
export const MAX_QUERY_LIMIT = 500

/** Date sentinels for "all time" date range queries */
export const DATE_MIN_SENTINEL = '1970-01-01'
export const DATE_MAX_SENTINEL = '2999-12-31'

/** YYYY-MM-DD date format regex */
export const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const DATE_FORMAT_MESSAGE = 'Date must be YYYY-MM-DD format'

/**
 * Relaxed numeric schema for MCP SDK inputSchema registration.
 *
 * Uses `z.union([z.number(), z.string()])` so the SDK's Zod validation
 * accepts both native numbers and string-typed numbers (e.g., `"42"`).
 * The handler's strict schema (`z.number()`) then validates and coerces
 * the value, producing structured `{success: false, error}` responses
 * via `formatHandlerError()` for invalid input.
 *
 * NOTE: `z.preprocess()` was attempted but its `ZodEffects` return type
 * is too complex for ESLint's strict type resolver, causing cascading
 * `@typescript-eslint/no-unsafe-*` errors across all call sites.
 */
export const relaxedNumber = (): z.ZodUnion<[z.ZodNumber, z.ZodString]> =>
    z.union([z.number(), z.string()])

// ============================================================================
// Cross-Group Output Schemas
// ============================================================================

/**
 * Schema for a journal entry in output responses.
 * Uses camelCase to match actual database output format.
 */
export const EntryOutputSchema = z
    .object({
        id: z.number(),
        content: z.string(),
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
        projectNumber: z.number().nullable().optional(),
        projectOwner: z.string().nullable().optional(),
        issueNumber: z.number().nullable().optional(),
        issueUrl: z.string().nullable().optional(),
        prNumber: z.number().nullable().optional(),
        prUrl: z.string().nullable().optional(),
        prStatus: z.string().nullable().optional(),
        workflowRunId: z.number().nullable().optional(),
        workflowName: z.string().nullable().optional(),
        workflowStatus: z.string().nullable().optional(),
        source: z.enum(['personal', 'team']).optional(),
        importanceScore: z
            .number()
            .optional()
            .describe('Importance score (0.0-1.0), present when sort_by=importance'),
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
