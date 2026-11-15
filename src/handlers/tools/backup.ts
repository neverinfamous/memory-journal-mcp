/**
 * Backup Tool Group - 4 tools
 *
 * Tools: backup_journal, list_backups, restore_backup, cleanup_backups
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { sendProgress } from '../../utils/progress-utils.js'
import { relaxedNumber } from './schemas.js'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { logger } from '../../utils/logger.js'
import * as path from 'node:path'
import { ValidationError } from '../../types/errors.js'

// ============================================================================
// Output Schemas
// ============================================================================

const BackupResultOutputSchema = z
    .object({
        success: z.boolean(),
        message: z.string().optional(),
        filename: z.string().optional(),
        path: z.string().optional(),
        sizeBytes: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const BackupInfoSchema = z.object({
    filename: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
    createdAt: z.string(),
})

const BackupsListOutputSchema = z
    .object({
        success: z.boolean().optional(),
        backups: z.array(BackupInfoSchema).optional(),
        total: z.number().optional(),
        backupsDirectory: z.string().optional(),
        hint: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

const RestoreResultOutputSchema = z
    .object({
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
    })
    .extend(ErrorFieldsMixin.shape)

const CleanupBackupsOutputSchema = z
    .object({
        success: z.boolean(),
        deleted: z.array(z.string()).optional(),
        failed: z.array(z.string()).optional(),
        deletedCount: z.number().optional(),
        keptCount: z.number().optional(),
        warning: z.string().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Tool Definitions
// ============================================================================

export function getBackupTools(context: ToolContext): ToolDefinition[] {
    const { db, progress, config, vectorManager } = context
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
                    .describe('Custom backup name (optional, defaults to timestamp). Anti-Hallucination Hint: You can use positional args like mj.backup.backupJournal("my_name").'),
                compress: z
                    .boolean()
                    .optional()
                    .describe('Anti-Hallucination Hint: Compression is natively handled by the database engine. This parameter is safely ignored.'),
            }).strict(),
            outputSchema: BackupResultOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            name: z.string().optional(),
                            compress: z.boolean().optional(),
                        }).strict()
                        .parse(params)
                    await sendProgress(progress, 0, 2, 'Creating backup...')
                    const result = await db.exportToFile(input.name)
                    await sendProgress(progress, 2, 2, 'Backup complete')
                    return {
                        success: true,
                        message:
                            input.compress === undefined
                                ? `Backup created successfully`
                                : `Backup created successfully (the 'compress' parameter was ignored; compression is handled by the database engine)`,
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
            name: 'list_backups',
            title: 'List Journal Backups',
            description: 'List all available backup files with their sizes and creation dates',
            group: 'backup',
            inputSchema: z.object({}).strict(),
            outputSchema: BackupsListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (_params: unknown) => {
                try {
                    const backups = db.listBackups()
                    const maskedBackups = backups.map((b) => ({
                        ...b,
                        path: path.basename(b.path),
                    }))
                    return {
                        backups: maskedBackups,
                        total: backups.length,
                        backupsDirectory: path.basename(db.getBackupsDir()),
                        hint:
                            backups.length === 0
                                ? 'No backups found. Use backup_journal to create one.'
                                : undefined,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'restore_backup',
            title: 'Restore Journal from Backup',
            description:
                'Restore the journal database from a backup file. WARNING: This replaces all current data. Enforce single-writer / single-instance only for restore-capable deployments. An automatic backup is created before restore.',
            group: 'backup',
            inputSchema: z.object({
                filename: z
                    .string()
                    .optional()
                    .describe('Backup filename to restore from (e.g., backup_2025-01-01.db). Anti-Hallucination Hint: Property is strictly `filename`, not `file`. You can pass positional args: mj.backup.restoreBackup("filename.db", true).'),
                confirm: z
                    .boolean()
                    .optional()
                    .describe('Must be set to true to confirm the restore operation'),
            }).strict(),
            outputSchema: RestoreResultOutputSchema,
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            filename: z.string().min(1, 'filename cannot be empty'),
                            confirm: z.boolean().optional(),
                        }).strict()
                        .parse(params)

                    if (!input.confirm) {
                        return {
                            success: false,
                            error: 'Restore requires confirm: true. This operation replaces all current data.',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Set confirm: true to proceed with restore',
                            recoverable: true,
                        }
                    }

                    if (
                        input.filename.includes('..') ||
                        input.filename.includes('/') ||
                        input.filename.includes('\\') ||
                        input.filename.includes('\0')
                    ) {
                        throw new ValidationError('Invalid backup filename', {
                            filename: input.filename,
                        })
                    }

                    // Capture progress context values BEFORE any async operations
                    const progressServer = progress?.server
                    const progressTokenValue = progress?.progressToken

                    await sendProgress(progress, 0, 3, 'Validating backup...')
                    await sendProgress(progress, 1, 3, 'Preparing restore...')
                    await sendProgress(progress, 2, 3, 'Restoring database from backup...')

                    if (config?.runtime?.maintenanceManager) {
                        await config.runtime.maintenanceManager.acquireMaintenanceLock()
                    }
                    let preRestoreBackup
                    let result
                    try {
                        // [INVARIANT] C10: Create an automatic pre-restore backup inside the
                        // maintenance lock before replacing database contents; abort if it fails.
                        preRestoreBackup = await db.exportToFile(
                            `pre_restore_${String(Date.now())}`
                        )
                        result = await db.restoreFromFile(input.filename, config?.runtime)
                    } finally {
                        if (config?.runtime?.maintenanceManager) {
                            config.runtime.maintenanceManager.releaseMaintenanceLock()
                        }
                    }

                    let vectorWarningSuffix = ''
                    if (vectorManager?.isInitialized() === true) {
                        try {
                            const rebuildRes = await vectorManager.rebuildIndex()
                            if (!rebuildRes.success || rebuildRes.failed > 0) {
                                const detail =
                                    rebuildRes.firstError ??
                                    `${String(rebuildRes.failed)} entries failed embedding`
                                logger.warning('Vector index rebuild after restore was incomplete', {
                                    module: 'TOOL',
                                    operation: 'restore-backup',
                                    failed: rebuildRes.failed,
                                    error: detail,
                                })
                                vectorWarningSuffix = ` Vector index rebuild had errors (${detail}); run rebuild_vector_index manually.`
                            }
                        } catch (vectorErr: unknown) {
                            const msg =
                                vectorErr instanceof Error
                                    ? vectorErr.message
                                    : String(vectorErr)
                            logger.warning('Failed to rebuild vector index after restore', {
                                module: 'TOOL',
                                operation: 'restore-backup',
                                error: msg,
                            })
                            vectorWarningSuffix = ` Vector index rebuild failed (${msg}); run rebuild_vector_index manually.`
                        }
                    }

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

                    const backupLabel = preRestoreBackup?.filename ?? 'pre-restore backup'

                    return {
                        success: true,
                        message: `Database restored from ${input.filename} (pre-restore backup: ${backupLabel})`,
                        restoredFrom: result.restoredFrom,
                        previousEntryCount: result.previousEntryCount,
                        newEntryCount: result.newEntryCount,
                        warning:
                            `A pre-restore backup (${backupLabel}) was automatically created. Any changes made since this backup (including tag merges, new entries, and relationships) have been reverted.${vectorWarningSuffix}`,
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
                    logger.error('CRITICAL RESTORE ERROR THROWN', { error: err instanceof Error ? err.stack : String(err) })
                    return formatHandlerError(err)
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
                    .describe('Number of most recent backups to keep (default: 5). Anti-Hallucination Hint: You can pass a string or number, or use positional args: mj.backup.cleanupBackups(5).'),
            }).strict(),
            outputSchema: CleanupBackupsOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { keep_count } = z
                        .object({ keep_count: relaxedNumber().default(5) }).strict()
                        .parse(params)

                    const keepCountNum = typeof keep_count === 'string' && keep_count.trim() !== '' ? Number(keep_count) : keep_count
                    if (typeof keepCountNum !== 'number' || !Number.isInteger(keepCountNum) || keepCountNum < 1) {
                        throw new ValidationError('keep_count must be a positive integer')
                    }

                    const result = db.deleteOldBackups(keepCountNum)
                    const hasFailed = result.failed !== undefined && result.failed.length > 0

                    return {
                        success: true,
                        deleted: result.deleted,
                        ...(hasFailed ? { failed: result.failed } : {}),
                        deletedCount: result.deleted.length,
                        keptCount: result.kept,
                        ...(hasFailed
                            ? {
                                  warning: `Failed to delete ${String(result.failed?.length ?? 0)} backup file(s).`,
                              }
                            : {}),
                        message:
                            result.deleted.length > 0
                                ? `Deleted ${String(result.deleted.length)} old backup(s), kept ${String(result.kept)}`
                                : `No backups to delete. Currently have ${String(result.kept)} backup(s).`,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
