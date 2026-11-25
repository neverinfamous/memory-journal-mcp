import { z } from 'zod'
import {
    preprocessTeamSortByOnly,
    preprocessTeamSearchQuery,
    preprocessDateRange,
} from './search-preprocessors.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    MAX_CONTENT_LENGTH,
    MAX_QUERY_LIMIT,
    coerceFiniteNumberString,
    coerceIntString,
    relaxedNumber,
    DATE_FORMAT_MESSAGE,
    isValidCalendarDate,
    StrictProjectNumberSchema,
    healAgentHallucinations,
    preprocessRelationshipItem,
    relationshipTypeEnumError,
} from '../../schemas.js'
import {
    TeamEntryOutputSchema,
    TeamCreateOutputSchema,
    TeamEntriesListOutputSchema,
    TeamEntryDetailOutputSchema,
    TeamTagsListOutputSchema,
} from './core-search-output-schemas.js'
import { isRecord } from '../../../../utils/type-guards.js'

export {
    TeamEntryOutputSchema,
    TeamCreateOutputSchema,
    TeamEntriesListOutputSchema,
    TeamEntryDetailOutputSchema,
    TeamTagsListOutputSchema,
}

const WORKSPACE_DESC =
    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
const SORT_BY_DESC = 'Sort results by timestamp (default) or importance score'
const TEAM_RELATION_TYPES = [
    'evolves_from', 'references', 'implements', 'clarifies', 'response_to',
    'blocked_by', 'resolved', 'caused', 'resolves', 'relates_to', 'depends_on',
] as const

/** team_create_entry — strict */
export const TeamCreateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            content: z.string().min(1).max(MAX_CONTENT_LENGTH),
            entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
            tags: z.array(z.string()).optional().default([]),
            significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
            project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
            workspace_id: z.string().min(1, 'workspace_id (repository name) is required').max(255).optional(),
            project_owner: z.string().optional(),
            issue_number: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            issue_url: z.string().optional(),
            pr_number: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            pr_url: z.string().optional(),
            pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
            workflow_run_id: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            workflow_name: z.string().optional(),
            workflow_status: z.enum(['queued', 'in_progress', 'completed']).optional(),
            author: z.string().max(100).optional(),
            auto_link: z.boolean().optional(),
            auto_context: z.string().optional(),
            impact_score: z.preprocess(coerceFiniteNumberString, z.number().min(0).max(1)).optional(),
            trust_score: z.preprocess(coerceFiniteNumberString, z.number().min(0).max(1)).optional(),
            validation_status: z.enum(['passed', 'none', 'failed']).optional(),
            session_id: z.string().max(255).optional(),
            anchors: z
                .array(
                    z
                        .object({
                            anchor_path: z.string().max(500),
                            anchor_type: z.string().max(64),
                            status: z
                                .enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable'])
                                .optional()
                                .default('pending'),
                        })
                        .strict()
                )
                .max(100)
                .optional(),
            relationships: z
                .array(
                    z.preprocess(
                        preprocessRelationshipItem,
                        z.object({
                            targetId: z.number().int().positive(),
                            relationType: z
                                .enum(TEAM_RELATION_TYPES, { error: relationshipTypeEnumError })
                                .optional()
                                .default('references'),
                        })
                    )
                )
                .optional(),
        })
        .strict()
        .superRefine((data, ctx) => {
            if (data.tags?.includes('session-summary')) {
                const c = data.content ?? ''
                if (
                    !/#+\s+Accomplished/i.test(c) ||
                    !/#+\s+Unfinished \/ Blocked/i.test(c) ||
                    !/#+\s+Context for Next Session/i.test(c) ||
                    !/#+\s+Commits/i.test(c)
                ) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['content'],
                        message:
                            '[ANTI-HALLUCINATION] Session summaries MUST contain exactly these 4 exact headers: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. Please correct the structure. Do not add or remove any top-level headers. You must rewrite the entire content field conforming to this exact structure.',
                    })
                }
                const countHeaders = (regex: RegExp): number => (c.match(regex) ?? []).length
                if (
                    countHeaders(/#+\s+Accomplished/gi) > 1 ||
                    countHeaders(/#+\s+Unfinished \/ Blocked/gi) > 1 ||
                    countHeaders(/#+\s+Context for Next Session/gi) > 1 ||
                    countHeaders(/#+\s+Commits/gi) > 1
                ) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['content'],
                        message:
                            '[ANTI-HALLUCINATION] Session summaries must NOT contain duplicate section headers. Each of the 4 required headers must appear EXACTLY ONCE.',
                    })
                }
            }
            if (
                data.tags?.includes('commit-narrative') ||
                (data.tags?.includes('session-summary') && data.auto_context)
            ) {
                try {
                    const ac: unknown = JSON.parse(data.auto_context || '{}')
                    const commits = isRecord(ac) ? ac['commits'] : undefined
                    if (!Array.isArray(commits) || commits.length === 0) {
                        ctx.addIssue({
                            code: 'custom',
                            path: ['auto_context'],
                            message: [
                                "[ANTI-HALLUCINATION] Entries tagged 'commit-narrative' or 'session-summary' (when providing auto_context) MUST include an auto_context with a non-empty 'commits' array.",
                                'In Code Mode, pass it as a plain object: { "commits": ["<sha>"] }',
                                'or as a pre-stringified JSON string: JSON.stringify({ "commits": ["<sha>"] }).',
                                'Example: await mj.team.team_create_entry({ ..., auto_context: { "commits": ["abc1234"] } })',
                            ].join(' '),
                        })
                    }
                } catch {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['auto_context'],
                        message:
                            '[ANTI-HALLUCINATION] auto_context must be a valid JSON string or plain object for commit narratives. Example: { "commits": ["<sha>"] }',
                    })
                }
            }
        })
)

/** team_create_entry — relaxed for MCP SDK */
export const TeamCreateEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            content: z
                .string()
                .optional()
                .describe(
                    'Markdown-formatted entry content. Use ## section headers to organize content. ' +
                        'Note: The primary text is stored in the `content` property (not `entry`, `title`, `message`, `name`, `description`, or `text`). ' +
                        'For session summaries (entry_type: "retrospective", tagged "session-summary"), ' +
                        'MUST use EXACTLY: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
                        'Do NOT invent extra top-level sections for session summaries.'
                ),
            entry_type: z
                .string()
                .optional()
                .default('personal_reflection')
                .describe(
                    'Entry type. Use "retrospective" for session summaries, "bug_fix" for bugs, ' +
                        '"feature_implementation" for features, "planning" for roadmaps, ' +
                        '"technical_note" for implementation notes. Do NOT default to "personal_reflection" ' +
                        'unless the entry is genuinely a personal note.'
                ),
            tags: z
                .array(z.string())
                .optional()
                .default([])
                .describe(
                    'Tags for categorization (kebab-case). Session summaries MUST include "session-summary". DO NOT hallucinate fake tags. Only use tags that genuinely match the content or existing repository vocabulary, domain tags (e.g., "security", "performance") and activity tags (e.g., "refactor", "audit"). ' +
                        '[ANTI-HALLUCINATION] MUST be an array of strings, e.g. ["tag1", "tag2"]. NEVER pass a single string.'
                ),
            significance_type: z.string().optional(),
            project_number: relaxedNumber()
                .optional()
                .describe(
                    'Numeric project ID (e.g., 1, 14). This is now optional; workspace_id is preferred.'
                ),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'REQUIRED. The repository name (e.g. "my-repo"). Do not use numeric project IDs or "workspace" as the key.'
                ),
            project_owner: z.string().optional().describe('Owner of the project/task.'),
            issue_number: relaxedNumber().optional(),
            issue_url: z.string().optional(),
            pr_number: relaxedNumber().optional(),
            pr_url: z.string().optional(),
            pr_status: z.string().optional(),
            workflow_run_id: relaxedNumber().optional(),
            workflow_name: z.string().optional(),
            workflow_status: z.string().optional(),
            author: z.string().optional().describe('Override author name (default: auto-detected)'),
            auto_link: z
                .boolean()
                .optional()
                .describe('Compatibility option accepted for parity with create_entry / CLI --auto-link.'),
            auto_context: z.string().optional(),
            impact_score: relaxedNumber()
                .optional()
                .describe(
                    'Heuristic score (0.0-1.0) indicating blast radius (0.9+ for core architecture, 0.1 for simple docs).'
                ),
            trust_score: relaxedNumber()
                .optional()
                .describe(
                    'Heuristic score (0.0-1.0) indicating confidence (0.3-0.5 for unverified, 0.9+ for verified).'
                ),
            validation_status: z
                .string()
                .optional()
                .describe('Current validation status of the entry (passed, none, failed).'),
            session_id: z
                .string()
                .optional()
                .describe('Agent session ID for thread isolation (usually conversation ID).'),
            anchors: z
                .array(
                    z.object({
                        anchor_path: z.string(),
                        anchor_type: z.string(),
                        status: z.string().optional().default('pending'),
                    })
                )
                .optional()
                .describe('Files or lines of code that this entry is anchored to.'),
            relationships: z
                .array(
                    z.preprocess(
                        preprocessRelationshipItem,
                        z.object({
                            targetId: relaxedNumber(),
                            relationType: z.string().optional().default('references'),
                        })
                    )
                )
                .optional()
                .describe(
                    'Optional array of `{ targetId, relationType }` links to previous entries. Canonical types: "evolves_from", "references", "implements", "clarifies", "response_to", "blocked_by", "resolved", "caused"'
                ),
        })
        .strict()
)

/** team_get_recent — strict */
export const TeamGetRecentSchema = z.preprocess(
    preprocessTeamSortByOnly,
    z
        .object({
            limit: z.preprocess(coerceIntString, z.number().int().min(1).max(500)).optional().default(10),
            cursor: z.string().optional().describe('Cursor for pagination'),
            offset: z.preprocess(coerceIntString, z.number().int().min(0)).optional().default(0),
            project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
            workspace_id: z.string().max(255).optional(),
            sort_by: z.enum(['timestamp', 'importance', 'blended']).optional().default('timestamp').describe(SORT_BY_DESC),
            include_archived: z.boolean().optional().default(false),
        })
        .strict()
        .superRefine((data, ctx) => {
            if (data.cursor !== undefined && /^(?:0|[1-9]\d*)$/.test(data.cursor.trim())) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'Conflicting cursor and offset values specified',
                    path: ['cursor'],
                })
            }
        })
)

/** team_get_recent — relaxed */
export const TeamGetRecentSchemaMcp = z.preprocess(
    preprocessTeamSortByOnly,
    z.object({
        limit: relaxedNumber().optional().default(10).describe('Maximum entries to return (1-500, default: 10)'),
        cursor: z.string().optional().describe('Cursor for pagination'),
        offset: relaxedNumber().optional().default(0).describe('Zero-based offset for pagination (used when cursor is not provided)'),
        project_number: relaxedNumber().optional().describe('REQUIRED: project number to scope the query to.'),
        workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false).describe('Include archived entries in results'),
    })
)

/** team_search — strict */
export const TeamSearchSchema = z.preprocess(
    preprocessTeamSearchQuery,
    z
        .object({
            query: z.string().max(500).optional(),
            cursor: z.string().optional().describe('Cursor for pagination'),
            tags: z.array(z.string()).optional(),
            exclude_tags: z.array(z.string()).optional().describe('Exclude entries having any of these tags'),
            entry_type: z.enum(ENTRY_TYPES).optional(),
            project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
            workspace_id: z.string().max(255).optional(),
            limit: z.preprocess(coerceIntString, z.number().int().min(1).max(500)).optional().default(10),
            sort_by: z.enum(['timestamp', 'importance', 'blended']).optional().default('timestamp').describe(SORT_BY_DESC),
            include_archived: z.boolean().optional().default(false),
            fuzzy_match: z.boolean().optional().default(false),
            auto_correct: z.boolean().optional().default(false),
        })
        .strict()
)

/** team_search — relaxed */
export const TeamSearchSchemaMcp = z.preprocess(
    preprocessTeamSearchQuery,
    z.object({
        query: z.string().optional().describe('Search text query (use `query`, not `q`)'),
        cursor: z.string().optional().describe('Cursor for pagination'),
        tags: z.array(z.string()).optional().describe('Filter entries having any of these tags'),
        exclude_tags: z.array(z.string()).optional().describe('Exclude entries having any of these tags'),
        entry_type: z.string().optional().describe('Filter results by entry type'),
        project_number: relaxedNumber().optional().describe('REQUIRED: project number to scope the query to.'),
        workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        limit: relaxedNumber().optional().default(10).describe('Maximum entries to return (1-500, default: 10)'),
        sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false).describe('Include archived entries in results'),
        fuzzy_match: z.boolean().optional().default(false).describe('Return typo-tolerant suggestions when no exact matches are found'),
        auto_correct: z.boolean().optional().default(false).describe('Automatically re-run search with top suggestion when distance <= 1'),
    })
)

/** team_list_deleted_entries — strict */
export const TeamListDeletedEntriesSchema = z
    .object({
        limit: z.preprocess(coerceIntString, z.number().int().min(1).max(MAX_QUERY_LIMIT)).optional().default(50),
        offset: z.preprocess(coerceIntString, z.number().int().min(0)).optional().default(0),
        project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

/** team_list_deleted_entries — relaxed */
export const TeamListDeletedEntriesSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(50).describe('Maximum deleted entries to return (min: 1, default: 50)'),
    offset: relaxedNumber().optional().default(0).describe('Pagination offset (min: 0, default: 0)'),
    project_number: relaxedNumber().optional().describe('REQUIRED: project number to scope the query to.'),
    workspace_id: z.string().optional().describe(WORKSPACE_DESC),
})

/** team_get_entry_by_id — strict */
export const TeamGetEntryByIdSchema = z
    .object({
        entry_id: z.preprocess(coerceIntString, z.number().int().positive()),
        include_relationships: z.boolean().optional().default(true),
        project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

/** team_get_entry_by_id — relaxed */
export const TeamGetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().optional().describe('Team entry ID to retrieve'),
    include_relationships: z.boolean().optional().default(true).describe('Include linked relationships in response'),
    project_number: relaxedNumber().optional().describe('REQUIRED: project number to scope the query to.'),
    workspace_id: z.string().optional().describe(WORKSPACE_DESC),
})

/** team_search_by_date_range — strict */
export const TeamSearchByDateRangeSchema = z.preprocess(
    preprocessDateRange,
    z
        .object({
            start_date: z.string().refine(isValidCalendarDate, DATE_FORMAT_MESSAGE),
            end_date: z.string().refine(isValidCalendarDate, DATE_FORMAT_MESSAGE),
            cursor: z.string().optional().describe('Cursor for pagination'),
            entry_type: z.enum(ENTRY_TYPES).optional(),
            tags: z.array(z.string()).optional(),
            exclude_tags: z.array(z.string()).optional().describe('Exclude entries having any of these tags'),
            project_number: z.preprocess(coerceIntString, StrictProjectNumberSchema).optional(),
            workspace_id: z.string().max(255).optional(),
            limit: z.preprocess(coerceIntString, z.number().int().min(1).max(500)).optional().default(50),
            sort_by: z.enum(['timestamp', 'importance', 'blended']).optional().default('timestamp').describe(SORT_BY_DESC),
            include_archived: z.boolean().optional().default(false),
        })
        .strict()
)

/** team_search_by_date_range — relaxed */
export const TeamSearchByDateRangeSchemaMcp = z.preprocess(
    preprocessDateRange,
    z
        .object({
            start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
            end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
            cursor: z.string().optional().describe('Cursor for pagination'),
            entry_type: z.string().optional().describe('Filter results by entry type'),
            tags: z.array(z.string()).optional().describe('Filter entries having any of these tags'),
            exclude_tags: z.array(z.string()).optional().describe('Exclude entries having any of these tags'),
            project_number: relaxedNumber().optional().describe('REQUIRED: project number to scope the query to.'),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
            limit: relaxedNumber().optional().default(50).describe('Maximum entries to return (1-500, default: 50)'),
            sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
            include_archived: z.boolean().optional().default(false).describe('Include archived entries in results'),
        })
        .loose()
)
