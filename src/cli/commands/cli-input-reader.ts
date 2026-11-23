import fs from 'node:fs'
import { ValidationError } from '../../types/errors.js'
import { hasUnsafeAdsColon, hasWinReservedDeviceSegment } from '../../utils/path-safety.js'
import { CliExitError } from './db-core.js'

/** Maximum CLI input file / stdin size (2 MiB) to prevent memory exhaustion or device hangs. */
export const MAX_CLI_INPUT_BYTES = 2 * 1024 * 1024
const STDIN_TIMEOUT_MS = 3000
const STDIN_TOTAL_TIMEOUT_MS = 15_000

const UNC_OR_WIN_DEVICE_PREFIX_RE = /^[\\/]{2}/
const WIN32_DRIVE_REL_RE = /^[a-zA-Z]:(?![\\/])/

/** Reject syntactically unsafe Win32/UNC/ADS/device paths before any filesystem syscall. */
export function assertSyntacticallySafeCliPath(trimmedPath: string, flagName: string): void {
    if (trimmedPath.length === 0) {
        throw new ValidationError(`Must provide a non-empty ${flagName} path.`)
    }
    if (trimmedPath.includes('\0')) {
        throw new ValidationError(`Invalid ${flagName} path: null bytes are not allowed.`)
    }
    if (
        UNC_OR_WIN_DEVICE_PREFIX_RE.test(trimmedPath) ||
        WIN32_DRIVE_REL_RE.test(trimmedPath) ||
        hasUnsafeAdsColon(trimmedPath) ||
        hasWinReservedDeviceSegment(trimmedPath)
    ) {
        throw new ValidationError(
            `Unsafe ${flagName} path: UNC, drive-relative, Win32 device, or alternate data stream paths are not allowed.`
        )
    }
}

/**
 * Read a CLI input file safely with Win32 UNC/ADS/device checks, symlink rejection (`lstatSync` +
 * `O_NOFOLLOW`), regular-file verification, and a strict byte limit.
 */
export function readBoundedCliInputFile(
    rawPath: string,
    flagName: string,
    maxBytes = MAX_CLI_INPUT_BYTES
): string {
    const trimmed = rawPath.trim()
    assertSyntacticallySafeCliPath(trimmed, flagName)

    const lstat = fs.lstatSync(trimmed, { throwIfNoEntry: false })
    if (lstat === undefined) {
        throw new ValidationError(`File not found for ${flagName}: ${trimmed}`)
    }
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
        throw new ValidationError(
            `${flagName} must point to a regular non-symlink file: ${trimmed}`
        )
    }
    if (lstat.size > maxBytes) {
        throw new ValidationError(
            `${flagName} exceeds maximum allowed size of ${String(maxBytes)} bytes.`
        )
    }

    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    const fd = fs.openSync(trimmed, openFlags)
    try {
        const fstat = fs.fstatSync(fd)
        if (!fstat.isFile() || fstat.size > maxBytes) {
            throw new ValidationError(
                `${flagName} failed regular-file or ${String(maxBytes)}-byte size check.`
            )
        }
        const buf = Buffer.allocUnsafe(Math.min(maxBytes + 1, 16_384))
        const chunks: Buffer[] = []
        let totalBytes = 0
        while (true) {
            const bytesRead = fs.readSync(fd, buf, 0, buf.length, null)
            if (bytesRead === 0) break
            totalBytes += bytesRead
            if (totalBytes > maxBytes) {
                throw new ValidationError(
                    `${flagName} exceeds maximum allowed size of ${String(maxBytes)} bytes.`
                )
            }
            chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
        }
        return Buffer.concat(chunks, totalBytes).toString('utf-8')
    } finally {
        fs.closeSync(fd)
    }
}

/** Read piped CLI stdin with idle stall timeout, overall deadline, and 2 MiB size cap. */
export async function readPipedStdinWithTimeout(): Promise<string> {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let hasInput = false
    let idleTimeoutId: ReturnType<typeof setTimeout> | undefined
    let totalTimeoutId: ReturnType<typeof setTimeout> | undefined
    return await new Promise<string>((resolve, reject) => {
        const cleanup = (): void => {
            if (idleTimeoutId !== undefined) clearTimeout(idleTimeoutId)
            if (totalTimeoutId !== undefined) clearTimeout(totalTimeoutId)
            process.stdin.off('data', onData)
            process.stdin.off('end', onEnd)
            process.stdin.off('error', onError)
            process.stdin.pause()
        }
        const failStdin = (err: Error, stderrMsg?: string): void => {
            cleanup()
            if (stderrMsg !== undefined) process.stderr.write(stderrMsg)
            reject(err)
        }
        const resetIdleTimer = (): void => {
            if (idleTimeoutId !== undefined) clearTimeout(idleTimeoutId)
            idleTimeoutId = setTimeout(() => {
                failStdin(
                    new CliExitError(1),
                    hasInput
                        ? 'Error: Stdin stream stalled before EOF. Use --file or --content.\n'
                        : 'Error: Timed out waiting for stdin. You must provide --file or --content when running in a non-interactive shell.\n'
                )
            }, STDIN_TIMEOUT_MS)
            idleTimeoutId.unref()
        }
        const onData = (chunk: string | Buffer): void => {
            hasInput = true
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
            totalBytes += buf.length
            if (totalBytes > MAX_CLI_INPUT_BYTES) {
                failStdin(
                    new ValidationError(
                        `Piped stdin exceeds maximum allowed size of ${String(MAX_CLI_INPUT_BYTES)} bytes.`
                    )
                )
                return
            }
            chunks.push(buf)
            resetIdleTimer()
        }
        const onEnd = (): void => {
            cleanup()
            resolve(Buffer.concat(chunks, totalBytes).toString('utf8'))
        }
        const onError = (err: Error): void => {
            failStdin(err)
        }
        resetIdleTimer()
        totalTimeoutId = setTimeout(() => {
            failStdin(
                new CliExitError(1),
                'Error: Exceeded overall stdin read deadline. Use --file or --content.\n'
            )
        }, STDIN_TOTAL_TIMEOUT_MS)
        totalTimeoutId.unref()
        process.stdin.on('data', onData)
        process.stdin.once('end', onEnd)
        process.stdin.once('error', onError)
        process.stdin.resume()
    })
}
