import { z } from 'zod'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    EntryOutputSchema,
    relaxedNumber,
    MAX_BATCH_SIZE,
    MAX_CONTENT_LENGTH,
    BatchResultOutputSchema,
    healAgentHallucinations,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { CreateEntrySchema, CreateEntrySchemaMcp } from '../../core/index.js'
import {
    preprocessBatchCreateEntries,
    preprocessBatchUpdates,
    preprocessBatchDeleteIds,
} from './batch-preprocessors.js'

export { preprocessBatchCreateEntries, preprocessBatchUpdates, preprocessBatchDeleteIds }

const WORKSPACE_DESC =
    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'

function preprocessUpdateEntry(val: unknown): unknown {
    const healedVal = healAgentHallucinations(val)
    if (typeof healedVal === 'object' && healedVal !== null) {
        const obj = { ...(healedVal as Record<string, unknown>) }
        let modified = false
        if ('id' in obj && !('entry_id' in obj)) {
            obj['entry_id'] = obj['id']
            delete obj['id']
            modified = true
        }
        if ('text' in obj && !('content' in obj)) {
            obj['content'] = obj['text']
            delete obj['text']
            modified = true
        }
        // [AGENT-HINT] L7/H8: title/heading/subject/name are folded (or dropped on updates) by
        // healAgentHallucinations → healTitleField; no duplicate handling here.
        return modified ? obj : healedVal
    }
    return healedVal
}

/** Strict schema — used inside handler for structured Zod errors */
export const UpdateEntrySchema = z.preprocess(
    preprocessUpdateEntry,
    z
        .object({
            entry_id: z.number(),
            content: z
                .string()
                .min(1)
                .max(MAX_CONTENT_LENGTH)
                .optional()
                .refine(
                    (val) => {
                        if (val === undefined) return true
                        const trimmed = val.trim()
                        const startsWithSection =
                            /^##\s+(Context for Next Session|Unfinished \/ Blocked|Accomplished)/i.test(
                                trimmed
                            )
                        const hasAccomplished = /#+\s+Accomplished/i.test(val)
                        return !(startsWithSection && !hasAccomplished)
                    },
                    {
                        message:
                            '[ANTI-HALLUCINATION] Do not send partial updates. The `content` field fully overwrites the existing entry. You must retrieve the entry first, append your changes, and send the full Markdown content back.',
                    }
                ),
            entry_type: z.enum(ENTRY_TYPES).optional(),
            is_personal: z.boolean().optional(),
            tags: z.array(z.string()).optional(),
            significance_type: z.enum(SIGNIFICANCE_TYPES).nullable().optional(),
            project_number: z.number().int().optional(),
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
            workspace_id: z.string().optional(),
            target_workspace_id: z
                .string()
                .optional()
                .describe('Target workspace to move entry into (e.g. "mysql-mcp")'),
            impact_score: z.number().min(0).max(1).optional(),
            trust_score: z.number().min(0).max(1).optional(),
            validation_status: z.enum(['passed', 'none', 'failed']).optional(),
            session_id: z.string().optional(),
        })
        .strict()
        .refine(
            (data) =>
                data.content !== undefined ||
                data.entry_type !== undefined ||
                data.is_personal !== undefined ||
                data.tags !== undefined ||
                data.project_number !== undefined ||
                data.significance_type !== undefined ||
                data.project_owner !== undefined ||
                data.issue_number !== undefined ||
                data.issue_url !== undefined ||
                data.pr_number !== undefined ||
                data.pr_url !== undefined ||
                data.pr_status !== undefined ||
                data.workflow_run_id !== undefined ||
                data.workflow_name !== undefined ||
                data.workflow_status !== undefined ||
                data.is_archived !== undefined ||
                data.auto_context !== undefined ||
                data.target_workspace_id !== undefined ||
                data.impact_score !== undefined ||
                data.trust_score !== undefined ||
                data.validation_status !== undefined ||
                data.session_id !== undefined,
            {
                message: 'At least one mutable field must be provided for update_entry',
            }
        )
)

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const UpdateEntrySchemaMcp = z.preprocess(
    preprocessUpdateEntry,
    z
        .object({
            entry_id: relaxedNumber().optional(),
            content: z
                .string()
                .optional()
                .describe(
                    'Updated markdown content. Preserve the existing ## section header structure. ' +
                        'For session summaries, keep the ## Accomplished / ## Unfinished / Blocked / ' +
                        '## Context for Next Session / ## Commits structure intact. ' +
                        'Do NOT restructure or add new top-level sections unless explicitly requested.'
                ),
            entry_type: z.string().optional(),
            is_personal: z.boolean().optional(),
            tags: z.array(z.string()).optional(),
            significance_type: z.string().nullable().optional(),
            project_number: relaxedNumber().optional(),
            project_owner: z.string().nullable().optional(),
            issue_number: relaxedNumber().nullable().optional(),
            issue_url: z.string().nullable().optional(),
            pr_number: relaxedNumber().nullable().optional(),
            pr_url: z.string().nullable().optional(),
            pr_status: z.string().nullable().optional(),
            workflow_run_id: relaxedNumber().nullable().optional(),
            workflow_name: z.string().nullable().optional(),
            workflow_status: z.string().nullable().optional(),
            is_archived: z.boolean().optional(),
            expected_version: relaxedNumber().optional(),
            auto_context: z.string().nullable().optional(),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
            target_workspace_id: z
                .string()
                .optional()
                .describe('Target workspace to move entry into (e.g. "mysql-mcp")'),
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
            session_id: z.string().optional().describe('Agent session ID for thread isolation.'),
        })
        .strict()
)

export const DeleteEntrySchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) }
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id']
                delete obj['id']
                return obj
            }
        }
        return val
    },
    z
        .object({
            entry_id: z.number(),
            permanent: z.boolean().optional().default(false),
            project_number: z.number().int().optional(),
            expected_version: z.number().optional().describe('REQUIRED for concurrency safety'),
            workspace_id: z.string().optional(),
        })
        .strict()
)

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
export const DeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) }
            let modified = false
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id']
                delete obj['id']
                modified = true
            }
            return modified ? obj : val
        }
        return val
    },
    z
        .object({
            entry_id: relaxedNumber()
                .optional()
                .describe(
                    'The ID of the entry to delete. If you need to delete multiple entries, use batch_delete_entries instead.'
                ),
            permanent: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    'If true, permanently deletes the entry. If false, performs a soft delete.'
                ),
            expected_version: relaxedNumber()
                .optional()
                .describe(
                    'REQUIRED for safe deletion to prevent optimistic concurrency gaps. Get this from get_entry_by_id.'
                ),
            project_number: relaxedNumber().optional().describe('Project whose workspace owns the entry. Resolved with workspace_id.'),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        })
        .strict()
)

export const BatchCreateEntriesSchema = z.preprocess(
    preprocessBatchCreateEntries,
    z
        .object({
            entries: z.array(CreateEntrySchema).min(1).max(MAX_BATCH_SIZE),
            auto_index: z.boolean().optional().default(true),
            project_number: z.number().int().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
)

export const BatchCreateEntriesSchemaMcp = z.preprocess(
    preprocessBatchCreateEntries,
    z
        .object({
            entries: z.array(CreateEntrySchemaMcp).optional(),
            auto_index: z.boolean().optional().default(true),
            project_number: relaxedNumber()
                .optional()
                .describe('Numeric project ID applied to batch entries when omitted per item.'),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        })
        .strict()
)

export const BatchUpdateEntriesSchema = z.preprocess(
    (val: unknown) => preprocessBatchUpdates(val, true),
    z
        .object({
            updates: z.array(UpdateEntrySchema).min(1).max(MAX_BATCH_SIZE),
            auto_index: z.boolean().optional().default(true),
            project_number: z.number().int().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
)

export const BatchUpdateEntriesSchemaMcp = z.preprocess(
    (val: unknown) => preprocessBatchUpdates(val, true),
    z
        .object({
            updates: z.array(UpdateEntrySchemaMcp).optional(),
            auto_index: z.boolean().optional().default(true),
            project_number: relaxedNumber()
                .optional()
                .describe('Numeric project ID applied to batch updates when omitted per item.'),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        })
        .strict()
)

export const BatchDeleteEntriesSchema = z.preprocess(
    preprocessBatchDeleteIds,
    z
        .object({
            entry_ids: z.array(z.number()).min(1).max(MAX_BATCH_SIZE),
            permanent: z.boolean().optional().default(false),
            project_number: z.number().int().optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
)

export const BatchDeleteEntriesSchemaMcp = z.preprocess(
    preprocessBatchDeleteIds,
    z
        .object({
            entry_ids: z.array(relaxedNumber().optional()).optional(),
            permanent: z.boolean().optional().default(false),
            project_number: relaxedNumber()
                .optional()
                .describe('Optional project number for workspace resolution.'),
            workspace_id: z.string().optional().describe(WORKSPACE_DESC),
        })
        .strict()
)

export const BatchCreateEntriesOutputSchema = BatchResultOutputSchema.extend({
    entries: z.array(EntryOutputSchema).optional(),
    indexStatuses: z.array(z.string()).optional(),
    relationshipWarnings: z.array(z.string()).optional(),
    warning: z.string().optional(),
})

export const BatchUpdateEntriesOutputSchema = BatchResultOutputSchema.extend({
    updated: z.array(EntryOutputSchema).optional(),
    notFound: z.array(z.number()).optional(),
    indexStatuses: z.array(z.string()).optional(),
    warning: z.string().optional(),
})

export const BatchDeleteEntriesOutputSchema = BatchResultOutputSchema.extend({
    deleted: z.array(z.number()).optional(),
    notFound: z.array(z.number()).optional(),
    permanent: z.boolean().optional(),
    warning: z.string().optional(),
})

export const UpdateEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: EntryOutputSchema.optional(),
        indexStatus: z.string().optional(),
        warning: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const DeleteEntryOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entryId: z.number().optional(),
        permanent: z.boolean().optional(),
        error: z.string().optional(),
        warning: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const MergeTagsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        sourceTag: z.string().optional(),
        targetTag: z.string().optional(),
        entriesUpdated: z.number().optional(),
        sourceDeleted: z.boolean().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
