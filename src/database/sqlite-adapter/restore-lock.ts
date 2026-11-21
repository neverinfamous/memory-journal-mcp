import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../../utils/logger.js'

function writeLockFile(lockFile: string, nonce: string): void {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce }), {
        flag: 'wx',
    })
}

function hasErrorCode(err: unknown, code: string): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

function toValidPid(val: unknown): number | undefined {
    return typeof val === 'number' && Number.isSafeInteger(val) && val > 0 ? val : undefined
}

/** Parse the lock file content into holding PID, timestamp, and optional nonce (supports legacy raw PID format). */
function parseLockContent(lockContent: string): {
    holdingPid: number | undefined
    lockTimestamp: number | undefined
    nonce?: string
} {
    try {
        const parsed: unknown = JSON.parse(lockContent)
        if (typeof parsed === 'number') {
            return { holdingPid: toValidPid(parsed), lockTimestamp: undefined }
        }
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as { pid?: unknown; timestamp?: unknown; nonce?: unknown }
            return {
                holdingPid: toValidPid(record.pid),
                lockTimestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined,
                ...(typeof record.nonce === 'string' ? { nonce: record.nonce } : {}),
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
    _runtime: unknown
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

interface LockRecord {
    holdingPid: number | undefined
    nonce?: string
}

interface LockStaleCheck {
    stale: boolean
    observed: LockRecord | null
}

function parseLockRecordText(raw: string): LockRecord | null {
    if (!raw) return null
    const parsed = parseLockContent(raw)
    return {
        holdingPid: parsed.holdingPid,
        ...(parsed.nonce !== undefined ? { nonce: parsed.nonce } : {}),
    }
}

function parseLockRecord(lockFile: string): LockRecord | null {
    try {
        const raw = fs.readFileSync(lockFile, 'utf-8').trim()
        return parseLockRecordText(raw)
    } catch {
        return null
    }
}

function isLockStale(lockDir: string, lockFile: string, runtime: unknown): LockStaleCheck {
    try {
        const lockContent = fs.readFileSync(lockFile, 'utf-8').trim()
        if (!lockContent) return { stale: isOrphanedLockDir(lockDir), observed: null }
        const observed = parseLockRecordText(lockContent)
        if (observed?.holdingPid === undefined || Number.isNaN(observed.holdingPid)) {
            return { stale: false, observed }
        }
        return { stale: isHoldingPidStale(observed.holdingPid, lockDir, runtime), observed }
    } catch (readErr: unknown) {
        // Only treat a missing lock.json as orphaned after a creation grace window so a contender
        // between mkdirSync(lockDir) and writeLockFile(lockFile) is never falsely reclaimed.
        if (!hasErrorCode(readErr, 'ENOENT')) return { stale: false, observed: null }
        return { stale: isOrphanedLockDir(lockDir), observed: null }
    }
}

function lockRecordChanged(expected: LockRecord | null, observed: LockRecord | null): boolean {
    if (observed === null) return expected !== null
    if (expected === null) return true
    return expected.holdingPid !== observed.holdingPid || expected.nonce !== observed.nonce
}

function throwContendedLockError(lockDir: string, cause?: unknown): never {
    throw new Error(
        `Another process is currently holding the database lock at ${lockDir}. Backup restore cannot safely proceed.`,
        cause !== undefined ? { cause } : undefined
    )
}

/** Remove a stale lock directory via atomic rename, re-checking staleness before any fallback cleanup. */
function clearStaleLock(
    lockDir: string,
    lockFile: string,
    runtime: unknown,
    expected: LockRecord | null
): void {
    logger.warning('Found stale database restore lock (dead PID), atomically renaming', {
        path: lockDir,
        module: 'SqliteAdapter',
    })
    const staleDir = `${lockDir}.${randomUUID()}.stale`
    try {
        fs.renameSync(lockDir, staleDir)
        const movedLockFile = path.join(staleDir, path.basename(lockFile))
        const movedRecord = parseLockRecord(movedLockFile)
        if (lockRecordChanged(expected, movedRecord) && !isLockStale(staleDir, movedLockFile, runtime).stale) {
            try {
                fs.renameSync(staleDir, lockDir)
            } catch {
                // Best-effort restore if contender recreated lockDir
            }
            throwContendedLockError(lockDir)
        }
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
        if (hasErrorCode(renameErr, 'ENOENT')) return
        if (
            renameErr instanceof Error &&
            renameErr.message.startsWith('Another process is currently holding the database lock')
        ) {
            throw renameErr
        }
        const recheck = isLockStale(lockDir, lockFile, runtime)
        if (!recheck.stale || lockRecordChanged(expected, recheck.observed)) {
            throwContendedLockError(lockDir, renameErr)
        }
        try {
            try {
                fs.unlinkSync(lockFile)
            } catch (unlinkErr: unknown) {
                if (!hasErrorCode(unlinkErr, 'ENOENT')) throw unlinkErr
            }
            fs.rmdirSync(lockDir)
        } catch {
            throwContendedLockError(lockDir, renameErr)
        }
    }
}

function reclaimAndRetryLockDir(
    lockDir: string,
    lockFile: string,
    nonce: string,
    runtime: unknown,
    lockError: unknown
): void {
    const staleCheck = isLockStale(lockDir, lockFile, runtime)
    if (!staleCheck.stale) {
        throwContendedLockError(lockDir, lockError)
    }
    clearStaleLock(lockDir, lockFile, runtime, staleCheck.observed)
    // [INVARIANT] Retry with a non-recursive mkdir so a concurrent reclaimer loses with EEXIST
    // instead of both processes believing they own the lock.
    try {
        fs.mkdirSync(lockDir)
    } catch (retryError: unknown) {
        if (hasErrorCode(retryError, 'EEXIST')) {
            throwContendedLockError(lockDir, retryError)
        }
        throw retryError
    }
    writeLockFileGuarded(lockDir, lockFile, nonce)
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
        reclaimAndRetryLockDir(lockDir, lockFile, nonce, runtime, lockError)
    }
}
