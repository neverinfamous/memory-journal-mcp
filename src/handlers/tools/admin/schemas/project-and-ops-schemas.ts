import { z } from 'zod'
import { coerceIntString, relaxedNumber } from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { isRecord } from '../../../../utils/type-guards.js'

function preprocessSearchAuditLog(val: unknown): unknown {
    if (!isRecord(val)) return val
    const obj: Record<string, unknown> = { ...val }
    if (
        obj['date_range'] === undefined &&
        (obj['start_date'] !== undefined || obj['end_date'] !== undefined)
    ) {
        obj['date_range'] = {
            start: obj['start_date'],
            end: obj['end_date'],
        }
        delete obj['start_date']
        delete obj['end_date']
    }
    if (typeof obj['action'] === 'string' && obj['tool_name'] === undefined) {
        obj['tool_name'] = obj['action']
        delete obj['action']
    }
    if (typeof obj['query'] === 'string' && obj['tool_name'] === undefined) {
        obj['tool_name'] = obj['query']
        delete obj['query']
    }
    if (typeof obj['q'] === 'string' && obj['tool_name'] === undefined) {
        obj['tool_name'] = obj['q']
        delete obj['q']
    }
    if (typeof obj['tool'] === 'string' && obj['tool_name'] === undefined) {
        obj['tool_name'] = obj['tool']
        delete obj['tool']
    }
    if (typeof obj['success'] === 'boolean' && obj['status'] === undefined) {
        obj['status'] = obj['success']
        delete obj['success']
    }
    if (typeof obj['target_user'] === 'string' && obj['user'] === undefined) {
        obj['user'] = obj['target_user']
        delete obj['target_user']
    }
    return obj
}

export const SearchAuditLogSchema = z.preprocess(
    preprocessSearchAuditLog,
    z
        .object({
            tool_name: z.string().max(255).optional(),
            user: z.string().max(255).optional(),
            date_range: z
                .object({
                    start: z.string().max(64).optional(),
                    end: z.string().max(64).optional(),
                })
                .strict()
                .optional(),
            status: z.boolean().optional(),
            category: z.enum(['read', 'write', 'admin', 'team', 'audit']).optional(),
            limit: z.preprocess(coerceIntString, z.number().int().min(1).max(1000)).optional().default(100),
            project_number: z.preprocess(coerceIntString, z.number().int().positive()).optional(),
            workspace_id: z.string().max(255).optional(),
        })
        .strict()
)

export const SearchAuditLogSchemaMcp = z.preprocess(
    preprocessSearchAuditLog,
    z
        .object({
            tool_name: z.string().max(255).optional(),
            user: z.string().max(255).optional(),
            date_range: z
                .object({
                    start: z.string().max(64).optional(),
                    end: z.string().max(64).optional(),
                })
                .strict()
                .optional(),
            status: z.boolean().optional(),
            category: z.enum(['read', 'write', 'admin', 'team', 'audit']).optional(),
            limit: relaxedNumber().optional(),
            project_number: relaxedNumber().optional(),
            workspace_id: z.string().max(255).optional(),
        })
        .strict()
)

function coerceNonNegativeDecimal(v: unknown): unknown {
    if (typeof v !== 'string') return v
    const trimmed = v.trim()
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return v
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : v
}

export const RunAutoPruneSchema = z
    .object({
        dry_run: z.boolean().optional().default(false),
        archive_older_than_days: z.preprocess(coerceNonNegativeDecimal, z.number().min(0)).optional(),
        prune_older_than_days: z.preprocess(coerceNonNegativeDecimal, z.number().min(0)).optional(),
        hard_delete_older_than_days: z.preprocess(coerceNonNegativeDecimal, z.number().min(0)).optional(),
        importance_threshold: z.preprocess(coerceNonNegativeDecimal, z.number().min(0).max(1)).optional(),
        workspace_id: z.string().max(255).optional(),
        project_number: z
            .preprocess((v) => {
                if (typeof v !== 'string') return v
                const trimmed = v.trim()
                if (!/^[1-9]\d*$/.test(trimmed)) return v
                const parsed = Number(trimmed)
                return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : v
            }, z.number().int().positive())
            .optional(),
    })
    .strict()

export const RunAutoPruneSchemaMcp = z
    .object({
        dry_run: z
            .boolean()
            .optional()
            .describe(
                'If true, simulates the pruning process and returns the counts without making actual changes.'
            ),
        archive_older_than_days: relaxedNumber()
            .optional()
            .describe('Override the number of days before active entries are archived.'),
        prune_older_than_days: relaxedNumber()
            .optional()
            .describe('Override the number of days before archived entries are soft-deleted.'),
        hard_delete_older_than_days: relaxedNumber()
            .optional()
            .describe('Override the number of days before soft-deleted entries are permanently removed.'),
        importance_threshold: relaxedNumber()
            .optional()
            .describe(
                'Override the importance score threshold (0.0 - 1.0) below which entries are eligible for pruning.'
            ),
        workspace_id: z
            .string()
            .optional()
            .describe(
                "Optional workspace ID to scope pruning (defaults to active/configured workspace; pass '*' to prune all workspaces)."
            ),
        project_number: relaxedNumber()
            .optional()
            .describe('Optional project number to scope pruning.'),
    })
    .strict()

export const RebuildVectorIndexOutputSchema = z
    .object({
        success: z.boolean().optional(),
        partial: z.boolean().optional(),
        entriesIndexed: z.number().optional(),
        failedEntries: z.number().optional(),
        warning: z.string().optional(),
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
        warning: z.string().optional(),
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

export const RegisterProjectSchemaMcp = z
    .object({
        name: z.string().max(255).describe('The key/name of the project in the registry.'),
        absolute_path: z.string().max(500).describe('The absolute path to the local repository.'),
        project_number: relaxedNumber()
            .optional()
            .describe('The GitHub Project number, if applicable.'),
    })
    .strict()

export const UpdateProjectSchemaMcp = z
    .object({
        name: z.string().max(255).describe('The current key/name of the project.'),
        new_name: z.string().max(255).optional().describe('The new key/name for the project (if renaming).'),
        absolute_path: z
            .string()
            .max(500)
            .optional()
            .describe('The new absolute path to the local repository.'),
        project_number: relaxedNumber().optional().describe('The new GitHub Project number.'),
    })
    .strict()

export const DeleteProjectSchemaMcp = z
    .object({
        name: z.string().max(255).describe('The key/name of the project to delete.'),
    })
    .strict()

export const GetProjectSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj: Record<string, unknown> = { ...val }
            if (obj['name'] === undefined) {
                if ('project_name' in obj && typeof obj['project_name'] === 'string') {
                    obj['name'] = obj['project_name']
                } else if ('project' in obj && typeof obj['project'] === 'string') {
                    obj['name'] = obj['project']
                } else if (
                    'project_number' in obj &&
                    (typeof obj['project_number'] === 'string' ||
                        typeof obj['project_number'] === 'number')
                ) {
                    obj['name'] = String(obj['project_number'])
                } else if (
                    'id' in obj &&
                    (typeof obj['id'] === 'string' || typeof obj['id'] === 'number')
                ) {
                    obj['name'] = String(obj['id'])
                }
            }
            // [INVARIANT] Preserve conflicting aliases so .strict() fails closed instead of dropping them.
            if (typeof obj['name'] === 'string') {
                const canonicalNorm = obj['name'].trim().toLowerCase()
                for (const aliasKey of ['project_name', 'project', 'id'] as const) {
                    const aliasVal = obj[aliasKey]
                    if (
                        aliasVal === undefined ||
                        ((typeof aliasVal === 'string' || typeof aliasVal === 'number') &&
                            String(aliasVal).trim().toLowerCase() === canonicalNorm)
                    ) {
                        Reflect.deleteProperty(obj, aliasKey)
                    }
                }
            }
            return obj
        }
        return val
    },
    z
        .object({
            name: z.string().describe('The key/name or project number of the project to retrieve.'),
            project_number: relaxedNumber().optional(),
        })
        .strict()
)

export const ListProjectsSchemaMcp = z.object({}).strict()

export const ProjectOutputSchema = z
    .object({
        success: z.boolean().optional(),
        project: z
            .object({
                name: z.string(),
                path: z.string(),
                project_number: z.number().optional(),
            })
            .optional(),
        projects: z
            .record(
                z.string(),
                z.object({
                    path: z.string(),
                    project_number: z.number().optional(),
                })
            )
            .optional(),
        items: z.array(z.record(z.string(), z.unknown())).optional(),
        data: z.array(z.record(z.string(), z.unknown())).optional(),
        message: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
