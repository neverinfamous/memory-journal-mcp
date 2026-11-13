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

/** Parse the lock file content into holding PID and timestamp (supports legacy raw PID format). */
function parseLockContent(lockContent: string): {
    holdingPid: number | undefined
    lockTimestamp: number | undefined
} {
    try {
        const parsed = JSON.parse(lockContent) as {
            pid?: number
            timestamp?: number
        }
        return {
            holdingPid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            lockTimestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : undefined,
        }
    } catch {
        // Legacy raw PID string format fallback
        return { holdingPid: parseInt(lockContent, 10), lockTimestamp: undefined }
    }
}

/** Decide staleness for a lock held by a known PID. */
function isHoldingPidStale(
    holdingPid: number,
    lockTimestamp: number | undefined,
    lockDir: string,
    runtime: unknown
): boolean {
    // Check timestamp first: if older than 30 seconds, consider it stale due to crash
    if (lockTimestamp !== undefined && Date.now() - lockTimestamp > 30 * 1000) {
        logger.warning('Found stale database restore lock (expired timestamp)', {
            path: lockDir,
            holdingPid,
            ageMs: Date.now() - lockTimestamp,
            module: 'SqliteAdapter',
        })
        return true
    }
    // [INVARIANT] Restore turns maintenance on before taking this directory, and the
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
        return false
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

function isLockStale(lockDir: string, lockFile: string, runtime: unknown): boolean {
    try {
        const lockContent = fs.readFileSync(lockFile, 'utf-8').trim()
        if (!lockContent) return false
        const { holdingPid, lockTimestamp } = parseLockContent(lockContent)
        if (holdingPid === undefined || isNaN(holdingPid)) return false
        return isHoldingPidStale(holdingPid, lockTimestamp, lockDir, runtime)
    } catch (readErr: unknown) {
        // If the directory exists but the lock file is missing, it's an orphaned lock
        return hasErrorCode(readErr, 'ENOENT')
    }
}

/** Remove a stale lock directory, preferring an atomic rename and falling back to removal. */
function clearStaleLock(lockDir: string): void {
    logger.warning('Found stale database restore lock (dead PID), atomically renaming', {
        path: lockDir,
        module: 'SqliteAdapter',
    })
    try {
        fs.renameSync(lockDir, `${lockDir}.${randomUUID()}.stale`)
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
        writeLockFile(lockFile, nonce)
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
        writeLockFile(lockFile, nonce)
    }
}
