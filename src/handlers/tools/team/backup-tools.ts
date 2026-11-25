/**
 * Team Backup Tools - 2 tools
 *
 * Tools: team_backup, team_list_backups
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import {
    TeamBackupSchema,
    TeamBackupSchemaMcp,
    TeamBackupOutputSchema,
    TeamBackupsListOutputSchema,
} from './schemas.js'
import * as path from 'node:path'

// ============================================================================
// Tool Definitions
// ============================================================================

const TeamListBackupsStrictSchema = z
    .object({
        project_number: StrictProjectNumberSchema.optional(),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

async function executeTeamBackup(
    teamDb: NonNullable<ToolContext['teamDb']>,
    context: ToolContext,
    params: unknown
): Promise<unknown> {
    const input = TeamBackupSchema.parse(params ?? {})
    const progress = context.progress

    await sendProgress(progress, 0, 2, 'Creating team backup...')

    let result
    try {
        result = await teamDb.exportToFile(input.name)
    } catch (exportErr) {
        return {
            success: false,
            error: `Backup failed: ${exportErr instanceof Error ? exportErr.message : String(exportErr)}`,
            code: 'BACKUP_FAILED',
            category: 'system',
            suggestion:
                'Check file system permissions, available disk space, and ensure the backup directory is writable.',
            recoverable: false,
        }
    }

    await sendProgress(progress, 2, 2, 'Team backup complete')

    return {
        success: true,
        message: 'Team database backup created successfully',
        filename: result.filename,
        path: path.basename(result.path),
        sizeBytes: result.sizeBytes,
        ...(input.project_number !== undefined || input.workspace_id !== undefined
            ? { scopeNote: 'Database-wide team backup' }
            : {}),
    }
}

function executeTeamListBackups(
    teamDb: NonNullable<ToolContext['teamDb']>,
    params: unknown
): unknown {
    const parsed = TeamListBackupsStrictSchema.parse(params ?? {})

    const backups = teamDb.listBackups()
    const maskedBackups = backups.map((b) => ({
        ...b,
        path: path.basename(b.path),
    }))

    return {
        success: true,
        backups: maskedBackups,
        total: backups.length,
        backupsDirectory: path.basename(teamDb.getBackupsDir()),
        ...(parsed.project_number !== undefined || parsed.workspace_id !== undefined
            ? { scopeNote: 'Database-wide team backups' }
            : {}),
        hint:
            backups.length === 0
                ? 'No team backups found. Use team_backup to create one.'
                : undefined,
    }
}

export function getTeamBackupTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_backup',
            title: 'Backup Team Database',
            description: 'Create a timestamped backup of the team database. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamBackupSchemaMcp,
            outputSchema: TeamBackupOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            capabilities: {
                requiresAdminScope: true,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return await executeTeamBackup(teamDb, context, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_list_backups',
            title: 'List Team Backups',
            description:
                'List all available backup files for the team database. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: z
                .object({
                    project_number: relaxedNumber().optional(),
                    workspace_id: z.string().optional(),
                })
                .loose(),
            outputSchema: TeamBackupsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    return executeTeamListBackups(teamDb, params)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}

