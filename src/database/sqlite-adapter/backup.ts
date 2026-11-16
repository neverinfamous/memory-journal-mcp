import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal } from '../../utils/security-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'
import { acquireRestoreLock } from './restore-lock.js'
import { applySqlCipherKey } from './sqlcipher-key.js'

/** Unlink a file, ignoring a missing file (ENOENT) and logging any other failure at debug. */
async function unlinkBestEffort(filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.debug('Best-effort file cleanup failed', {
                module: 'BackupManager',
                path: filePath,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

/** Maximum length for user-supplied backup names after sanitization */
const MAX_BACKUP_NAME_LENGTH = 50

async function assertIncomingBackupIntact(backupPath: string): Promise<void> {
    try {
        const Database = (await import('better-sqlite3')).default
        const tempDb = new Database(backupPath, { fileMustExist: true, readonly: true })
        try {
            applySqlCipherKey(tempDb)

            const tempStmt = tempDb.prepare('PRAGMA integrity_check')
            const result = tempStmt.get() as Record<string, unknown> | undefined
            const integrityResult = Object.values(result ?? {})[0]
            if (integrityResult !== 'ok') {
                throw new Error(`Integrity check failed: ${String(integrityResult)}`)
            }
        } finally {
            tempDb.close()
        }
    } catch (err) {
        throw new Error(
            `Incoming backup file is invalid or corrupt. Rejecting restore. Details: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err }
        )
    }
}

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

        const rawEncryptionKey =
            process.env['MJ_DB_ENCRYPTION_KEY'] ?? process.env['DB_ENCRYPTION_KEY']
        const isEncrypted = rawEncryptionKey !== undefined && rawEncryptionKey !== ''
        const nativeDb = !isEncrypted ? this.ctx.getNativeDb?.() : undefined

        if (nativeDb !== undefined) {
            try {
                await nativeDb.backup(backupPath)
                await assertIncomingBackupIntact(backupPath)
            } catch (backupErr) {
                await unlinkBestEffort(backupPath)
                throw backupErr
            }
        } else {
            try {
                if (typeof this.ctx.getNativeDb === 'function') {
                    const ckpt: unknown = this.ctx.getNativeDb().pragma('wal_checkpoint(TRUNCATE)')
                    const firstRow: unknown = Array.isArray(ckpt) ? ckpt[0] : undefined
                    const busy =
                        typeof firstRow === 'object' &&
                        firstRow !== null &&
                        'busy' in firstRow &&
                        typeof firstRow.busy === 'number'
                            ? firstRow.busy
                            : 0
                    if (busy !== 0) {
                        throw new Error(
                            `WAL checkpoint incomplete (busy=${String(busy)}), backup aborted to prevent stale data`
                        )
                    }
                } else {
                    this.ctx.pragma('wal_checkpoint(TRUNCATE)')
                }
            } catch (checkpointErr) {
                const err =
                    checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr)
                logger.error('WAL checkpoint failed, aborting backup', {
                    module: 'SqliteAdapter',
                    operation: 'exportToFile',
                    error: err,
                })
                throw new Error(
                    `WAL checkpoint failed, backup aborted to prevent stale data: ${err}`,
                    {
                        cause: checkpointErr,
                    }
                )
            }
            await fs.promises.copyFile(this.ctx.getDbPath(), backupPath)
            try {
                await assertIncomingBackupIntact(backupPath)
            } catch (verifyErr) {
                await unlinkBestEffort(backupPath)
                throw verifyErr
            }
        }

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
        assertNoPathTraversal(filename)

        const backupsDir = this.ctx.getBackupsDir()
        const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
        const resolvedBackupsDir = path.resolve(backupsDir)
        const backupPath = path.resolve(backupsDir, filename)
        const relToBackups = path.relative(fold(resolvedBackupsDir), fold(backupPath))

        if (relToBackups.startsWith(`..${path.sep}`) || relToBackups === '..' || path.isAbsolute(relToBackups)) {
            throw new ValidationError(`Path traversal detected during restore resolution.`)
        }

        let stat
        try {
            stat = await fs.promises.lstat(backupPath)
        } catch (e: unknown) {
            if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
                throw new ResourceNotFoundError('Backup', filename)
            }
            throw e
        }
        if (stat.isSymbolicLink()) {
            throw new ValidationError('Symlinks are not allowed for backup restore.')
        }

        const realBackupPath = await fs.promises.realpath(backupPath)
        const realBackupsDir = await fs.promises.realpath(backupsDir)
        const realRel = path.relative(fold(realBackupsDir), fold(realBackupPath))
        if (realRel.startsWith(`..${path.sep}`) || realRel === '..' || path.isAbsolute(realRel)) {
            throw new ValidationError('Resolved backup path escapes the backups directory.')
        }

        await assertIncomingBackupIntact(backupPath)

        const lockDir = `${this.ctx.getDbPath()}.lock.d`
        const lockFile = path.join(lockDir, 'lock.json')
        acquireRestoreLock(lockDir, lockFile, runtime)

        try {
            const currentCountResult = this.ctx.exec(
                'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL'
            )
            const previousEntryCount = (currentCountResult[0]?.values[0]?.[0] as number) ?? 0

            // Close old DB via manager
            this.ctx.closeDbBeforeRestore()

            await this.swapDatabase(backupPath)

            const newCountResult = this.ctx.exec(
                'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL'
            )
            const newEntryCount = (newCountResult[0]?.values[0]?.[0] as number) ?? 0

            logger.info('Database restored from backup', {
                module: 'SqliteAdapter',
                operation: 'restoreFromFile',
                context: { backupPath, previousEntryCount, newEntryCount },
            })

            return { restoredFrom: filename, previousEntryCount, newEntryCount }
        } finally {
            try {
                fs.unlinkSync(lockFile)
                fs.rmdirSync(lockDir)
            } catch (err: unknown) {
                logger.warning('Failed to release OS lock directory during restore', {
                    path: lockDir,
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        }
    }

    /** Swap the backup into place, re-initialize and verify; roll back to the pre-restore copy on failure. */
    private async swapDatabase(backupPath: string): Promise<void> {
        const oldDbBackupPath = `${this.ctx.getDbPath()}.old_tmp_${randomUUID()}`
        const tempDbPath = `${this.ctx.getDbPath()}.restore_tmp_${randomUUID()}`
        await fs.promises.copyFile(backupPath, tempDbPath)

        try {
            // Copy current DB out of the way for rollback (bypasses Windows EBUSY locks on rename)
            await fs.promises.copyFile(this.ctx.getDbPath(), oldDbBackupPath)

            try {
                // Attempt atomic swap of new DB into place
                await fs.promises.rename(tempDbPath, this.ctx.getDbPath())
            } catch (renameErr) {
                // Fallback to copyFile if atomic rename fails (e.g., Windows EBUSY or cross-device links)
                logger.debug('Atomic rename failed during restore swap; falling back to copyFile', {
                    module: 'SqliteAdapter',
                    operation: 'restoreFromFile',
                    error: renameErr instanceof Error ? renameErr.message : String(renameErr),
                })
                await fs.promises.copyFile(tempDbPath, this.ctx.getDbPath())
                await unlinkBestEffort(tempDbPath)
            }

            await unlinkBestEffort(`${this.ctx.getDbPath()}-wal`)
            await unlinkBestEffort(`${this.ctx.getDbPath()}-shm`)

            // Re-initialize using the connection's standard initialize method
            // This ensures extensions like sqlite-vec are properly loaded
            await this.ctx.initialize()

            // Run explicit integrity check
            const integrityResult = this.ctx.exec('PRAGMA integrity_check')
            if (integrityResult[0]?.values[0]?.[0] !== 'ok') {
                throw new Error(
                    `Integrity check failed: ${String(integrityResult[0]?.values[0]?.[0])}`
                )
            }

            // Success: clean up old DB backup
            await unlinkBestEffort(oldDbBackupPath)
            await unlinkBestEffort(tempDbPath)
        } catch (error) {
            logger.error('Restore failed, rolling back to pre-restore backup using copy', {
                module: 'SqliteAdapter',
                operation: 'restoreFromFile',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
            // Close DB to ensure handles are released before rollback
            this.ctx.closeDbBeforeRestore()
            // Rollback using copy to bypass EBUSY
            let rollbackSuccess = false
            try {
                await fs.promises.copyFile(oldDbBackupPath, this.ctx.getDbPath())
                await unlinkBestEffort(`${this.ctx.getDbPath()}-wal`)
                await unlinkBestEffort(`${this.ctx.getDbPath()}-shm`)
                rollbackSuccess = true
            } catch (rollbackErr) {
                if ((rollbackErr as NodeJS.ErrnoException).code !== 'ENOENT') {
                    logger.error('Rollback copy failed', { error: rollbackErr })
                }
            }

            // Best-effort cleanup of temp files
            if (rollbackSuccess) {
                await unlinkBestEffort(oldDbBackupPath)
            }
            await unlinkBestEffort(tempDbPath)

            if (!rollbackSuccess) {
                throw new Error(
                    `CRITICAL: Database restore failed AND rollback failed. The database may be in an inconsistent state. Your previous database is preserved at: ${oldDbBackupPath}. Original error: ${error instanceof Error ? error.message : String(error)}`,
                    { cause: error }
                )
            }

            await this.ctx.initialize()
            throw error
        }
    }
}
