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
    StrictProjectNumberSchema,
    healAgentHallucinations,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'

const WORKSPACE_DESC =
    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
const SORT_BY_DESC = 'Sort results by timestamp (default) or importance score'
const TEAM_RELATION_TYPES = [
    'evolves_from', 'references', 'implements', 'clarifies', 'response_to',
    'blocked_by', 'resolved', 'caused', 'relates_to', 'depends_on',
] as const

export const TeamEntryOutputSchema = EntryOutputSchema.extend({
    author: z.string().nullable().optional(),
})

/** team_create_entry — strict */
export const TeamCreateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            content: z.string().min(1).max(MAX_CONTENT_LENGTH),
            entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
            tags: z.array(z.string()).optional().default([]),
            significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
            project_number: StrictProjectNumberSchema.optional(),
            workspace_id: z.string().min(1, 'workspace_id (repository name) is required'),
            project_owner: z.string().optional(),
            issue_number: z.number().optional(),
            issue_url: z.string().optional(),
            pr_number: z.number().optional(),
            pr_url: z.string().optional(),
            pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
            workflow_run_id: z.number().optional(),
            workflow_name: z.string().optional(),
            workflow_status: z.enum(['queued', 'in_progress', 'completed']).optional(),
            author: z.string().optional(),
            auto_context: z.string().optional(),
            impact_score: z.number().min(0).max(1).optional(),
            trust_score: z.number().min(0).max(1).optional(),
            validation_status: z.enum(['passed', 'none', 'failed']).optional(),
            session_id: z.string().optional(),
            relationships: z
                .array(
                    z.object({
                        targetId: z.number(),
                        relationType: z.enum(TEAM_RELATION_TYPES).optional().default('references'),
                    })
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
                    const ac = JSON.parse(data.auto_context || '{}') as Record<string, unknown>
                    const commits = ac !== null && typeof ac === 'object' ? ac['commits'] : undefined
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
                    'REQUIRED. The repository name (e.g. adamic). Do not use numeric project IDs or "workspace" as the key.'
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
            relationships: z
                .array(
                    z.object({
                        targetId: relaxedNumber(),
                        relationType: z.string().optional().default('references'),
                    })
                )
                .optional()
                .describe(
                    'Optional array of links to previous entries/flags to establish relationships immediately upon creation. Types: "resolves", "depends_on", "implements", "relates_to", "references", "evolves_from"'
                ),
        })
        .strict()
)

/** team_get_recent — strict */
export const TeamGetRecentSchema = z.object({
    limit: z.number().min(1).max(500).optional().default(10),
    cursor: z.string().optional().describe('Cursor for pagination'),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
    sort_by: z.enum(['timestamp', 'importance']).optional().default('timestamp').describe(SORT_BY_DESC),
    include_archived: z.boolean().optional().default(false),
})

/** team_get_recent — relaxed */
export const TeamGetRecentSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(10),
    cursor: z.string().optional().describe('Cursor for pagination'),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe(WORKSPACE_DESC),
    sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
    include_archived: z.boolean().optional().default(false),
})

function preprocessTeamSearchQuery(val: unknown): unknown {
    const healed = healAgentHallucinations(val)
    if (typeof healed === 'object' && healed !== null) {
        const obj = { ...(healed as Record<string, unknown>) }
        let modified = false
        for (const key of ['q', 'text', 'message', 'description', 'keep', 'path', 'mode', 'content']) {
            if (key in obj && !('query' in obj)) {
                obj['query'] = obj[key]
                Reflect.deleteProperty(obj, key)
                modified = true
                break
            }
        }
        return modified ? obj : healed
    }
    return healed
}

/** team_search — strict */
export const TeamSearchSchema = z.preprocess(
    preprocessTeamSearchQuery,
    z.object({
        query: z.string().optional(),
        cursor: z.string().optional().describe('Cursor for pagination'),
        tags: z.array(z.string()).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().optional(),
        limit: z.number().max(500).optional().default(10),
        sort_by: z.enum(['timestamp', 'importance']).optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false),
        fuzzy_match: z.boolean().optional().default(false),
        auto_correct: z.boolean().optional().default(false),
    })
)

/** team_search — relaxed */
export const TeamSearchSchemaMcp = z.preprocess(
    preprocessTeamSearchQuery,
    z.object({
        query: z.string().optional(),
        cursor: z.string().optional().describe('Cursor for pagination'),
        tags: z.array(z.string()).optional(),
        project_number: relaxedNumber().optional(),
        workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        limit: relaxedNumber().optional().default(10),
        sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false),
        fuzzy_match: z.boolean().optional().default(false),
        auto_correct: z.boolean().optional().default(false),
    })
)

/** team_list_deleted_entries — strict */
export const TeamListDeletedEntriesSchema = z.object({
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
})

/** team_list_deleted_entries — relaxed */
export const TeamListDeletedEntriesSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(50),
    offset: relaxedNumber().optional().default(0),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe(WORKSPACE_DESC),
})

/** team_get_entry_by_id — strict */
export const TeamGetEntryByIdSchema = z.object({
    entry_id: z.number().int(),
    include_relationships: z.boolean().optional().default(true),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
})

/** team_get_entry_by_id — relaxed */
export const TeamGetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    include_relationships: z.boolean().optional().default(true),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe(WORKSPACE_DESC),
})

function preprocessDateRange(val: unknown): unknown {
    const healed = healAgentHallucinations(val)
    if (typeof healed === 'object' && healed !== null) {
        const obj = { ...(healed as Record<string, unknown>) }
        let modified = false
        if ('start' in obj && !('start_date' in obj)) {
            obj['start_date'] = obj['start']
            Reflect.deleteProperty(obj, 'start')
            modified = true
        }
        if ('end' in obj && !('end_date' in obj)) {
            obj['end_date'] = obj['end']
            Reflect.deleteProperty(obj, 'end')
            modified = true
        }
        return modified ? obj : healed
    }
    return healed
}

/** team_search_by_date_range — strict */
export const TeamSearchByDateRangeSchema = z.preprocess(
    preprocessDateRange,
    z.object({
        start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
        end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
        cursor: z.string().optional().describe('Cursor for pagination'),
        entry_type: z.enum(ENTRY_TYPES).optional(),
        tags: z.array(z.string()).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().optional(),
        limit: z.number().max(500).optional().default(50),
        sort_by: z.enum(['timestamp', 'importance']).optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false),
    })
)

/** team_search_by_date_range — relaxed */
export const TeamSearchByDateRangeSchemaMcp = z.preprocess(
    preprocessDateRange,
    z.object({
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
        cursor: z.string().optional().describe('Cursor for pagination'),
        entry_type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        project_number: relaxedNumber().optional(),
        workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        limit: relaxedNumber().optional().default(50),
        sort_by: z.string().optional().default('timestamp').describe(SORT_BY_DESC),
        include_archived: z.boolean().optional().default(false),
    })
)

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
        next_cursor: z.string().optional().describe('Cursor for the next page of results'),
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
