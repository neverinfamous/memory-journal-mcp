import { z } from 'zod'
import { relaxedNumber } from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'

export const SearchAuditLogSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) }
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
            return obj
        }
        return val
    },
    z
        .object({
            tool_name: z.string().optional(),
            user: z.string().optional(),
            date_range: z
                .object({
                    start: z.string().optional(),
                    end: z.string().optional(),
                })
                .optional(),
            status: z.boolean().optional(),
            category: z.enum(['read', 'write', 'admin', 'team', 'audit']).optional(),
            limit: z.number().min(1).max(1000).optional().default(100),
            project_number: z.number().int().optional(),
        })
        .strict()
)

export const RunAutoPruneSchema = z
    .object({
        dry_run: z.boolean().optional().default(false),
        archive_older_than_days: z.number().min(0).optional(),
        prune_older_than_days: z.number().min(0).optional(),
        hard_delete_older_than_days: z.number().min(0).optional(),
        importance_threshold: z.number().min(0).max(1).optional(),
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
    })
    .strict()

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

export const RegisterProjectSchemaMcp = z
    .object({
        name: z.string().describe('The key/name of the project in the registry.'),
        absolute_path: z.string().describe('The absolute path to the local repository.'),
        project_number: relaxedNumber()
            .optional()
            .describe('The GitHub Project number, if applicable.'),
    })
    .strict()

export const UpdateProjectSchemaMcp = z
    .object({
        name: z.string().describe('The current key/name of the project.'),
        new_name: z.string().optional().describe('The new key/name for the project (if renaming).'),
        absolute_path: z
            .string()
            .optional()
            .describe('The new absolute path to the local repository.'),
        project_number: relaxedNumber().optional().describe('The new GitHub Project number.'),
    })
    .strict()

export const DeleteProjectSchemaMcp = z
    .object({
        name: z.string().describe('The key/name of the project to delete.'),
    })
    .strict()

export const GetProjectSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) }
            if (!('name' in obj)) {
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
