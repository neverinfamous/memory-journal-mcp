import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'

function writeLockFile(lockFile: string, nonce: string): void {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce }))
}

function hasErrorCode(err: unknown, code: string): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

function toValidPid(val: unknown): number | undefined {
    return typeof val === 'number' && Number.isSafeInteger(val) && val > 0 ? val : undefined
}

/** Parse the lock file content into holding PID and timestamp (supports legacy raw PID format). */
function parseLockContent(lockContent: string): {
    holdingPid: number | undefined
    lockTimestamp: number | undefined
} {
    try {
        const parsed: unknown = JSON.parse(lockContent)
        if (typeof parsed === 'number') {
            return { holdingPid: toValidPid(parsed), lockTimestamp: undefined }
        }
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as { pid?: unknown; timestamp?: unknown }
            return {
                holdingPid: toValidPid(record.pid),
                lockTimestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined,
            }
        }
        return { holdingPid: undefined, lockTimestamp: undefined }
    } catch {
        // Legacy raw PID string format fallback
        const trimmed = lockContent.trim()
        const pid = /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) : Number.NaN
        return { holdingPid: toValidPid(pid), lockTimestamp: undefined }
    }
}

/** Decide staleness for a lock held by a known PID. */
function isHoldingPidStale(
    holdingPid: number,
    lockDir: string,
    runtime: unknown
): boolean {
    // [INVARIANT] A live holder keeps the lock even when the timestamp is old.
    // Age alone is not a crash signal; only ESRCH means the holder is gone.
    // Restore turns maintenance on before taking this directory, and the
    // maintenance lock is exclusive. A lock file still owned by this process is leftover.
    if (holdingPid === process.pid) {
        logger.warning('Found stale database restore lock (current process)', {
            path: lockDir,
            module: 'SqliteAdapter',
        })
        return true
    }
    if (
        runtime !== undefined &&
        runtime !== null &&
        typeof runtime === 'object' &&
        'maintenanceManager' in runtime
    ) {
        // Delegate to ServerRuntime MaintenanceManager logic
        const mm = (
            runtime as {
                maintenanceManager?: { isMaintenanceModeActive(): boolean }
            }
        ).maintenanceManager
        if (mm !== undefined && !mm.isMaintenanceModeActive()) {
            logger.warning('Found stale database restore lock (maintenance mode inactive)', {
                path: lockDir,
                module: 'SqliteAdapter',
            })
            return true
        }
        // Only fall through to process.kill(holdingPid, 0) for foreign PIDs when local maintenance is active
    }
    try {
        process.kill(holdingPid, 0)
    } catch (e: unknown) {
        // ESRCH means the process does not exist
        if (hasErrorCode(e, 'ESRCH')) {
            return true
        }
        logger.error('Failed to probe restore lock holder', {
            error: e instanceof Error ? e.message : String(e),
            module: 'SqliteAdapter',
        })
        throw e
    }
    return false
}

function writeLockFileGuarded(lockDir: string, lockFile: string, nonce: string): void {
    try {
        writeLockFile(lockFile, nonce)
    } catch (writeErr: unknown) {
        try {
            fs.rmSync(lockDir, { recursive: true, force: true })
        } catch {
            // Best-effort cleanup of empty lock directory
        }
        throw writeErr
    }
}

function isOrphanedLockDir(lockDir: string): boolean {
    try {
        const stat = fs.statSync(lockDir)
        return Date.now() - stat.mtimeMs > 2000
    } catch (err: unknown) {
        logger.debug('Failed to stat restore lock directory while checking staleness', {
            module: 'RestoreLock',
            lockDir,
            error: err instanceof Error ? err.message : String(err),
        })
        return false
    }
}

function isLockStale(lockDir: string, lockFile: string, runtime: unknown): boolean {
    try {
        const lockContent = fs.readFileSync(lockFile, 'utf-8').trim()
        if (!lockContent) return isOrphanedLockDir(lockDir)
        const { holdingPid } = parseLockContent(lockContent)
        if (holdingPid === undefined || Number.isNaN(holdingPid)) return false
        return isHoldingPidStale(holdingPid, lockDir, runtime)
    } catch (readErr: unknown) {
        // Only treat a missing lock.json as orphaned after a creation grace window so a contender
        // between mkdirSync(lockDir) and writeLockFile(lockFile) is never falsely reclaimed.
        if (!hasErrorCode(readErr, 'ENOENT')) return false
        return isOrphanedLockDir(lockDir)
    }
}

/** Remove a stale lock directory, preferring an atomic rename and falling back to removal. */
function clearStaleLock(lockDir: string): void {
    logger.warning('Found stale database restore lock (dead PID), atomically renaming', {
        path: lockDir,
        module: 'SqliteAdapter',
    })
    const staleDir = `${lockDir}.${randomUUID()}.stale`
    try {
        fs.renameSync(lockDir, staleDir)
        try {
            fs.rmSync(staleDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
        } catch (err: unknown) {
            logger.debug('Failed best-effort removal of stale restore lock directory', {
                module: 'RestoreLock',
                staleDir,
                error: err instanceof Error ? err.message : String(err),
            })
        }
    } catch (renameErr) {
        // On Windows or concurrent environments, renaming a directory with files can throw EPERM/EBUSY.
        // Fall back to safely removing the stale lock directory.
        try {
            fs.rmSync(lockDir, {
                recursive: true,
                force: true,
                maxRetries: 5,
                retryDelay: 50,
            })
        } catch {
            // If rename and rmSync fail, another process likely beat us to it.
            throw new Error(
                `Another process is currently holding the database lock at ${lockDir}. Backup restore cannot safely proceed.`,
                { cause: renameErr }
            )
        }
    }
}

/** Acquire the OS lock directory for restore, reclaiming it if the existing lock is stale. */
export function acquireRestoreLock(lockDir: string, lockFile: string, runtime: unknown): void {
    const nonce = randomUUID()
    fs.mkdirSync(path.dirname(lockDir), { recursive: true })
    try {
        fs.mkdirSync(lockDir)
        writeLockFileGuarded(lockDir, lockFile, nonce)
    } catch (lockError: unknown) {
        if (!hasErrorCode(lockError, 'EEXIST')) {
            throw lockError
        }
        if (!isLockStale(lockDir, lockFile, runtime)) {
            throw new Error(
                `Another process is currently holding the database lock at ${lockDir}. Backup restore cannot safely proceed.`,
                { cause: lockError }
            )
        }
        clearStaleLock(lockDir)
        // [INVARIANT] Retry with a non-recursive mkdir so a concurrent reclaimer loses with EEXIST
        // instead of both processes believing they own the lock.
        try {
            fs.mkdirSync(lockDir)
        } catch (retryError: unknown) {
            if (hasErrorCode(retryError, 'EEXIST')) {
                throw new Error(
                    `Another process is currently holding the database lock at ${lockDir}. Backup restore cannot safely proceed.`,
                    { cause: retryError }
                )
            }
            throw retryError
        }
        writeLockFileGuarded(lockDir, lockFile, nonce)
    }
}
