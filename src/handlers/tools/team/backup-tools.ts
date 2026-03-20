/**
 * Team Backup Tools - 2 tools
 *
 * Tools: team_backup, team_list_backups
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { TEAM_DB_NOT_CONFIGURED } from './helpers.js'
import { TeamBackupSchema, TeamBackupOutputSchema, TeamBackupsListOutputSchema } from './schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamBackupTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_backup',
            title: 'Backup Team Database',
            description:
                'Create a timestamped backup of the team database. Requires TEAM_DB_PATH.',
            group: 'team',
            inputSchema: TeamBackupSchema,
            outputSchema: TeamBackupOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) {
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const input = TeamBackupSchema.parse(params)
                    const result = await teamDb.exportToFile(input.name)

                    return {
                        success: true,
                        message: 'Team database backup created successfully',
                        filename: result.filename,
                        path: result.path,
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
                        return { success: false, error: TEAM_DB_NOT_CONFIGURED }
                    }

                    const backups = teamDb.listBackups()

                    return {
                        success: true,
                        backups,
                        total: backups.length,
                        backupsDirectory: teamDb.getBackupsDir(),
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
