import { z } from 'zod'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    EntryOutputSchema,
    relaxedNumber,
    MAX_BATCH_SIZE,
    BatchResultOutputSchema,
} from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { CreateEntrySchema, CreateEntrySchemaMcp } from '../core/index.js'

// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const UpdateEntrySchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('id' in obj && !('entry_id' in obj)) {
                return { ...obj, entry_id: obj['id'] };
            }
            if ('text' in obj && !('content' in obj)) {
                return { ...obj, content: obj['text'] };
            }
        }
        return val;
    },
    z.object({
        entry_id: z.number(),
        content: z.string().optional(),
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
    })
)

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const UpdateEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('id' in obj && !('entry_id' in obj)) {
                return { ...obj, entry_id: obj['id'] };
            }
            if ('text' in obj && !('content' in obj)) {
                return { ...obj, content: obj['text'] };
            }
        }
        return val;
    },
    z.object({
        entry_id: relaxedNumber().optional(),
        content: z.string().optional().describe(
            'Updated markdown content. Preserve the existing ## section header structure. ' +
            'For session summaries, keep the ## Accomplished / ## Unfinished / Blocked / ' +
            '## Context for Next Session structure intact. ' +
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
    })
)

export const DeleteEntrySchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('id' in obj && !('entry_id' in obj)) {
                return { ...obj, entry_id: obj['id'] };
            }
        }
        return val;
    },
    z.object({
        entry_id: z.number(),
        permanent: z.boolean().optional().default(false),
    })
)

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
export const DeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('id' in obj && !('entry_id' in obj)) {
                return { ...obj, entry_id: obj['id'] };
            }
        }
        return val;
    },
    z.object({
        entry_id: relaxedNumber().optional(),
        permanent: z.boolean().optional().default(false),
    })
)

export const BatchCreateEntriesSchema = z.object({
    entries: z.array(CreateEntrySchema).min(1).max(MAX_BATCH_SIZE),
    auto_index: z.boolean().optional().default(true),
})

export const BatchCreateEntriesSchemaMcp = z.object({
    entries: z.array(CreateEntrySchemaMcp).optional(),
    auto_index: z.boolean().optional().default(true),
})

export const BatchUpdateEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
            }
            if (Array.isArray(updatesArr)) {
                const newUpdates = updatesArr.map((u: unknown) => {
                    if (typeof u === 'object' && u !== null) {
                        const uObj = u as Record<string, unknown>;
                        if ('id' in uObj && !('entry_id' in uObj)) {
                            return { ...uObj, entry_id: uObj['id'] };
                        }
                    }
                    return u;
                });
                return { ...obj, updates: newUpdates };
            }
        }
        return val;
    },
    z.object({
        updates: z.array(UpdateEntrySchema).min(1).max(MAX_BATCH_SIZE),
        auto_index: z.boolean().optional().default(true),
    })
)

export const BatchUpdateEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
            }
            if (Array.isArray(updatesArr)) {
                const newUpdates = updatesArr.map((u: unknown) => {
                    if (typeof u === 'object' && u !== null) {
                        const uObj = u as Record<string, unknown>;
                        if ('id' in uObj && !('entry_id' in uObj)) {
                            return { ...uObj, entry_id: uObj['id'] };
                        }
                    }
                    return u;
                });
                return { ...obj, updates: newUpdates };
            }
        }
        return val;
    },
    z.object({
        updates: z.array(UpdateEntrySchemaMcp).optional(),
        auto_index: z.boolean().optional().default(true),
    })
)

export const BatchDeleteEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('ids' in obj && !('entry_ids' in obj)) {
                return { ...obj, entry_ids: obj['ids'] };
            }
            if ('id' in obj && !('entry_ids' in obj)) {
                return { ...obj, entry_ids: Array.isArray(obj['id']) ? obj['id'] : [obj['id']] };
            }
        }
        return val;
    },
    z.object({
        entry_ids: z.array(z.number()).min(1).max(MAX_BATCH_SIZE),
        permanent: z.boolean().optional().default(false),
    })
)

export const BatchDeleteEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = val as Record<string, unknown>;
            if ('ids' in obj && !('entry_ids' in obj)) {
                return { ...obj, entry_ids: obj['ids'] };
            }
            if ('id' in obj && !('entry_ids' in obj)) {
                return { ...obj, entry_ids: Array.isArray(obj['id']) ? obj['id'] : [obj['id']] };
            }
        }
        return val;
    },
    z.object({
        entry_ids: z.array(relaxedNumber()).optional(),
        permanent: z.boolean().optional().default(false),
    })
)

export const SearchAuditLogSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            if (obj['date_range'] === undefined && (obj['start_date'] !== undefined || obj['end_date'] !== undefined)) {
                obj['date_range'] = {
                    start: obj['start_date'],
                    end: obj['end_date']
                };
                delete obj['start_date'];
                delete obj['end_date'];
            }
            if (typeof obj['action'] === 'string' && obj['tool_name'] === undefined) {
                obj['tool_name'] = obj['action'];
                delete obj['action'];
            }
            return obj;
        }
        return val;
    },
    z.object({
        tool_name: z.string().optional(),
        user: z.string().optional(),
        date_range: z.object({
            start: z.string().optional(),
            end: z.string().optional(),
        }).optional(),
        status: z.boolean().optional(),
        category: z.enum(['read', 'write', 'admin', 'team', 'audit']).optional(),
        limit: z.number().min(1).max(1000).optional().default(100),
        project_number: z.number().int().optional(),
    }).strict()
)
// ============================================================================
// Output Schemas
// ============================================================================

export const BatchCreateEntriesOutputSchema = BatchResultOutputSchema.extend({
    entries: z.array(EntryOutputSchema).optional(),
    indexStatuses: z.array(z.string()).optional(),
})

export const BatchUpdateEntriesOutputSchema = BatchResultOutputSchema.extend({
    updated: z.array(EntryOutputSchema).optional(),
    notFound: z.array(z.number()).optional(),
    indexStatuses: z.array(z.string()).optional(),
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

export const RebuildVectorIndexOutputSchema = z
    .object({
        success: z.boolean().optional(),
        partial: z.boolean().optional(),
        entriesIndexed: z.number().optional(),
        failedEntries: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const AddToVectorIndexOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entryId: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const SearchAuditLogOutputSchema = z
    .object({
        success: z.boolean().optional(),
        results: z.array(z.record(z.string(), z.unknown())).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const ExecuteRawQueryUnsafeOutputSchema = z
    .object({
        success: z.boolean().optional(),
        result: z.unknown().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
