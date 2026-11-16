import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal } from '../../utils/security-utils.js'
import { ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'
import { acquireRestoreLock } from './restore-lock.js'
import {
    applySwappedDatabase,
    countActiveEntries,
    prepareRestoreTempFiles,
    releaseRestoreLock,
    resolveValidatedRestorePath,
    rollbackFailedRestore,
    unlinkBestEffort,
    writeVerifiedBackupFile,
} from './backup-helpers.js'

/** Maximum length for user-supplied backup names after sanitization */
const MAX_BACKUP_NAME_LENGTH = 50

export class BackupManager {
    constructor(private ctx: IDatabaseConnection) {}

    async exportToFile(
        backupName?: string
    ): Promise<{ filename: string; path: string; sizeBytes: number }> {
        if (this.ctx.getDbPath() === ':memory:') {
            throw new Error(
                "Backup failed: cannot export file backup from an in-memory (':memory:') database"
            )
        }
        const backupsDir = this.ctx.getBackupsDir()

        if (backupName) {
            assertNoPathTraversal(backupName)
        }

        if (!fs.existsSync(backupsDir)) {
            await fs.promises.mkdir(backupsDir, { recursive: true })
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const sanitizedName = backupName
            ? backupName.replace(/[/\\:*?"<>|]/g, '_').slice(0, MAX_BACKUP_NAME_LENGTH)
            : `backup_${timestamp}`
        const filename = `${sanitizedName}.db`
        const backupPath = path.join(backupsDir, filename)

        await writeVerifiedBackupFile(this.ctx, backupPath)
        const stats = await fs.promises.stat(backupPath)

        logger.info('Backup created', {
            module: 'SqliteAdapter',
            operation: 'exportToFile',
            context: { backupPath, sizeBytes: stats.size },
        })

        return { filename, path: backupPath, sizeBytes: stats.size }
    }

    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[] {
        const backupsDir = this.ctx.getBackupsDir()

        if (!fs.existsSync(backupsDir)) {
            return []
        }

        const files = fs.readdirSync(backupsDir)
        const backups: { filename: string; path: string; sizeBytes: number; createdAt: string }[] =
            []

        for (const filename of files) {
            if (!filename.endsWith('.db')) continue

            const filePath = path.join(backupsDir, filename)
            try {
                const stats = fs.statSync(filePath)
                if (stats.isFile()) {
                    backups.push({
                        filename,
                        path: filePath,
                        sizeBytes: stats.size,
                        createdAt: stats.birthtime.toISOString(),
                    })
                }
            } catch (error: unknown) {
                logger.warning('Failed to read backup file stats', {
                    module: 'SqliteAdapter',
                    operation: 'listBackups',
                    filename,
                    error: error instanceof Error ? error.message : 'Unknown error',
                })
            }
        }

        backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        return backups
    }

    deleteOldBackups(keepCount: number): { deleted: string[]; failed: string[]; kept: number } {
        const backups = this.listBackups()

        if (keepCount < 1 || Number.isNaN(keepCount)) {
            throw new ValidationError('keepCount must be at least 1')
        }

        const toKeep = backups.slice(0, keepCount)
        const toDelete = backups.slice(keepCount)
        const deleted: string[] = []
        const failed: string[] = []

        for (const backup of toDelete) {
            try {
                fs.unlinkSync(backup.path)
                deleted.push(backup.filename)
            } catch (error: unknown) {
                logger.warning('Failed to delete old backup', {
                    module: 'SqliteAdapter',
                    operation: 'deleteOldBackups',
                    filename: backup.filename,
                    error: error instanceof Error ? error.message : 'Unknown error',
                })
                failed.push(backup.filename)
            }
        }

        logger.info('Old backups cleaned up', {
            module: 'SqliteAdapter',
            operation: 'deleteOldBackups',
            context: { kept: toKeep.length, deleted: deleted.length, failed: failed.length },
        })

        return { deleted, failed, kept: toKeep.length }
    }

    async restoreFromFile(
        filename: string,
        runtime?: unknown
    ): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        const backupsDir = this.ctx.getBackupsDir()
        const backupPath = await resolveValidatedRestorePath(backupsDir, filename)

        const lockDir = `${this.ctx.getDbPath()}.lock.d`
        const lockFile = path.join(lockDir, 'lock.json')
        acquireRestoreLock(lockDir, lockFile, runtime)

        try {
            const previousEntryCount = countActiveEntries(this.ctx)
            this.ctx.closeDbBeforeRestore()
            await this.swapDatabase(backupPath)
            const newEntryCount = countActiveEntries(this.ctx)

            logger.info('Database restored from backup', {
                module: 'SqliteAdapter',
                operation: 'restoreFromFile',
                context: { backupPath, previousEntryCount, newEntryCount },
            })

            return { restoredFrom: filename, previousEntryCount, newEntryCount }
        } finally {
            releaseRestoreLock(lockDir, lockFile)
        }
    }

    /** Swap the backup into place, re-initialize and verify; roll back to the pre-restore copy on failure. */
    private async swapDatabase(backupPath: string): Promise<void> {
        const oldDbBackupPath = `${this.ctx.getDbPath()}.old_tmp_${randomUUID()}`
        const tempDbPath = `${this.ctx.getDbPath()}.restore_tmp_${randomUUID()}`
        await prepareRestoreTempFiles(this.ctx, backupPath, tempDbPath, oldDbBackupPath)

        try {
            await applySwappedDatabase(this.ctx, tempDbPath)
            await unlinkBestEffort(oldDbBackupPath)
            await unlinkBestEffort(tempDbPath)
        } catch (error) {
            await rollbackFailedRestore(this.ctx, oldDbBackupPath, tempDbPath, error)
        }
    }
}
