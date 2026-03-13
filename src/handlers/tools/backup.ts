/**
 * Backup Tool Group - 4 tools
 *
 * Tools: backup_journal, list_backups, restore_backup, cleanup_backups
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerErrorResponse } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { relaxedNumber } from './schemas.js'
import { ErrorResponseFields } from './error-response-fields.js'
import { logger } from '../../utils/logger.js'

// ============================================================================
// Output Schemas
// ============================================================================

const BackupResultOutputSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    filename: z.string().optional(),
    path: z.string().optional(),
    sizeBytes: z.number().optional(),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

const BackupInfoSchema = z.object({
    filename: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
    createdAt: z.string(),
})

const BackupsListOutputSchema = z.object({
    success: z.boolean().optional(),
    backups: z.array(BackupInfoSchema).optional(),
    total: z.number().optional(),
    backupsDirectory: z.string().optional(),
    hint: z.string().optional(),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

const RestoreResultOutputSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    restoredFrom: z.string().optional(),
    previousEntryCount: z.number().optional(),
    newEntryCount: z.number().optional(),
    warning: z.string().optional(),
    revertedChanges: z
        .object({
            tagMerges: z.string().optional(),
            entries: z.string().optional(),
        })
        .optional(),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

const CleanupBackupsOutputSchema = z.object({
    success: z.boolean(),
    deleted: z.array(z.string()).optional(),
    deletedCount: z.number().optional(),
    keptCount: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
}).extend(ErrorResponseFields.shape)

// ============================================================================
// Tool Definitions
// ============================================================================

export function getBackupTools(context: ToolContext): ToolDefinition[] {
    const { db, progress } = context
    return [
        {
            name: 'backup_journal',
            title: 'Backup Journal Database',
            description:
                'Create a timestamped backup of the journal database. Backups are stored in the backups/ directory.',
            group: 'backup',
            inputSchema: z.object({
                name: z
                    .string()
                    .optional()
                    .describe('Custom backup name (optional, defaults to timestamp)'),
            }),
            outputSchema: BackupResultOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            name: z.string().optional(),
                        })
                        .parse(params)
                    const result = await db.exportToFile(input.name)
                    return {
                        success: true,
                        message: `Backup created successfully`,
                        filename: result.filename,
                        path: result.path,
                        sizeBytes: result.sizeBytes,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
        {
            name: 'list_backups',
            title: 'List Journal Backups',
            description: 'List all available backup files with their sizes and creation dates',
            group: 'backup',
            inputSchema: z.object({}).strict(),
            outputSchema: BackupsListOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true },
            handler: (_params: unknown) => {
                try {
                    const backups = db.listBackups()
                    return {
                        backups,
                        total: backups.length,
                        backupsDirectory: db.getBackupsDir(),
                        hint:
                            backups.length === 0
                                ? 'No backups found. Use backup_journal to create one.'
                                : undefined,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
        {
            name: 'restore_backup',
            title: 'Restore Journal from Backup',
            description:
                'Restore the journal database from a backup file. WARNING: This replaces all current data. An automatic backup is created before restore.',
            group: 'backup',
            inputSchema: z.object({
                filename: z
                    .string()
                    .describe('Backup filename to restore from (e.g., backup_2025-01-01.db)'),
                confirm: z
                    .literal(true)
                    .describe('Must be set to true to confirm the restore operation'),
            }),
            outputSchema: RestoreResultOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            filename: z.string(),
                            confirm: z.literal(true),
                        })
                        .parse(params)

                    // Capture progress context values BEFORE any async operations
                    const progressServer = progress?.server
                    const progressTokenValue = progress?.progressToken

                    await sendProgress(progress, 1, 3, 'Preparing restore...')
                    await sendProgress(progress, 2, 3, 'Restoring database from backup...')
                    const result = await db.restoreFromFile(input.filename)

                    // Send directly using captured primitives (db.restoreFromFile reinitializes DB)
                    if (progressServer !== undefined && progressTokenValue !== undefined) {
                        try {
                            await progressServer.notification({
                                method: 'notifications/progress' as const,
                                params: {
                                    progressToken: progressTokenValue,
                                    progress: 3,
                                    total: 3,
                                    message: 'Restore complete',
                                },
                            })
                        } catch (error) {
                            logger.debug('Failed to send restore progress notification', {
                                module: 'TOOL',
                                operation: 'restore-backup',
                                error,
                            })
                        }
                    }

                    return {
                        success: true,
                        message: `Database restored from ${input.filename}`,
                        restoredFrom: result.restoredFrom,
                        previousEntryCount: result.previousEntryCount,
                        newEntryCount: result.newEntryCount,
                        warning:
                            'A pre-restore backup was automatically created. Any changes made since this backup (including tag merges, new entries, and relationships) have been reverted.',
                        revertedChanges: {
                            tagMerges:
                                'Any merge_tags operations since this backup are reverted. Previously merged tags will reappear as separate tags.',
                            entries:
                                result.previousEntryCount !== result.newEntryCount
                                    ? `Entry count changed from ${String(result.previousEntryCount)} to ${String(result.newEntryCount)}`
                                    : undefined,
                        },
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
        {
            name: 'cleanup_backups',
            title: 'Cleanup Old Backups',
            description:
                'Delete old backup files, keeping only the most recent N backups. Use list_backups to preview before cleanup.',
            group: 'backup',
            inputSchema: z.object({
                keep_count: relaxedNumber()
                    .default(5)
                    .describe('Number of most recent backups to keep (default: 5)'),
            }),
            outputSchema: CleanupBackupsOutputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false },
            handler: (params: unknown) => {
                try {
                    const { keep_count } = z
                        .object({ keep_count: z.number().min(1).default(5) })
                        .parse(params)

                    const result = db.deleteOldBackups(keep_count)

                    return {
                        success: true,
                        deleted: result.deleted,
                        deletedCount: result.deleted.length,
                        keptCount: result.kept,
                        message:
                            result.deleted.length > 0
                                ? `Deleted ${String(result.deleted.length)} old backup(s), kept ${String(result.kept)}`
                                : `No backups to delete. Currently have ${String(result.kept)} backup(s).`,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
