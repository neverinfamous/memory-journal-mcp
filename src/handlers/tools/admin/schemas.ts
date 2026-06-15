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
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id'];
                delete obj['id'];
                modified = true;
            }
            if ('text' in obj && !('content' in obj)) {
                obj['content'] = obj['text'];
                delete obj['text'];
                modified = true;
            }
            if ('title' in obj) {
                if (!('content' in obj)) {
                    obj['content'] = obj['title'];
                } else {
                    obj['content'] = `# ${String(obj['title'])}\n\n${String(obj['content'])}`;
                }
                delete obj['title'];
                modified = true;
            }
            return modified ? obj : val;
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
    }).strict()
)

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const UpdateEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id'];
                delete obj['id'];
                modified = true;
            }
            if ('text' in obj && !('content' in obj)) {
                obj['content'] = obj['text'];
                delete obj['text'];
                modified = true;
            }
            if ('title' in obj) {
                if (!('content' in obj)) {
                    obj['content'] = obj['title'];
                } else {
                    obj['content'] = `# ${String(obj['title'])}\n\n${String(obj['content'])}`;
                }
                delete obj['title'];
                modified = true;
            }
            return modified ? obj : val;
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
    }).strict()
)

export const DeleteEntrySchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id'];
                delete obj['id'];
                return obj;
            }
        }
        return val;
    },
    z.object({
        entry_id: z.number(),
        permanent: z.boolean().optional().default(false),
        project_number: z.number().int().optional(),
    }).strict()
)

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
export const DeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id'];
                delete obj['id'];
                return obj;
            }
        }
        return val;
    },
    z.object({
        entry_id: relaxedNumber().optional().describe('The ID of the entry to delete. If you need to delete multiple entries, use batch_delete_entries instead.'),
        permanent: z.boolean().optional().default(false).describe('If true, permanently deletes the entry. If false, performs a soft delete.'),
    }).strict()
)

export const BatchCreateEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if (Array.isArray(obj['entries'])) {
                const rootProjectNum = obj['project_number'];
                const newEntries = obj['entries'].map((e: unknown) => {
                    if (typeof e === 'object' && e !== null) {
                        const eObj = { ...(e as Record<string, unknown>) };
                        if (eObj['project_number'] === undefined && rootProjectNum !== undefined) {
                            eObj['project_number'] = rootProjectNum;
                        }
                        return eObj;
                    }
                    return e;
                });
                obj['entries'] = newEntries;
                modified = true;
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
        entries: z.array(CreateEntrySchema).min(1).max(MAX_BATCH_SIZE),
        auto_index: z.boolean().optional().default(true),
        project_number: z.number().int().optional(),
    }).strict()
)

export const BatchCreateEntriesSchemaMcp = z.object({
    entries: z.array(CreateEntrySchemaMcp).optional(),
    auto_index: z.boolean().optional().default(true),
}).strict()

export const BatchUpdateEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
                delete obj['items'];
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
                delete obj['entries'];
            }
            if (Array.isArray(updatesArr)) {
                const rootProjectNum = obj['project_number'];
                const newUpdates = updatesArr.map((u: unknown) => {
                    if (typeof u === 'object' && u !== null) {
                        const uObj = { ...(u as Record<string, unknown>) };
                        if ('id' in uObj && !('entry_id' in uObj)) {
                            uObj['entry_id'] = uObj['id'];
                            delete uObj['id'];
                        }
                        if (uObj['project_number'] === undefined && rootProjectNum !== undefined) {
                            uObj['project_number'] = rootProjectNum;
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
        updates: z.array(UpdateEntrySchema).min(1).max(MAX_BATCH_SIZE),
        auto_index: z.boolean().optional().default(true),
        project_number: z.number().int().optional(),
    }).strict()
)

export const BatchUpdateEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let updatesArr = obj['updates'];
            if (updatesArr === undefined && Array.isArray(obj['items'])) {
                updatesArr = obj['items'];
                obj['updates'] = updatesArr;
                delete obj['items'];
            }
            if (updatesArr === undefined && Array.isArray(obj['entries'])) {
                updatesArr = obj['entries'];
                obj['updates'] = updatesArr;
                delete obj['entries'];
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
        updates: z.array(UpdateEntrySchemaMcp).optional(),
        auto_index: z.boolean().optional().default(true),
    }).strict()
)

export const BatchDeleteEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if ('ids' in obj && !('entry_ids' in obj)) {
                obj['entry_ids'] = Array.isArray(obj['ids']) ? obj['ids'] : [obj['ids']];
                delete obj['ids'];
                modified = true;
            }
            if ('id' in obj && !('entry_ids' in obj)) {
                obj['entry_ids'] = Array.isArray(obj['id']) ? obj['id'] : [obj['id']];
                delete obj['id'];
                modified = true;
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
        entry_ids: z.array(z.number()).min(1).max(MAX_BATCH_SIZE),
        permanent: z.boolean().optional().default(false),
        project_number: z.number().int().optional(),
    }).strict()
)

export const BatchDeleteEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if ('ids' in obj && !('entry_ids' in obj)) {
                obj['entry_ids'] = Array.isArray(obj['ids']) ? obj['ids'] : [obj['ids']];
                delete obj['ids'];
                modified = true;
            }
            if ('id' in obj && !('entry_ids' in obj)) {
                obj['entry_ids'] = Array.isArray(obj['id']) ? obj['id'] : [obj['id']];
                delete obj['id'];
                modified = true;
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
        entry_ids: z.array(relaxedNumber()).optional(),
        permanent: z.boolean().optional().default(false),
    }).strict()
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
