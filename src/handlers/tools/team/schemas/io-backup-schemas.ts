import { z } from 'zod'
import {
    ENTRY_TYPES,
    relaxedNumber,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    StrictProjectNumberSchema,
} from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { TeamEntryOutputSchema } from './core-search-schemas.js'

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

/** team_backup — strict */
export const TeamBackupSchema = z.object({
    name: z.string().optional(),
    workspace_id: z.string().optional(),
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
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
    sort_by: z.string().optional().default('priority'),
})

function preprocessUpdateTeamFlag(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) }
        let modified = false
        if (('id' in obj || 'entry_id' in obj) && !('flag_id' in obj)) {
            obj['flag_id'] = obj['id'] ?? obj['entry_id']
            Reflect.deleteProperty(obj, 'id')
            Reflect.deleteProperty(obj, 'entry_id')
            modified = true
        }
        for (const key of ['keep', 'path', 'q', 'mode', 'text', 'description', 'content']) {
            if (key in obj && !('message' in obj)) {
                obj['message'] = obj[key]
                Reflect.deleteProperty(obj, key)
                modified = true
                break
            }
        }
        return modified ? obj : val
    }
    return val
}

/** update_team_flag — strict */
export const UpdateTeamFlagSchema = z.preprocess(
    preprocessUpdateTeamFlag,
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
    preprocessUpdateTeamFlag,
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
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'
        ),
})

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
