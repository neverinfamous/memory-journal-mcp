import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal, PathTraversalError } from '../../utils/security-utils.js'
import { ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'
import { acquireRestoreLock } from './restore-lock.js'
import {
    applySwappedDatabase,
    assertWalCheckpointComplete,
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
const WIN_RESERVED_BACKUP_RE =
    /^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\s*\..*)?\s*$/i
const ENCODED_TRAVERSAL_RE = /%(?:2f|5c|2e|00)/i

interface BackupEntry {
    filename: string
    path: string
    sizeBytes: number
    createdAt: string
}

export class BackupManager {
    private cachedBackupsDir: string | null = null
    private cachedBackupsDirMtimeNs = -1n
    private cachedBackups: BackupEntry[] | null = null

    constructor(private ctx: IDatabaseConnection) {}

    private invalidateBackupsCache(): void {
        this.cachedBackups = null
        this.cachedBackupsDirMtimeNs = -1n
    }

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
            if (backupName.includes('\0') || ENCODED_TRAVERSAL_RE.test(backupName)) {
                throw new ValidationError('Invalid or unsafe backup filename.')
            }
            assertNoPathTraversal(backupName)
            if (backupName.includes(':') || WIN_RESERVED_BACKUP_RE.test(backupName.trim())) {
                throw new PathTraversalError(backupName)
            }
        }

        if (!fs.existsSync(backupsDir)) {
            await fs.promises.mkdir(backupsDir, { recursive: true })
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const rawSanitized = backupName
            ? backupName
                  .replace(/\0/g, '')
                  .replace(/[/\\:*?"<>|]/g, '_')
                  .replace(/\.{2,}/g, '')
                  .replace(/\.+$/g, '')
                  .slice(0, MAX_BACKUP_NAME_LENGTH)
                  .replace(/\.+$/g, '')
            : ''
        if (rawSanitized.length > 0 && WIN_RESERVED_BACKUP_RE.test(rawSanitized)) {
            throw new PathTraversalError(backupName ?? rawSanitized)
        }
        const sanitizedName = rawSanitized.length > 0 ? rawSanitized : `backup_${timestamp}`
        const filename = `${sanitizedName}.db`
        const backupPath = path.join(backupsDir, filename)

        await writeVerifiedBackupFile(this.ctx, backupPath)
        this.invalidateBackupsCache()
        const stats = await fs.promises.stat(backupPath)

        logger.info('Backup created', {
            module: 'SqliteAdapter',
            operation: 'exportToFile',
            context: { backupPath, sizeBytes: stats.size },
        })

        return { filename, path: backupPath, sizeBytes: stats.size }
    }

    listBackups(): BackupEntry[] {
        const backupsDir = this.ctx.getBackupsDir()
        const dirStats = fs.statSync(backupsDir, { bigint: true, throwIfNoEntry: false })
        if (dirStats === undefined) {
            this.invalidateBackupsCache()
            return []
        }

        if (
            this.cachedBackups !== null &&
            this.cachedBackupsDir === backupsDir &&
            this.cachedBackupsDirMtimeNs === dirStats.mtimeNs
        ) {
            return this.cachedBackups.slice()
        }

        const dirents = fs.readdirSync(backupsDir, { withFileTypes: true })
        const backups: BackupEntry[] = []

        for (const dirent of dirents) {
            const filename = dirent.name
            if (!/\.db$/i.test(filename)) continue
            if (!dirent.isFile()) continue

            const filePath = path.join(backupsDir, filename)
            try {
                const stats = fs.lstatSync(filePath)
                if (stats.isFile() && !stats.isSymbolicLink()) {
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

        backups.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0))
        this.cachedBackupsDir = backupsDir
        this.cachedBackupsDirMtimeNs = dirStats.mtimeNs
        this.cachedBackups = backups
        return backups.slice()
    }

    private sweepStaleTempFiles(backupsDir: string, maxAgeMs = 15 * 60 * 1000): void {
        let dirents: fs.Dirent[]
        try {
            dirents = fs.readdirSync(backupsDir, { withFileTypes: true })
        } catch {
            return
        }
        const cutoffMs = Date.now() - maxAgeMs
        for (const dirent of dirents) {
            if (!/\.tmp(?:-(?:wal|shm))?$/i.test(dirent.name) || !dirent.isFile()) continue
            const filePath = path.join(backupsDir, dirent.name)
            try {
                const stats = fs.lstatSync(filePath)
                if (stats.isFile() && !stats.isSymbolicLink() && stats.mtimeMs <= cutoffMs) {
                    fs.unlinkSync(filePath)
                }
            } catch {
                // Best-effort orphan sweep (ignore ENOENT or active locks)
            }
        }
    }

    deleteOldBackups(keepCount: number): { deleted: string[]; failed: string[]; kept: number } {
        if (keepCount < 1 || Number.isNaN(keepCount)) {
            throw new ValidationError('keepCount must be at least 1')
        }

        const backupsDir = this.ctx.getBackupsDir()
        this.sweepStaleTempFiles(backupsDir)

        const regularBackups = this.listBackups().filter(
            (backup) => !backup.filename.startsWith('pre-prune-')
        )

        const toKeep = regularBackups.slice(0, keepCount)
        const toDelete = regularBackups.slice(keepCount)
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
        if (deleted.length > 0) {
            this.invalidateBackupsCache()
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
        if (this.ctx.getDbPath() === ':memory:') {
            throw new ValidationError(
                "Restore failed: cannot restore file backup into an in-memory (':memory:') database"
            )
        }
        const backupsDir = this.ctx.getBackupsDir()
        const backupPath = await resolveValidatedRestorePath(backupsDir, filename)

        const lockDir = `${this.ctx.getDbPath()}.lock.d`
        const lockFile = path.join(lockDir, 'lock.json')
        acquireRestoreLock(lockDir, lockFile, runtime)

        try {
            const previousEntryCount = countActiveEntries(this.ctx)
            assertWalCheckpointComplete(this.ctx)
            this.ctx.closeDbBeforeRestore()
            await this.swapDatabase(backupPath)
            this.invalidateBackupsCache()
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
