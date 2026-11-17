import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'
import { assertNoPathTraversal } from '../../utils/security-utils.js'
import { ResourceNotFoundError, ValidationError } from '../../types/errors.js'
import type { IDatabaseConnection } from '../core/interfaces.js'
import { applySqlCipherKey, hasSqlCipherKey } from './sqlcipher-key.js'

function hasErrorCode(err: unknown, code: string): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

/** Unlink a file, ignoring a missing file (ENOENT) and logging any other failure at debug. */
export async function unlinkBestEffort(filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath)
    } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
            logger.debug('Best-effort file cleanup failed', {
                module: 'BackupManager',
                path: filePath,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

/** Verify a SQLite backup file opens cleanly and passes `PRAGMA integrity_check`. */
export async function assertIncomingBackupIntact(backupPath: string): Promise<void> {
    try {
        const Database = (await import('better-sqlite3')).default
        const tempDb = new Database(backupPath, { fileMustExist: true, readonly: true })
        try {
            applySqlCipherKey(tempDb)

            const tempStmt = tempDb.prepare('PRAGMA integrity_check')
            const result: unknown = tempStmt.get()
            const integrityResult: unknown =
                typeof result === 'object' && result !== null
                    ? (Object.values(result) as unknown[])[0]
                    : undefined
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

/** Truncate the WAL before copying an encrypted/non-native database file. */
function checkpointWalForBackup(ctx: IDatabaseConnection): void {
    try {
        if (typeof ctx.getNativeDb === 'function') {
            const ckpt: unknown = ctx.getNativeDb().pragma('wal_checkpoint(TRUNCATE)')
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
            ctx.pragma('wal_checkpoint(TRUNCATE)')
        }
    } catch (checkpointErr) {
        const err =
            checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr)
        logger.error('WAL checkpoint failed, aborting backup', {
            module: 'SqliteAdapter',
            operation: 'exportToFile',
            error: err,
        })
        throw new Error(`WAL checkpoint failed, backup aborted to prevent stale data: ${err}`, {
            cause: checkpointErr,
        })
    }
}

/** Stage a backup write to `tempBackupPath`, verify integrity, and atomically rename to `backupPath`. */
async function stageAndVerifyBackup(
    tempBackupPath: string,
    backupPath: string,
    stageFn: () => Promise<void>
): Promise<void> {
    try {
        await stageFn()
        await assertIncomingBackupIntact(tempBackupPath)
        await fs.promises.rename(tempBackupPath, backupPath)
    } catch (err) {
        await unlinkBestEffort(tempBackupPath)
        throw err
    }
}

/** Write and verify a backup via native backup API or WAL-checkpointed copy, staging through a temp file. */
export async function writeVerifiedBackupFile(
    ctx: IDatabaseConnection,
    backupPath: string
): Promise<void> {
    const tempBackupPath = `${backupPath}.${String(process.pid)}.${String(Date.now())}.${randomUUID().slice(0, 8)}.tmp`
    const isEncrypted = hasSqlCipherKey()
    const nativeDb = !isEncrypted ? ctx.getNativeDb?.() : undefined

    if (nativeDb !== undefined) {
        await stageAndVerifyBackup(tempBackupPath, backupPath, () =>
            nativeDb.backup(tempBackupPath).then(() => undefined)
        )
        return
    }

    checkpointWalForBackup(ctx)
    await stageAndVerifyBackup(tempBackupPath, backupPath, () =>
        fs.promises.copyFile(ctx.getDbPath(), tempBackupPath)
    )
}

/** Validate `filename` against traversal and symlinks inside `backupsDir`, and verify SQLite integrity. */
export async function resolveValidatedRestorePath(
    backupsDir: string,
    filename: string
): Promise<string> {
    assertNoPathTraversal(filename)

    const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
    const resolvedBackupsDir = path.resolve(backupsDir)
    const backupPath = path.resolve(backupsDir, filename)
    const relToBackups = path.relative(fold(resolvedBackupsDir), fold(backupPath))

    if (
        relToBackups.startsWith(`..${path.sep}`) ||
        relToBackups === '..' ||
        path.isAbsolute(relToBackups)
    ) {
        throw new ValidationError('Path traversal detected during restore resolution.')
    }

    let stat: fs.Stats
    try {
        stat = await fs.promises.lstat(backupPath)
    } catch (e: unknown) {
        if (hasErrorCode(e, 'ENOENT')) {
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
    return backupPath
}

/** Query the number of active (non-deleted) journal entries. */
export function countActiveEntries(ctx: IDatabaseConnection): number {
    const result = ctx.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL')
    const raw = result[0]?.values[0]?.[0]
    if (typeof raw === 'number') return raw
    return typeof raw === 'bigint' ? Number(raw) : 0
}

/** Release the OS restore lock directory on a best-effort basis. */
export function releaseRestoreLock(lockDir: string, lockFile: string): void {
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

/** Stage the incoming backup and capture a pre-restore snapshot before touching the live database. */
export async function prepareRestoreTempFiles(
    ctx: IDatabaseConnection,
    backupPath: string,
    tempDbPath: string,
    oldDbBackupPath: string
): Promise<void> {
    try {
        await fs.promises.copyFile(backupPath, tempDbPath)
        // [INVARIANT] Complete pre-swap snapshot before any swap step; if snapshot creation fails,
        // the live DB is untouched so rollback must never copy a partial oldDbBackupPath over it.
        await fs.promises.copyFile(ctx.getDbPath(), oldDbBackupPath)
    } catch (prepErr) {
        await unlinkBestEffort(oldDbBackupPath)
        await unlinkBestEffort(tempDbPath)
        try {
            await ctx.initialize()
        } catch (reinitErr) {
            logger.error('Failed to re-initialize DB after pre-swap snapshot error', {
                module: 'SqliteAdapter',
                operation: 'restoreFromFile',
                error: reinitErr instanceof Error ? reinitErr.message : String(reinitErr),
            })
        }
        throw prepErr
    }
}

/** Move `tempDbPath` into place, clean WAL/SHM sidecars, re-initialize, and verify integrity. */
export async function applySwappedDatabase(
    ctx: IDatabaseConnection,
    tempDbPath: string
): Promise<void> {
    const dbPath = ctx.getDbPath()
    try {
        await fs.promises.rename(tempDbPath, dbPath)
    } catch (renameErr) {
        // Fallback to copyFile if atomic rename fails (e.g., Windows EBUSY or cross-device links)
        logger.debug('Atomic rename failed during restore swap; falling back to copyFile', {
            module: 'SqliteAdapter',
            operation: 'restoreFromFile',
            error: renameErr instanceof Error ? renameErr.message : String(renameErr),
        })
        await fs.promises.copyFile(tempDbPath, dbPath)
        await unlinkBestEffort(tempDbPath)
    }

    await unlinkBestEffort(`${dbPath}-wal`)
    await unlinkBestEffort(`${dbPath}-shm`)

    await ctx.initialize()

    const integrityResult = ctx.exec('PRAGMA integrity_check')
    if (integrityResult[0]?.values[0]?.[0] !== 'ok') {
        throw new Error(
            `Integrity check failed: ${String(integrityResult[0]?.values[0]?.[0])}`
        )
    }
}

async function tryRollbackCopy(
    ctx: IDatabaseConnection,
    oldDbBackupPath: string
): Promise<boolean> {
    const dbPath = ctx.getDbPath()
    try {
        await fs.promises.copyFile(oldDbBackupPath, dbPath)
        await unlinkBestEffort(`${dbPath}-wal`)
        await unlinkBestEffort(`${dbPath}-shm`)
        return true
    } catch (rollbackErr) {
        if (!hasErrorCode(rollbackErr, 'ENOENT')) {
            logger.error('Rollback copy failed', { error: rollbackErr })
        }
        return false
    }
}

/** Roll back to `oldDbBackupPath` after a failed restore swap and rethrow. */
export async function rollbackFailedRestore(
    ctx: IDatabaseConnection,
    oldDbBackupPath: string,
    tempDbPath: string,
    error: unknown
): Promise<never> {
    logger.error('Restore failed, rolling back to pre-restore backup using copy', {
        module: 'SqliteAdapter',
        operation: 'restoreFromFile',
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    })
    ctx.closeDbBeforeRestore()

    const rollbackSuccess = await tryRollbackCopy(ctx, oldDbBackupPath)
    if (rollbackSuccess) {
        await unlinkBestEffort(oldDbBackupPath)
    }
    await unlinkBestEffort(tempDbPath)

    if (!rollbackSuccess) {
        try {
            await ctx.initialize()
        } catch (reinitErr) {
            logger.debug('DB re-init failed after failed rollback', {
                module: 'SqliteAdapter',
                error: reinitErr instanceof Error ? reinitErr.message : String(reinitErr),
            })
        }
        throw new Error(
            `CRITICAL: Database restore failed AND rollback failed. The database may be in an inconsistent state. Your previous database is preserved at: ${oldDbBackupPath}. Original error: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        )
    }

    await ctx.initialize()
    throw error
}
