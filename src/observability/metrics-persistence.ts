import { constants as fsConstants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const MAX_METRICS_SNAPSHOT_BYTES = 10 * 1024 * 1024

function readErrCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined
}

async function assertSafeMetricsTarget(filePath: string, allowMissing: boolean): Promise<void> {
    try {
        const info = await fs.lstat(filePath)
        if (info.isSymbolicLink() || !info.isFile()) {
            throw new Error(`Refusing to access symlink or non-regular metrics file: ${filePath}`)
        }
    } catch (err: unknown) {
        if (allowMissing && readErrCode(err) === 'ENOENT') return
        throw err
    }
}

/** Atomically writes metrics state to `filePath` with `0o600` permissions and symlink protection. */
export async function writeMetricsSnapshotFile(filePath: string, state: string): Promise<void> {
    await assertSafeMetricsTarget(filePath, true)
    const tmpPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.${randomUUID().slice(0, 8)}.tmp`
    let wroteTemp = false
    try {
        await fs.mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
        await fs.writeFile(tmpPath, state, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        wroteTemp = true
        await fs.chmod(tmpPath, 0o600)
        await fs.rename(tmpPath, filePath)
    } catch (error) {
        if (wroteTemp) {
            await fs.rm(tmpPath, { force: true }).catch(() => undefined)
        }
        throw error
    }
}

/** Reads a metrics snapshot without following symlinks and enforces a 10 MB size ceiling. */
export async function readMetricsSnapshotFile(filePath: string): Promise<string | undefined> {
    try {
        await assertSafeMetricsTarget(filePath, false)
    } catch (err: unknown) {
        if (readErrCode(err) === 'ENOENT') return undefined
        throw err
    }
    let handle: fs.FileHandle
    try {
        handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    } catch (err: unknown) {
        if (readErrCode(err) === 'ENOENT') return undefined
        throw err
    }
    try {
        const stat = await handle.stat()
        if (!stat.isFile()) {
            throw new Error(`Refusing to load non-regular metrics file: ${filePath}`)
        }
        if (stat.size > MAX_METRICS_SNAPSHOT_BYTES) {
            throw new Error(
                `Metrics snapshot exceeds maximum allowed size (${String(MAX_METRICS_SNAPSHOT_BYTES)} bytes)`
            )
        }
        return await handle.readFile({ encoding: 'utf8' })
    } finally {
        await handle.close().catch(() => undefined)
    }
}
