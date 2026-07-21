import { z } from 'zod'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    EntryOutputSchema,
    relaxedNumber,
    MAX_BATCH_SIZE,
    BatchResultOutputSchema,
    healAgentHallucinations,
} from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { CreateEntrySchema, CreateEntrySchemaMcp } from '../core/index.js'

// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const UpdateEntrySchema = z.preprocess(
    (val: unknown) => {
        const healedVal = healAgentHallucinations(val);
        if (typeof healedVal === 'object' && healedVal !== null) {
            const obj = { ...(healedVal as Record<string, unknown>) };
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
            return modified ? obj : healedVal;
        }
        return healedVal;
    },
    z.object({
        entry_id: z.number(),
        content: z.string().optional().refine(
            (val) => {
                if (!val) return true;
                const trimmed = val.trim();
                const startsWithSection = /^##\s+(Context for Next Session|Unfinished \/ Blocked|Accomplished)/i.test(trimmed);
                const hasAccomplished = /#+\s+Accomplished/i.test(val);
                return !(startsWithSection && !hasAccomplished);
            },
            { message: "[ANTI-HALLUCINATION] Do not send partial updates. The `content` field fully overwrites the existing entry. You must retrieve the entry first, append your changes, and send the full Markdown content back." }
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
        target_workspace_id: z.string().optional().describe('Target workspace to move entry into (e.g. "mysql-mcp")'),
        impact_score: z.number().min(0).max(1).optional(),
        trust_score: z.number().min(0).max(1).optional(),
        validation_status: z.enum(['passed', 'none', 'failed']).optional(),
        session_id: z.string().nullable().optional(),
    }).strict()
)

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const UpdateEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        const healedVal = healAgentHallucinations(val);
        if (typeof healedVal === 'object' && healedVal !== null) {
            const obj = { ...(healedVal as Record<string, unknown>) };
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
            return modified ? obj : healedVal;
        }
        return healedVal;
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
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
        impact_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating blast radius (0.9+ for core architecture, 0.1 for simple docs).'),
        trust_score: relaxedNumber().optional().describe('Heuristic score (0.0-1.0) indicating confidence (0.3-0.5 for unverified, 0.9+ for verified).'),
        validation_status: z.string().optional().describe('Current validation status of the entry (passed, none, failed).'),
        session_id: z.string().nullable().optional().describe('Agent session ID for thread isolation.'),
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
        expected_version: z.number().optional().describe('REQUIRED for concurrency safety'),
        workspace_id: z.string().optional(),
    }).strict()
)

/** Relaxed schema — passed to SDK inputSchema so type coercion errors reach the handler */
export const DeleteEntrySchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if ('id' in obj && !('entry_id' in obj)) {
                obj['entry_id'] = obj['id'];
                delete obj['id'];
                modified = true;
            }
            if ('project_number' in obj) {
                delete obj['project_number'];
                modified = true;
            }
            return modified ? obj : val;
        }
        return val;
    },
    z.object({
        entry_id: relaxedNumber().optional().describe('The ID of the entry to delete. If you need to delete multiple entries, use batch_delete_entries instead.'),
        permanent: z.boolean().optional().default(false).describe('If true, permanently deletes the entry. If false, performs a soft delete.'),
        expected_version: relaxedNumber().optional().describe('REQUIRED for safe deletion to prevent optimistic concurrency gaps. Get this from get_entry_by_id.'),
        project_number: relaxedNumber().optional().describe('Ignored. Provided for agent compatibility.'),
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    }).strict()
)

export const BatchCreateEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;
            if (Array.isArray(obj['entries'])) {
                const rootProjectNum = obj['project_number'];
                const rootWorkspaceId = obj['workspace_id'];
                const newEntries = obj['entries'].map((e: unknown) => {
                    if (typeof e === 'object' && e !== null) {
                        const eObj = { ...(e as Record<string, unknown>) };
                        if (eObj['project_number'] === undefined && rootProjectNum !== undefined) {
                            eObj['project_number'] = rootProjectNum;
                        }
                        if (eObj['workspace_id'] === undefined && rootWorkspaceId !== undefined) {
                            eObj['workspace_id'] = rootWorkspaceId;
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
        workspace_id: z.string().optional(),
    }).strict()
)

export const BatchCreateEntriesSchemaMcp = z.object({
    entries: z.array(CreateEntrySchemaMcp).optional(),
    auto_index: z.boolean().optional().default(true),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
        workspace_id: z.string().optional(),
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
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
        workspace_id: z.string().optional(),
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
        entry_ids: z.array(relaxedNumber().optional()).optional(),
        permanent: z.boolean().optional().default(false),
        workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
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
            if (typeof obj['query'] === 'string' && obj['tool_name'] === undefined) {
                obj['tool_name'] = obj['query'];
                delete obj['query'];
            }
            if (typeof obj['q'] === 'string' && obj['tool_name'] === undefined) {
                obj['tool_name'] = obj['q'];
                delete obj['q'];
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

export const RunAutoPruneSchema = z.object({
    dry_run: z.boolean().optional().default(false),
    archive_older_than_days: z.number().min(0).optional(),
    prune_older_than_days: z.number().min(0).optional(),
    hard_delete_older_than_days: z.number().min(0).optional(),
    importance_threshold: z.number().min(0).max(1).optional(),
}).strict()

export const RunAutoPruneSchemaMcp = z.object({
    dry_run: z.boolean().optional().describe('If true, simulates the pruning process and returns the counts without making actual changes.'),
    archive_older_than_days: relaxedNumber().optional().describe('Override the number of days before active entries are archived.'),
    prune_older_than_days: relaxedNumber().optional().describe('Override the number of days before archived entries are soft-deleted.'),
    hard_delete_older_than_days: relaxedNumber().optional().describe('Override the number of days before soft-deleted entries are permanently removed.'),
    importance_threshold: relaxedNumber().optional().describe('Override the importance score threshold (0.0 - 1.0) below which entries are eligible for pruning.'),
}).strict()
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

export const RunAutoPruneOutputSchema = z
    .object({
        success: z.boolean().optional(),
        archivedCount: z.number().optional(),
        prunedCount: z.number().optional(),
        hardDeletedCount: z.number().optional(),
        backupFile: z.string().optional(),
        dryRun: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const RegisterProjectSchemaMcp = z.object({
    name: z.string().describe('The key/name of the project in the registry.'),
    absolute_path: z.string().describe('The absolute path to the local repository.'),
    project_number: relaxedNumber().optional().describe('The GitHub Project number, if applicable.'),
}).strict()

export const UpdateProjectSchemaMcp = z.object({
    name: z.string().describe('The current key/name of the project.'),
    new_name: z.string().optional().describe('The new key/name for the project (if renaming).'),
    absolute_path: z.string().optional().describe('The new absolute path to the local repository.'),
    project_number: relaxedNumber().optional().describe('The new GitHub Project number.'),
}).strict()

export const DeleteProjectSchemaMcp = z.object({
    name: z.string().describe('The key/name of the project to delete.'),
}).strict()

export const GetProjectSchemaMcp = z.object({
    name: z.string().describe('The key/name of the project to retrieve.'),
}).strict()

export const ListProjectsSchemaMcp = z.object({}).strict()

export const ProjectOutputSchema = z.object({
    success: z.boolean().optional(),
    project: z.object({
        name: z.string(),
        path: z.string(),
        project_number: z.number().optional(),
    }).optional(),
    projects: z.record(z.string(), z.object({
        path: z.string(),
        project_number: z.number().optional()
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

