import { z } from 'zod'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    MAX_CONTENT_LENGTH,
    relaxedNumber,
    StrictProjectNumberSchema,
    MAX_BATCH_SIZE,
    BatchResultOutputSchema,
    healAgentHallucinations,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import {
    TeamEntryOutputSchema,
    TeamCreateEntrySchema,
    TeamCreateEntrySchemaMcp,
} from './core-search-schemas.js'

/** team_update_entry — strict */
export const TeamUpdateEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
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
                        if (!val) return true
                        const trimmed = val.trim()
                        const startsWithSection =
                            /^##\s+(Context for Next Session|Unfinished \/ Blocked|Accomplished|Commits)/i.test(
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
        })
        .strict()
)

/** team_update_entry — relaxed */
export const TeamUpdateEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
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
            tags: z.array(z.string()).optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
            significance_type: z.string().nullable().optional(),
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
        })
        .strict()
)

/** team_delete_entry — strict */
export const TeamDeleteEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_id: z.number(),
            project_number: StrictProjectNumberSchema.optional(),
            workspace_id: z.string().optional(),
            expected_version: z.number().optional().describe('REQUIRED for concurrency safety'),
        })
        .strict()
)

/** team_delete_entry — relaxed */
export const TeamDeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_id: relaxedNumber().optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
            expected_version: relaxedNumber()
                .optional()
                .describe(
                    'REQUIRED for safe deletion to prevent optimistic concurrency gaps. Get this from get_entry_by_id.'
                ),
        })
        .strict()
)

/** team_restore_entry — strict */
export const TeamRestoreEntrySchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_id: z.number(),
            project_number: StrictProjectNumberSchema.optional(),
            workspace_id: z.string().optional(),
        })
        .strict()
)

/** team_restore_entry — relaxed */
export const TeamRestoreEntrySchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_id: relaxedNumber().optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
        })
        .strict()
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
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

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
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

function preprocessTeamBatchUpdates(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) }
        let updatesArr = obj['updates']
        if (updatesArr === undefined && Array.isArray(obj['items'])) {
            updatesArr = obj['items']
            obj['updates'] = updatesArr
            Reflect.deleteProperty(obj, 'items')
        }
        if (updatesArr === undefined && Array.isArray(obj['entries'])) {
            updatesArr = obj['entries']
            obj['updates'] = updatesArr
            Reflect.deleteProperty(obj, 'entries')
        }
        if (Array.isArray(updatesArr)) {
            const newUpdates = updatesArr.map((u: unknown) => {
                if (typeof u === 'object' && u !== null) {
                    const uObj = { ...(u as Record<string, unknown>) }
                    if ('id' in uObj && !('entry_id' in uObj)) {
                        uObj['entry_id'] = uObj['id']
                        delete uObj['id']
                    }
                    return uObj
                }
                return u
            })
            return { ...obj, updates: newUpdates }
        }
    }
    return val
}

export const TeamBatchUpdateEntriesSchema = z.preprocess(
    preprocessTeamBatchUpdates,
    z
        .object({
            updates: z.array(TeamUpdateEntrySchema).min(1).max(MAX_BATCH_SIZE),
            auto_index: z.boolean().optional().default(true),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional(),
        })
        .strict()
)

export const TeamBatchUpdateEntriesSchemaMcp = z.preprocess(
    preprocessTeamBatchUpdates,
    z
        .object({
            updates: z.array(TeamUpdateEntrySchemaMcp).optional(),
            auto_index: z.boolean().optional().default(true),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
        })
        .strict()
)

export const TeamBatchDeleteEntriesSchema = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_ids: z.array(z.number()).min(1).max(MAX_BATCH_SIZE),
            project_number: StrictProjectNumberSchema.optional(),
            workspace_id: z.string().optional(),
            permanent: z.boolean().optional().default(false),
        })
        .strict()
)

export const TeamBatchDeleteEntriesSchemaMcp = z.preprocess(
    (val: unknown) => healAgentHallucinations(val),
    z
        .object({
            entry_ids: z.array(relaxedNumber().optional()).optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z
                .string()
                .optional()
                .describe(
                    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
                ),
            permanent: z.boolean().optional().default(false),
        })
        .strict()
)

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
