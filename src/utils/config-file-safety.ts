import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs'

export const MAX_CONFIG_FILE_BYTES = 5 * 1024 * 1024

function readFsCode(err: unknown): string | undefined {
    return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
        ? err.code
        : undefined
}

/**
 * Safely reads a regular non-symlink config file with `O_NOFOLLOW` and a 5 MB byte limit.
 * Returns `undefined` when the file does not exist (`ENOENT`).
 */
export function readSafeRegularConfigTextSync(
    filePath: string,
    maxBytes = MAX_CONFIG_FILE_BYTES
): { content: string; stat: fs.Stats } | undefined {
    let linkStat: fs.Stats
    try {
        linkStat = fs.lstatSync(filePath)
    } catch (err: unknown) {
        if (readFsCode(err) === 'ENOENT') return undefined
        throw err
    }
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        throw new Error(`Refusing to read symlink or non-regular config file: ${filePath}`)
    }

    let fd: number
    try {
        fd = fs.openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    } catch (err: unknown) {
        if (readFsCode(err) === 'ENOENT') return undefined
        throw err
    }
    try {
        const stat = fs.fstatSync(fd)
        if (!stat.isFile()) {
            throw new Error(`Refusing to read non-regular config file: ${filePath}`)
        }
        if (stat.size > maxBytes) {
            throw new Error(`Config file exceeds maximum allowed size (${String(maxBytes)} bytes)`)
        }
        return { content: fs.readFileSync(fd, 'utf-8'), stat }
    } finally {
        fs.closeSync(fd)
    }
}

/**
 * Rejects overwriting existing symlinks or non-regular files when persisting config data.
 */
export function assertSafeConfigWriteTargetSync(targetPath: string): void {
    const existing = fs.lstatSync(targetPath, { throwIfNoEntry: false })
    if (existing !== undefined && (existing.isSymbolicLink() || !existing.isFile())) {
        throw new Error(`Refusing to overwrite symlink or non-regular config file: ${targetPath}`)
    }
}
