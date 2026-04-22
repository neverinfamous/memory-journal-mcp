/**
 * Team Backup Tools - 2 tools
 *
 * Tools: team_backup, team_list_backups
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_ERROR_RESPONSE } from './helpers.js'
import { TeamBackupSchema, TeamBackupOutputSchema, TeamBackupsListOutputSchema } from './schemas.js'
import * as path from 'node:path'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamBackupTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_backup',
            title: 'Backup Team Database',
            description: 'Create a timestamped backup of the team database. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamBackupSchema,
            outputSchema: TeamBackupOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

                    const input = TeamBackupSchema.parse(params)

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

                    return {
                        success: true,
                        message: 'Team database backup created successfully',
                        filename: result.filename,
                        path: path.basename(result.path),
                        sizeBytes: result.sizeBytes,
                    }
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
            inputSchema: z.object({}).strict(),
            outputSchema: TeamBackupsListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
            handler: (_params: unknown) => {
                try {
                    if (!teamDb) {
                        return { ...TEAM_DB_ERROR_RESPONSE }
                    }

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
                        hint:
                            backups.length === 0
                                ? 'No team backups found. Use team_backup to create one.'
                                : undefined,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
