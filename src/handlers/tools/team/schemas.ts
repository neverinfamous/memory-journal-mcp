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
    StrictProjectNumberSchema,
    MAX_BATCH_SIZE,
    BatchResultOutputSchema,
    healAgentHallucinations,
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
export const TeamCreateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        content: z.string().min(1).max(MAX_CONTENT_LENGTH),
        entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
        tags: z.array(z.string()).optional().default([]),
        significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
        project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
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
        relationships: z.array(z.object({
            targetId: z.number(),
            relationType: z.enum([
                'evolves_from',
                'references',
                'implements',
                'clarifies',
                'response_to',
                'blocked_by',
                'resolved',
                'caused',
                'relates_to',
                'depends_on'
            ]).optional().default('references')
        })).optional(),
    }).strict().superRefine((data, ctx) => {
        if (data.tags?.includes('session-summary')) {
            const c = data.content ?? '';
            if (!/#+\s+Accomplished/i.test(c) || !/#+\s+Unfinished \/ Blocked/i.test(c) || !/#+\s+Context for Next Session/i.test(c) || !/#+\s+Commits/i.test(c)) {
                ctx.addIssue({
                    code: "custom",
                    path: ['content'],
                    message: "[ANTI-HALLUCINATION] Session summaries MUST contain exactly these 4 exact headers: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. Please correct the structure. Do not add or remove any top-level headers. You must rewrite the entire content field conforming to this exact structure.",
                });
            }
            const countHeaders = (regex: RegExp): number => (c.match(regex) ?? []).length;
            if (countHeaders(/#+\s+Accomplished/gi) > 1 || countHeaders(/#+\s+Unfinished \/ Blocked/gi) > 1 || countHeaders(/#+\s+Context for Next Session/gi) > 1 || countHeaders(/#+\s+Commits/gi) > 1) {
                ctx.addIssue({
                    code: "custom",
                    path: ['content'],
                    message: "[ANTI-HALLUCINATION] Session summaries must NOT contain duplicate section headers. Each of the 4 required headers must appear EXACTLY ONCE.",
                });
            }
        }
        if (data.tags?.includes('commit-narrative') || (data.tags?.includes('session-summary') && data.auto_context)) {
            try {
                const ac = JSON.parse(data.auto_context || '{}') as Record<string, unknown>;
                const commits = ac !== null && typeof ac === 'object' ? ac['commits'] : undefined;
                if (!Array.isArray(commits) || commits.length === 0) {
                    ctx.addIssue({
                        code: "custom",
                        path: ['auto_context'],
                        message: [
                            "[ANTI-HALLUCINATION] Entries tagged 'commit-narrative' or 'session-summary' (when providing auto_context) MUST include an auto_context with a non-empty 'commits' array.",
                            "In Code Mode, pass it as a plain object: { \"commits\": [\"<sha>\"] }",
                            "or as a pre-stringified JSON string: JSON.stringify({ \"commits\": [\"<sha>\"] }).",
                            "Example: await mj.team.team_create_entry({ ..., auto_context: { \"commits\": [\"abc1234\"] } })",
                        ].join(' '),
                    });
                }
            } catch {
                ctx.addIssue({
                    code: "custom",
                    path: ['auto_context'],
                    message: "[ANTI-HALLUCINATION] auto_context must be a valid JSON string or plain object for commit narratives. Example: { \"commits\": [\"<sha>\"] }",
                });
            }
        }
    })
)

/** team_create_entry — relaxed for MCP SDK */
export const TeamCreateEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        content: z.string().optional().describe(
            'Markdown-formatted entry content. Use ## section headers to organize content. ' +
            'Note: The primary text is stored in the `content` property (not `title` or `message`). ' +
            'For session summaries (entry_type: "retrospective", tagged "session-summary"), ' +
            'MUST use EXACTLY: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
            'Do NOT invent extra top-level sections for session summaries.'
        ),
        entry_type: z.string().optional().default('personal_reflection').describe(
            'Entry type. Use "retrospective" for session summaries, "bug_fix" for bugs, ' +
            '"feature_implementation" for features, "planning" for roadmaps, ' +
            '"technical_note" for implementation notes. Do NOT default to "personal_reflection" ' +
            'unless the entry is genuinely a personal note.'
        ),
        tags: z.array(z.string()).optional().default([]).describe(
            'Tags for categorization (kebab-case). Session summaries MUST include "session-summary". DO NOT hallucinate fake tags. Only use tags that genuinely match the content or existing repository vocabulary, domain tags (e.g., "security", "performance") and activity tags (e.g., "refactor", "audit"). ' +
            '[ANTI-HALLUCINATION] MUST be an array of strings, e.g. ["tag1", "tag2"]. NEVER pass a single string.'
        ),
        significance_type: z.string().optional(),
        project_number: relaxedNumber().optional().describe('REQUIRED. Numeric project ID (e.g., 1, 14). Find it by querying memory://agent-id or use get_statistics. Do NOT pass a repo name string.'),
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
        impact_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating blast radius (0.9+ for core architecture, 0.1 for simple docs).'),
        trust_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating confidence (0.3-0.5 for unverified, 0.9+ for verified).'),
        validation_status: z.string().optional().describe('Current validation status of the entry (passed, none, failed).'),
        session_id: z.string().optional().describe('Agent session ID for thread isolation (usually conversation ID).'),
        relationships: z.array(z.object({
            targetId: relaxedNumber(),
            relationType: z.string().optional().default('references')
        })).optional().describe('Optional array of links to previous entries/flags to establish relationships immediately upon creation. Types: "resolves", "depends_on", "implements", "relates_to", "references", "evolves_from"'),
    }).strict()
)

/** team_get_recent — strict */
export const TeamGetRecentSchema = z.object({
    limit: z.number().min(1).max(500).optional().default(10),
    cursor: z.string().optional().describe('Cursor for pagination'),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
})

/** team_get_recent — relaxed */
export const TeamGetRecentSchemaMcp = z.object({
    limit: relaxedNumber().optional().default(10),
    cursor: z.string().optional().describe('Cursor for pagination'),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
})

/** team_search — strict */
export const TeamSearchSchema = z.preprocess(
    (val: unknown) => {
        const healed = healAgentHallucinations(val);
        if (typeof healed === 'object' && healed !== null) {
            const obj = { ...(healed as Record<string, unknown>) };
            let modified = false;
            for (const key of ['q', 'text', 'message', 'description', 'keep', 'path', 'mode', 'content']) {
                if (key in obj && !('query' in obj)) {
                    obj['query'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : healed;
        }
        return healed;
    },
    z.object({
    query: z.string().optional(),
    cursor: z.string().optional().describe('Cursor for pagination'),
    tags: z.array(z.string()).optional(),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
    limit: z.number().max(500).optional().default(10),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
    fuzzy_match: z.boolean().optional().default(false),
    auto_correct: z.boolean().optional().default(false),
}))

/** team_search — relaxed */
export const TeamSearchSchemaMcp = z.preprocess(
    (val: unknown) => {
        const healed = healAgentHallucinations(val);
        if (typeof healed === 'object' && healed !== null) {
            const obj = { ...(healed as Record<string, unknown>) };
            let modified = false;
            for (const key of ['q', 'text', 'message', 'description', 'keep', 'path', 'mode', 'content']) {
                if (key in obj && !('query' in obj)) {
                    obj['query'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : healed;
        }
        return healed;
    },
    z.object({
    query: z.string().optional(),
    cursor: z.string().optional().describe('Cursor for pagination'),
    tags: z.array(z.string()).optional(),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    limit: relaxedNumber().optional().default(10),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
    fuzzy_match: z.boolean().optional().default(false),
    auto_correct: z.boolean().optional().default(false),
}))

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
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

// ============================================================================
// Search Tool Schemas
// ============================================================================

/** team_search_by_date_range — strict */
export const TeamSearchByDateRangeSchema = z.preprocess(
    (val: unknown) => {
        const healed = healAgentHallucinations(val);
        if (typeof healed === 'object' && healed !== null) {
            const obj = { ...(healed as Record<string, unknown>) };
            let modified = false;
            if ('start' in obj && !('start_date' in obj)) {
                obj['start_date'] = obj['start'];
                Reflect.deleteProperty(obj, 'start');
                modified = true;
            }
            if ('end' in obj && !('end_date' in obj)) {
                obj['end_date'] = obj['end'];
                Reflect.deleteProperty(obj, 'end');
                modified = true;
            }
            return modified ? obj : healed;
        }
        return healed;
    },
    z.object({
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE),
    cursor: z.string().optional().describe('Cursor for pagination'),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
    limit: z.number().max(500).optional().default(50),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
}))

/** team_search_by_date_range — relaxed */
export const TeamSearchByDateRangeSchemaMcp = z.preprocess(
    (val: unknown) => {
        const healed = healAgentHallucinations(val);
        if (typeof healed === 'object' && healed !== null) {
            const obj = { ...(healed as Record<string, unknown>) };
            let modified = false;
            if ('start' in obj && !('start_date' in obj)) {
                obj['start_date'] = obj['start'];
                Reflect.deleteProperty(obj, 'start');
                modified = true;
            }
            if ('end' in obj && !('end_date' in obj)) {
                obj['end_date'] = obj['end'];
                Reflect.deleteProperty(obj, 'end');
                modified = true;
            }
            return modified ? obj : healed;
        }
        return healed;
    },
    z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    cursor: z.string().optional().describe('Cursor for pagination'),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    limit: relaxedNumber().optional().default(50),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_archived: z.boolean().optional().default(false),
}))

// ============================================================================
// Admin Tool Schemas
// ============================================================================

/** team_update_entry — strict */
export const TeamUpdateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: z.number(),
        content: z.string().min(1).max(MAX_CONTENT_LENGTH).optional().refine(
            (val) => {
                if (!val) return true;
                const trimmed = val.trim();
                const startsWithSection = /^##\s+(Context for Next Session|Unfinished \/ Blocked|Accomplished|Commits)/i.test(trimmed);
                const hasAccomplished = /#+\s+Accomplished/i.test(val);
                return !(startsWithSection && !hasAccomplished);
            },
            { message: "[ANTI-HALLUCINATION] Do not send partial updates. The `content` field fully overwrites the existing entry. You must retrieve the entry first, append your changes, and send the full Markdown content back." }
        ),
        entry_type: z.enum(ENTRY_TYPES).optional(),
        tags: z.array(z.string()).optional(),
        project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
        significance_type: z.enum(SIGNIFICANCE_TYPES).nullable().optional(),
        project_owner: z.string().nullable().optional(),
        issue_number: z.number().nullable().optional(),
        issue_url: z.string().nullable().optional(),
        pr_number: z.number().nullable().optional(),
        pr_url: z.string().nullable().optional(),
        pr_status: z.enum(['draft', 'open', 'merged', 'closed']).nullable().optional(),
        workflow_run_id: z.number().nullable().optional(),
        workflow_name: z.string().nullable().optional(),
        workflow_status: z.enum(['queued', 'in_progress', 'completed']).nullable().optional(),
        is_archived: z.boolean().optional(),
        expected_version: z.number().optional(),
        auto_context: z.string().nullable().optional(),
        impact_score: z.number().min(0).max(1).optional(),
        trust_score: z.number().min(0).max(1).optional(),
        validation_status: z.enum(['passed', 'none', 'failed']).optional(),
        session_id: z.string().optional(),
    }).strict()
)

/** team_update_entry — relaxed */
export const TeamUpdateEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: relaxedNumber().optional(),
        content: z.string().optional().describe(
            'Updated markdown content. Preserve the existing ## section header structure. ' +
            'For session summaries, keep the ## Accomplished / ## Unfinished / Blocked / ' +
            '## Context for Next Session / ## Commits structure intact. ' +
            'Do NOT restructure or add new top-level sections unless explicitly requested.'
        ),
        entry_type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
        significance_type: z.string().nullable().optional(),
        project_owner: z.string().nullable().optional(),
        issue_number: relaxedNumber().optional().nullable().optional(),
        issue_url: z.string().nullable().optional(),
        pr_number: relaxedNumber().optional().nullable().optional(),
        pr_url: z.string().nullable().optional(),
        pr_status: z.string().nullable().optional(),
        workflow_run_id: relaxedNumber().optional().nullable().optional(),
        workflow_name: z.string().nullable().optional(),
        workflow_status: z.string().nullable().optional(),
        is_archived: z.boolean().optional(),
        expected_version: relaxedNumber().optional(),
        auto_context: z.string().nullable().optional(),
        impact_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating blast radius (0.9+ for core architecture, 0.1 for simple docs).'),
        trust_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating confidence (0.3-0.5 for unverified, 0.9+ for verified).'),
        validation_status: z.string().optional().describe('Current validation status of the entry (passed, none, failed).'),
        session_id: z.string().optional().describe('Agent session ID for thread isolation (usually conversation ID).'),
    }).strict()
)

/** team_delete_entry — strict */
export const TeamDeleteEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: z.number(),
        project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
        expected_version: z.number().optional().describe('REQUIRED for concurrency safety'),
    }).strict()
)

/** team_delete_entry — relaxed */
export const TeamDeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: relaxedNumber().optional(),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
        expected_version: relaxedNumber().optional().describe('REQUIRED for safe deletion to prevent optimistic concurrency gaps. Get this from get_entry_by_id.'),
    }).strict()
)

/** team_restore_entry — strict */
export const TeamRestoreEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: z.number(),
        project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
    }).strict()
)

/** team_restore_entry — relaxed */
export const TeamRestoreEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_id: relaxedNumber().optional(),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    }).strict()
)

/** team_merge_tags — strict */
export const TeamMergeTagsSchema = z.object({
    source_tag: z.string().min(1),
    target_tag: z.string().min(1),
    workspace_id: z.string().optional(),
})

/** team_merge_tags — relaxed */
export const TeamMergeTagsSchemaMcp = z.object({
    source_tag: z.string().optional(),
    target_tag: z.string().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

// Team Batch Schemas

export const TeamBatchCreateEntriesSchema = z.object({
    entries: z.array(TeamCreateEntrySchema).min(1).max(MAX_BATCH_SIZE),
    auto_index: z.boolean().optional().default(true),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
})

export const TeamBatchCreateEntriesSchemaMcp = z.object({
    entries: z.array(TeamCreateEntrySchemaMcp).optional(),
    auto_index: z.boolean().optional().default(true),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

export const TeamBatchUpdateEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
                Reflect.deleteProperty(obj, 'items');
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
                Reflect.deleteProperty(obj, 'entries');
            }
            if (Array.isArray(updatesArr)) {
                const newUpdates = updatesArr.map((u: unknown) => {
                    if (typeof u === 'object' && u !== null) {
                        const uObj = { ...(u as Record<string, unknown>) };
                        if ('id' in uObj && !('entry_id' in uObj)) {
                            uObj['entry_id'] = uObj['id'];
                            delete uObj['id'];
                        }
                        return uObj;
                    }
                    return u;
                });
                return { ...obj, updates: newUpdates };
            }
        }
        return val;
    },
    z.object({
        updates: z.array(TeamUpdateEntrySchema).min(1).max(MAX_BATCH_SIZE),
        auto_index: z.boolean().optional().default(true),
        project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
    }).strict()
)

export const TeamBatchUpdateEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
                Reflect.deleteProperty(obj, 'items');
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
                Reflect.deleteProperty(obj, 'entries');
            }
            if (Array.isArray(updatesArr)) {
                const newUpdates = updatesArr.map((u: unknown) => {
                    if (typeof u === 'object' && u !== null) {
                        const uObj = { ...(u as Record<string, unknown>) };
                        if ('id' in uObj && !('entry_id' in uObj)) {
                            uObj['entry_id'] = uObj['id'];
                            delete uObj['id'];
                        }
                        return uObj;
                    }
                    return u;
                });
                return { ...obj, updates: newUpdates };
            }
        }
        return val;
    },
    z.object({
        updates: z.array(TeamUpdateEntrySchemaMcp).optional(),
        auto_index: z.boolean().optional().default(true),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    }).strict()
)

export const TeamBatchDeleteEntriesSchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_ids: z.array(z.number()).min(1).max(MAX_BATCH_SIZE),
        project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
        permanent: z.boolean().optional().default(false),
    }).strict()
)

export const TeamBatchDeleteEntriesSchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_ids: z.array(relaxedNumber().optional()).optional(),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
        permanent: z.boolean().optional().default(false),
    }).strict()
)

// ============================================================================
// Analytics Tool Schemas
// ============================================================================

/** team_get_statistics — strict */
export const TeamGetStatisticsSchema = z.object({
    group_by: z.enum(['day', 'week', 'month']).optional().default('week'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

/** team_get_statistics — relaxed */
export const TeamGetStatisticsSchemaMcp = z.object({
    group_by: z.string().optional().default('week'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
        relationship_type: z.string().optional().default('references'),
        type: z.string().optional(),
        description: z.string().optional(),
        project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    })
    .transform((data) => ({
        from_entry_id: data.from_entry_id ?? data.from_id ?? data.from,
        to_entry_id: data.to_entry_id ?? data.to_id ?? data.to,
        relationship_type: data.type ?? data.relationship_type,
        description: data.description,
        project_number: data.project_number,
    }))

/** team_visualize_relationships — strict */
export const TeamVisualizeRelationshipsSchema = z.object({
    entry_id: z.number().optional(),
    tag: z.string().optional(),
    depth: z.number().min(1).max(5).optional().default(2),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

/** team_visualize_relationships — relaxed */
export const TeamVisualizeRelationshipsSchemaMcp = z.object({
    entry_id: relaxedNumber().optional(),
    tag: z.string().optional(),
    depth: relaxedNumber().optional().default(2),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
    workspace_id: z.string().optional(),
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
        next_cursor: z.string().optional().describe('Cursor for the next page of results'),
        suggestions: z.array(z.string()).optional().describe('Fuzzy matches when fuzzy_match=true and no exact results were found'),
        correctedQuery: z.string().optional().describe('The corrected query when auto_correct=true and a confident match was found'),
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

export const TeamRestoreOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entryId: z.number().optional(),
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

export const TeamBatchCreateEntriesOutputSchema = BatchResultOutputSchema.extend({
    entries: z.array(TeamEntryOutputSchema).optional(),
    indexStatuses: z.array(z.string()).optional(),
})

export const TeamBatchUpdateEntriesOutputSchema = BatchResultOutputSchema.extend({
    updated: z.array(TeamEntryOutputSchema).optional(),
    notFound: z.array(z.number()).optional(),
    indexStatuses: z.array(z.string()).optional(),
})

export const TeamBatchDeleteEntriesOutputSchema = BatchResultOutputSchema.extend({
    deleted: z.array(z.number()).optional(),
    notFound: z.array(z.number()).optional(),
    permanent: z.boolean().optional(),
    warning: z.string().optional(),
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

export const TeamExportOutputSchema = z
    .object({
        success: z.boolean().optional(),
        format: z.string().optional(),
        data: z.string().optional(),
        count: z.number().optional(),
        truncated: z.boolean().optional(),
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
export const TeamSemanticSearchSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            for (const key of ['q', 'text', 'message', 'description']) {
                if (key in obj && !('query' in obj)) {
                    obj['query'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : val;
        }
        return val;
    },
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
    workflow_run_id: z.number().optional().describe('Filter results by GitHub Actions workflow run ID'),
    include_archived: z.boolean().optional().default(false),
}))

/** team_semantic_search — relaxed */
export const TeamSemanticSearchSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            for (const key of ['q', 'text', 'message', 'description']) {
                if (key in obj && !('query' in obj)) {
                    obj['query'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : val;
        }
        return val;
    },
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
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    issue_number: relaxedNumber().optional().describe('Filter results by GitHub issue number'),
    pr_number: relaxedNumber().optional().describe('Filter results by GitHub PR number'),
    workflow_run_id: relaxedNumber().optional().describe('Filter results by GitHub Actions workflow run ID'),
    include_archived: z.boolean().optional().default(false),
}))

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
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

/** team_get_cross_project_insights — relaxed */
export const TeamCrossProjectInsightsSchemaMcp = z.object({
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    min_entries: relaxedNumber().optional()
        .optional()
        .default(3)
        .describe('Minimum entries to include project'),
    limit: relaxedNumber().optional().default(100).describe('Max projects to return'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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

// ============================================================================
// Collaboration Matrix Schemas
// ============================================================================

/** team_get_collaboration_matrix — strict */
export const TeamCollaborationMatrixSchema = z.object({
    period: z
        .enum(['week', 'month', 'quarter'])
        .optional()
        .default('month')
        .describe('Time granularity for the activity heatmap'),
    limit: z.number().max(100).optional().default(20).describe('Max authors to include'),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

/** team_get_collaboration_matrix — relaxed */
export const TeamCollaborationMatrixSchemaMcp = z.object({
    period: z.string().optional().default('month'),
    limit: relaxedNumber().optional().default(20),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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


// ============================================================================
// Flag Output Schemas
// ============================================================================

export const FlagOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        flag_type: z.string().optional(),
        target_user: z.string().nullable().optional(),
        resolved: z.boolean().optional(),
        author: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const ResolveFlagOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        flag_type: z.string().optional(),
        resolved: z.boolean().optional(),
        resolution: z.string().nullable().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// New Flag Tool Schemas (List, Update, Analytics)
// ============================================================================

/** list_team_flags — strict */
export const ListTeamFlagsSchema = z.object({
    status: z.enum(['active', 'resolved', 'all']).optional().default('active'),
    flag_type: z.string().optional().describe('Filter by flag type from vocabulary'),
    target_user: z.string().optional().describe('Filter by target user'),
    author: z.string().optional().describe('Filter by flag creator'),
    limit: z.number().min(1).max(500).optional().default(20),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
    sort_by: z.enum(['timestamp', 'priority']).optional().default('priority'),
})

/** list_team_flags — relaxed for MCP SDK */
export const ListTeamFlagsSchemaMcp = z.object({
    status: z.string().optional().default('active'),
    flag_type: z.string().optional(),
    target_user: z.string().optional(),
    author: z.string().optional(),
    limit: relaxedNumber().optional().default(20),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    sort_by: z.string().optional().default('priority'),
})

/** update_team_flag — strict */
export const UpdateTeamFlagSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if (('id' in obj || 'entry_id' in obj) && !('flag_id' in obj)) {
                obj['flag_id'] = obj['id'] ?? obj['entry_id'];
                Reflect.deleteProperty(obj, 'id');
                Reflect.deleteProperty(obj, 'entry_id');
                modified = true;
            }
            for (const key of ['keep', 'path', 'q', 'mode', 'text', 'description', 'content']) {
                if (key in obj && !('message' in obj)) {
                    obj['message'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
    flag_id: z.number().describe('Entry ID of the flag to update'),
    flag_type: z.string().optional().describe('New flag type'),
    target_user: z.string().nullable().optional().describe('New target user (null to clear)'),
    message: z.string().min(1).max(49_000).optional().describe('Updated flag message'),
    link: z.string().nullable().optional().describe('Updated link (null to clear)'),
    reopen: z.boolean().optional().describe('If true, reopen a resolved flag'),
})
)

/** update_team_flag — relaxed for MCP SDK */
export const UpdateTeamFlagSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if (('id' in obj || 'entry_id' in obj) && !('flag_id' in obj)) {
                obj['flag_id'] = obj['id'] ?? obj['entry_id'];
                Reflect.deleteProperty(obj, 'id');
                Reflect.deleteProperty(obj, 'entry_id');
                modified = true;
            }
            for (const key of ['keep', 'path', 'q', 'mode', 'text', 'description', 'content']) {
                if (key in obj && !('message' in obj)) {
                    obj['message'] = obj[key];
                    Reflect.deleteProperty(obj, key);
                    modified = true;
                    break;
                }
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
    flag_id: relaxedNumber().optional(),
    flag_type: z.string().optional(),
    target_user: z.string().nullable().optional(),
    message: z.string().optional(),
    link: z.string().nullable().optional(),
    reopen: z.boolean().optional(),
})
)

/** flag_analytics — strict */
export const FlagAnalyticsSchema = z.object({
    period: z.enum(['day', 'week', 'month']).optional().default('week'),
    project_number: StrictProjectNumberSchema,
    workspace_id: z.string().optional(),
})

/** flag_analytics — relaxed for MCP SDK */
export const FlagAnalyticsSchemaMcp = z.object({
    period: z.string().optional().default('week'),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
})

// ============================================================================
// New Flag Output Schemas (List, Update, Analytics)
// ============================================================================

export const ListFlagsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        flags: z
            .array(
                z.object({
                    id: z.number(),
                    flag_type: z.string(),
                    target_user: z.string().nullable().optional(),
                    author: z.string().nullable().optional(),
                    message: z.string(),
                    link: z.string().nullable().optional(),
                    resolved: z.boolean(),
                    resolved_at: z.string().nullable().optional(),
                    resolution: z.string().nullable().optional(),
                    timestamp: z.string(),
                    age_hours: z.number(),
                    is_stale: z.boolean(),
                    tags: z.array(z.string()).optional(),
                    project_number: z.number().nullable().optional(),
                })
            )
            .optional(),
        count: z.number().optional(),
        active_count: z.number().optional(),
        resolved_count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const UpdateFlagOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        flag_type: z.string().optional(),
        target_user: z.string().nullable().optional(),
        resolved: z.boolean().optional(),
        author: z.string().optional(),
        changes: z.array(z.string()).optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const FlagAnalyticsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        summary: z
            .object({
                total_flags: z.number(),
                active_flags: z.number(),
                resolved_flags: z.number(),
                avg_resolution_hours: z.number().nullable(),
                median_resolution_hours: z.number().nullable(),
                stale_count: z.number(),
            })
            .optional(),
        by_type: z
            .record(
                z.string(),
                z.object({
                    total: z.number(),
                    active: z.number(),
                    avg_resolution_hours: z.number().nullable(),
                })
            )
            .optional(),
        by_target: z
            .array(
                z.object({
                    user: z.string(),
                    received: z.number(),
                    active: z.number(),
                })
            )
            .optional(),
        trend: z
            .object({
                current_period: z.number(),
                previous_period: z.number(),
                change_pct: z.number().nullable(),
            })
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

