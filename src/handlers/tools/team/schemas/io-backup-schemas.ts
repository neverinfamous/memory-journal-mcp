import { z } from 'zod'
import {
    ENTRY_TYPES,
    relaxedNumber,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    StrictProjectNumberSchema,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'

/** team_export_entries — strict */
export const TeamExportEntriesSchema = z.object({
    format: z.enum(['json', 'markdown']).optional().default('json'),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(5000).optional().default(100),
    project_number: StrictProjectNumberSchema.optional(),
    workspace_id: z.string().optional(),
})

/** team_export_entries — relaxed */
export const TeamExportEntriesSchemaMcp = z.object({
    format: z.string().optional().default('json'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    entry_type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber().optional().default(100),
    project_number: relaxedNumber().optional(),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

/** team_backup — strict */
export const TeamBackupSchema = z.object({
    name: z.string().optional(),
})

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

