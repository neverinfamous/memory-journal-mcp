import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal } from '../../utils/security-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'

/** Maximum length for user-supplied backup names after sanitization */
const MAX_BACKUP_NAME_LENGTH = 50

export class BackupManager {
    constructor(private ctx: IDatabaseConnection) {}

    async exportToFile(
        backupName?: string
    ): Promise<{ filename: string; path: string; sizeBytes: number }> {
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

        try {
            this.ctx.pragma('wal_checkpoint(TRUNCATE)')
        } catch (checkpointErr) {
            const err = checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr)
            logger.error('WAL checkpoint failed, aborting backup', {
                module: 'SqliteAdapter',
                operation: 'exportToFile',
                error: err,
            })
            throw new Error(`WAL checkpoint failed, backup aborted to prevent stale data: ${err}`, { cause: checkpointErr })
        }
        await fs.promises.copyFile(this.ctx.getDbPath(), backupPath)

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
                    error: error instanceof Error ? error.message : 'Unknown error'
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
                    error: error instanceof Error ? error.message : 'Unknown error'
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

    async restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        assertNoPathTraversal(filename)

        const backupsDir = this.ctx.getBackupsDir()
        const backupPath = path.resolve(backupsDir, filename)
        
        if (!backupPath.startsWith(path.resolve(backupsDir))) {
            throw new ValidationError(`Path traversal detected during restore resolution.`)
        }

        if (!fs.existsSync(backupPath)) {
            throw new ResourceNotFoundError('Backup', filename)
        }

        const stat = await fs.promises.lstat(backupPath)
        if (stat.isSymbolicLink()) {
            throw new ValidationError('Symlinks are not allowed for backup restore.')
        }

        const realBackupPath = await fs.promises.realpath(backupPath)
        const realBackupsDir = await fs.promises.realpath(backupsDir)
        if (!realBackupPath.startsWith(realBackupsDir)) {
            throw new ValidationError('Resolved backup path escapes the backups directory.')
        }

        try {
            // Dynamically import better-sqlite3 to avoid top-level require errors if mocked
            const Database = (await import('better-sqlite3')).default
            const tempDb = new Database(backupPath, { fileMustExist: true, readonly: true })
            const tempStmt = tempDb.prepare('PRAGMA integrity_check')
            const result = tempStmt.get() as Record<string, unknown>
            const integrityResult = Object.values(result ?? {})[0]
            if (integrityResult !== 'ok') {
                tempDb.close()
                throw new Error(`Integrity check failed: ${String(integrityResult)}`)
            }
            tempDb.close()
        } catch (err) {
            throw new Error(
                `Incoming backup file is invalid or corrupt. Rejecting restore. Details: ${err instanceof Error ? err.message : String(err)}`,
                { cause: err }
            )
        }


        const lockPath = `${this.ctx.getDbPath()}.lock`
        let lockFd: number
        const nonce = randomUUID()
        try {
            lockFd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR)
            fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce }))
        } catch (lockError: unknown) {
            if (typeof lockError === 'object' && lockError !== null && 'code' in lockError && (lockError as { code: unknown }).code === 'EEXIST') {
                let isStale = false
                try {
                    const lockContent = fs.readFileSync(lockPath, 'utf-8').trim()
                    if (lockContent) {
                        let holdingPid: number | undefined
                        let lockTimestamp: number | undefined
                        try {
                            const parsed = JSON.parse(lockContent) as { pid?: number, timestamp?: number }
                            holdingPid = typeof parsed.pid === 'number' ? parsed.pid : undefined
                            lockTimestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : undefined
                        } catch {
                            // Legacy raw PID string format fallback
                            holdingPid = parseInt(lockContent, 10)
                        }
                        
                        if (holdingPid !== undefined && !isNaN(holdingPid)) {
                            // Check timestamp first: if older than 5 minutes, consider it stale due to crash
                            if (lockTimestamp !== undefined && (Date.now() - lockTimestamp > 5 * 60 * 1000)) {
                                isStale = true
                                logger.warning('Found stale database restore lock (expired timestamp)', { path: lockPath, holdingPid, ageMs: Date.now() - lockTimestamp, module: 'SqliteAdapter' })
                            } else {
                                try {
                                    process.kill(holdingPid, 0)
                                } catch (e: unknown) {
                                    // ESRCH means the process does not exist
                                    if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ESRCH') {
                                        isStale = true
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    // Ignore read errors
                }

                if (isStale) {
                    logger.warning('Found stale database restore lock (dead PID), forcibly removing', { path: lockPath, module: 'SqliteAdapter' })
                    try {
                        fs.unlinkSync(lockPath)
                    } catch {
                        // Ignore unlink errors
                    }
                    // Retry acquiring the lock
                    lockFd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR)
                    fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce }))
                } else {
                    throw new Error(`Another process is currently holding the database lock at ${lockPath}. Backup restore cannot safely proceed.`, { cause: lockError })
                }
            } else {
                throw lockError
            }
        }
        
        try {
            const currentCountResult = this.ctx.exec(
                'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL'
            )
            const previousEntryCount = (currentCountResult[0]?.values[0]?.[0] as number) ?? 0

            const preRestoreResult = await this.exportToFile(`pre_restore_${new Date().toISOString().replace(/[:.]/g, '-')}`)

            // Close old DB via manager
            this.ctx.closeDbBeforeRestore()

            try {
                // Stage the backup file directly adjacent to ensure cross-device consistency avoids failure
                const tempDbPath = `${this.ctx.getDbPath()}.restore_tmp_${randomUUID()}`
                await fs.promises.copyFile(backupPath, tempDbPath)
                
                // Perform atomic swap
                await fs.promises.rename(tempDbPath, this.ctx.getDbPath())

                // Re-initialize using the connection's standard initialize method
                // This ensures extensions like sqlite-vec are properly loaded
                await this.ctx.initialize()

                // Run explicit integrity check
                const integrityResult = this.ctx.exec('PRAGMA integrity_check');
                if (integrityResult[0]?.values[0]?.[0] !== 'ok') {
                    throw new Error(`Integrity check failed: ${String(integrityResult[0]?.values[0]?.[0])}`)
                }
            } catch (error) {
                logger.error('Restore failed, rolling back to pre-restore backup', {
                    module: 'SqliteAdapter',
                    operation: 'restoreFromFile',
                    error: error instanceof Error ? error.message : String(error)
                })
                // Close old DB via manager before rollback
                this.ctx.closeDbBeforeRestore()
                // Rollback using the same atomic strategy for recovery
                const recoveryDbPath = `${this.ctx.getDbPath()}.recover_tmp_${randomUUID()}`
                await fs.promises.copyFile(preRestoreResult.path, recoveryDbPath)
                await fs.promises.rename(recoveryDbPath, this.ctx.getDbPath())
                await this.ctx.initialize()
                throw error
            }

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
                fs.closeSync(lockFd)
                fs.unlinkSync(lockPath)
            } catch (err: unknown) {
                logger.warning('Failed to release OS lock file during restore', { 
                    path: lockPath, 
                    error: err instanceof Error ? err.message : String(err) 
                })
            }
        }
    }
}
