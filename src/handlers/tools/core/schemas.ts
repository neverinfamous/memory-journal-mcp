import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES, EntryOutputSchema, relaxedNumber, healAgentHallucinations } from '../schemas.js'

// ============================================================================
// Shared Constants
// ============================================================================
const MAX_SEARCH_LIMIT = 500

// ============================================================================
// Core Schemas
// ============================================================================

export const CreateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_type: z.enum(ENTRY_TYPES).optional().default('personal_reflection'),
        content: z.string().min(1),
        tags: z.array(z.string()).optional(),
        is_personal: z.boolean().optional().default(true),
        significance_type: z.enum(SIGNIFICANCE_TYPES).optional(),
        workspace_id: z.string().optional(),
        project_number: z.number().int().optional(),
        project_owner: z.string().optional(),
        issue_number: z.number().optional(),
        issue_url: z.string().optional(),
        pr_number: z.number().optional(),
        pr_url: z.string().optional(),
        pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
        workflow_run_id: z.number().optional(),
        workflow_name: z.string().optional(),
        workflow_status: z.string().optional(),
        impact_score: z.number().min(0).max(1).optional(),
        trust_score: z.number().min(0).max(1).optional(),
        validation_status: z.enum(['passed', 'none', 'failed']).optional(),
        anchors: z.array(z.object({
            anchor_path: z.string(),
            anchor_type: z.string(),
            status: z.enum(['pending', 'valid', 'stale', 'invalidated', 'unresolvable']).optional().default('pending'),
        })).optional(),
        share_with_team: z.boolean().optional().default(false),
        auto_context: z.string().optional(),
    }).strict().superRefine((data, ctx) => {
        if (data.tags?.includes('session-summary')) {
            const c = data.content || '';
            if (!/#+\s+Accomplished/i.test(c) || !/#+\s+Unfinished \/ Blocked/i.test(c) || !/#+\s+Context for Next Session/i.test(c) || !/#+\s+Commits/i.test(c)) {
                ctx.addIssue({
                    code: "custom",
                    path: ['content'],
                    message: "[ANTI-HALLUCINATION] Session summaries MUST contain exactly these 4 exact headers: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. Please correct the structure. Do not add or remove any top-level headers. You must rewrite the entire content field conforming to this exact structure.",
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
                            "Example: await mj.core.create_entry({ ..., auto_context: { \"commits\": [\"abc1234\"] } })",
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

export const CreateEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z.object({
        entry_type: z.string().optional().default('personal_reflection').describe(
            'Entry type. Use "retrospective" for session summaries, "bug_fix" for bugs, ' +
            '"feature_implementation" for features, "planning" for roadmaps, ' +
            '"technical_note" for implementation notes. Do NOT default to "personal_reflection" ' +
            'unless the entry is genuinely a personal note.'
        ),
        content: z.string().optional().describe(
            'Markdown-formatted entry content. Use ## section headers to organize content. ' +
            'Note: The primary text is stored in the `content` property (not `title`, `message`, `name`, `description`, or `text`). ' +
            'For session summaries (entry_type: "retrospective", tagged "session-summary"), ' +
            'MUST use EXACTLY: ## Accomplished, ## Unfinished / Blocked, ## Context for Next Session, ## Commits. ' +
            'Do NOT invent extra top-level sections for session summaries.'
        ),
        tags: z.array(z.string()).optional().describe(
            'Tags for categorization (kebab-case). Session summaries MUST include "session-summary". ' +
            'Add domain tags (e.g., "security", "performance") and activity tags (e.g., "refactor", "audit"). ' +
            '[ANTI-HALLUCINATION] MUST be an array of strings, e.g. ["tag1", "tag2"]. NEVER pass a single string.'
        ),
        is_personal: z.boolean().optional().default(true),
        significance_type: z.string().optional(),
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
        project_number: relaxedNumber().optional().describe(
            'REQUIRED. Numeric project ID (e.g., 1, 14). Find it in the briefing Config row ' +
            '(registry: repoName (#N)) or use get_statistics. Do NOT pass a repo name string.'
        ),
        project_owner: z.string().optional(),
        issue_number: relaxedNumber().optional(),
        issue_url: z.string().optional(),
        pr_number: relaxedNumber().optional(),
        pr_url: z.string().optional(),
        pr_status: z.string().optional(),
        workflow_run_id: relaxedNumber().optional(),
        workflow_name: z.string().optional(),
        workflow_status: z.string().optional(),
        impact_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating the blast radius of this change. E.g. core architecture changes = 0.9, simple doc fixes = 0.1.'),
        trust_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating confidence in the entry. E.g. verified by test suite = 0.9.'),
        validation_status: z.string().optional().describe('Current validation status of the entry.'),
        anchors: z.array(z.object({
            anchor_path: z.string(),
            anchor_type: z.string(),
            status: z.string().optional().default('pending'),
        })).optional().describe('Files or lines of code that this entry is fundamentally anchored to. If the anchor becomes stale/invalid, the entry importance score drops.'),
        share_with_team: z.boolean().optional().default(false).describe('If true, saves a copy of this entry to the Team database (if configured) using your team alias'),
        auto_context: z.string().optional().describe('JSON string with structured metadata. Used for session-commits context.'),
    }).strict()
)

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
    entry_id: z.number().int(),
    include_relationships: z.boolean().optional().default(true),
})

export const GetEntryByIdSchemaMcp = z.object({
    entry_id: relaxedNumber().optional().describe('The numeric ID of the entry to retrieve'),
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
    workspace_id: z.string().optional(),
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
    limit: relaxedNumber().optional()
        .optional()
        .default(10)
        .describe(`Maximum entries to return (max ${String(MAX_SEARCH_LIMIT)})`),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
    entry_id: z.number().int(),
})

export const GetEntryHistorySchemaMcp = z.object({
    entry_id: relaxedNumber().optional().describe('The numeric ID of the entry'),
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
