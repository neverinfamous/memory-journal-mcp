import fs from 'node:fs'
import path from 'node:path'
import { MemoryJournalMcpError } from '../types/errors.js'

/**
 * Base class for security-related errors.
 * Extends MemoryJournalMcpError with VALIDATION category.
 */
export class SecurityError extends MemoryJournalMcpError {
    constructor(message: string, code: string) {
        super(message, code, 'validation', {
            suggestion: 'Check input for security violations',
            recoverable: false,
        })
        this.name = 'SecurityError'
    }
}

/**
 * Thrown when path traversal is detected in input
 */
export class PathTraversalError extends SecurityError {
    constructor(targetPath: string) {
        super(`Path traversal detected: '${targetPath}'`, 'PATH_TRAVERSAL')
        this.name = 'PathTraversalError'
    }
}

/**
 * Reject encoded separators/dots/nulls and `..` segments, returning the decoded directory path.
 * @throws PathTraversalError on any traversal indicator
 */
function decodeSafeDirPath(dirPath: string): string {
    // 1. Reject encoded path separators/dots/nulls and raw null bytes before decoding
    if (/%2f|%5c|%2e|%00/i.test(dirPath) || dirPath.includes('\0')) {
        throw new PathTraversalError(dirPath)
    }
    let decodedDir: string
    try {
        decodedDir = decodeURIComponent(dirPath)
    } catch {
        throw new PathTraversalError(dirPath)
    }
    if (decodedDir.includes('\0')) {
        throw new PathTraversalError(decodedDir)
    }
    const normalized = decodedDir.replace(/\\/g, '/')
    const segments = normalized.split('/')
    if (segments.some((s) => s === '..')) {
        throw new PathTraversalError(decodedDir)
    }
    return decodedDir
}

/**
 * Resolve the real path of the target, stepping up to the nearest existing ancestor so symlinked
 * parents cannot be used to escape when the final node does not exist yet.
 */
function resolveRealTargetPath(targetInput: string): string {
    const resolved = path.resolve(targetInput)

    // 2. Resolve realpath iteratively by stepping up the tree until an existing directory is found.
    // This prevents symlink traversal bypasses where the final node does not exist but a parent is a symlink pointing outside.
    let currentDir = resolved
    let existingRealPath = ''

    while (currentDir !== path.parse(currentDir).root) {
        if (fs.existsSync(currentDir)) {
            existingRealPath = fs.realpathSync.native(currentDir)
            break
        }
        currentDir = path.dirname(currentDir)
    }

    if (!existingRealPath) {
        if (fs.existsSync(currentDir)) {
            existingRealPath = fs.realpathSync.native(currentDir) // root resolution
        } else {
            existingRealPath = currentDir
        }
    }

    // The target path is the successfully evaluated real path plus any non-existent trailing segments
    const remainder = path.relative(currentDir, resolved)
    return remainder ? path.join(existingRealPath, remainder) : existingRealPath
}

const ALLOWED_ROOTS_CACHE_TTL_MS = 2_000
const ALLOWED_ROOTS_CACHE_MAX = 128
const allowedRootsCache = new Map<string, { expiresAt: number; roots: string[] }>()

/** Resolve configured IO roots to real paths (cached 2s per rawRoots tuple; falls back on missing). */
function resolveAllowedRoots(rawRoots: string[]): string[] {
    // 3. Define safe boundaries
    if (rawRoots.length === 0) {
        throw new PathTraversalError(
            'No allowed input/output roots configured for sandbox boundary. Please configure ALLOWED_IO_ROOTS env variable or pass --allowed-io-roots with absolute paths (e.g. C:\\my\\path) to enable filesystem operations.'
        )
    }
    const cacheKey = rawRoots.join('\0')
    const now = Date.now()
    const cached = allowedRootsCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
        return cached.roots
    }

    const allowedRoots: string[] = []
    for (const root of rawRoots) {
        const resolvedRoot = path.resolve(root)
        try {
            allowedRoots.push(fs.realpathSync.native(resolvedRoot))
        } catch (err: unknown) {
            const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
            if (code === 'ENOENT') {
                allowedRoots.push(resolveRealTargetPath(resolvedRoot))
                continue
            }
            // Skip inaccessible/broken-symlink roots so other valid roots still resolve; fail closed below if none remain.
        }
    }
    if (allowedRoots.length === 0) {
        throw new PathTraversalError(
            'None of the configured allowed input/output roots could be resolved safely.'
        )
    }
    if (allowedRootsCache.size >= ALLOWED_ROOTS_CACHE_MAX) {
        allowedRootsCache.clear()
    }
    allowedRootsCache.set(cacheKey, { expiresAt: now + ALLOWED_ROOTS_CACHE_TTL_MS, roots: allowedRoots })
    return allowedRoots
}

/** Returns true when `targetPath` resolves structurally inside at least one root in `allowedRoots`. */
function isWithinAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
    const isWin32 = process.platform === 'win32'
    const normalizedTarget = isWin32 ? targetPath.toLowerCase() : targetPath
    return allowedRoots.some((root) => {
        const normalizedRoot = isWin32 ? root.toLowerCase() : root
        const rel = path.relative(normalizedRoot, normalizedTarget)
        // If relative path is '..' or starts with '../' (or '..\'), it escapes the root
        return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
    })
}

const WIN_RESERVED_DEVICE_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i

function hasUnsafeAdsColon(dirPath: string): boolean {
    return dirPath.replace(/^[A-Za-z]:(?=[\\/]|$)/, '').includes(':')
}

/**
 * Validates that a directory path is strictly bounded within the active memory journal context.
 *
 * This enforces strict file-system isolation. The target path MUST reside within:
 * 1. The current working directory (where the server was started)
 * 2. OR any explicitly configured path inside the PROJECT_REGISTRY map.
 *
 * @param dirPath - The directory path to validate
 * @throws PathTraversalError if the path escapes the sandboxed boundaries
 */
export function assertSafeDirectoryPath(dirPath: string, providedRoots: string[]): void {
    if (
        dirPath.includes('\0') ||
        hasUnsafeAdsColon(dirPath) ||
        dirPath
            .replace(/\\/g, '/')
            .split('/')
            .some((s) => s === '..')
    ) {
        throw new PathTraversalError(dirPath)
    }
    const decodedDir = decodeSafeDirPath(dirPath)
    if (hasUnsafeAdsColon(decodedDir)) {
        throw new PathTraversalError(decodedDir)
    }
    const allowedRoots = resolveAllowedRoots(providedRoots)

    // 4. Verify BOTH raw and decoded paths are structurally inside at least one allowed root
    // (blocks symlink escapes via literal percent-encoded names like `%41` that decode differently).
    const rawTarget = resolveRealTargetPath(dirPath)
    if (!isWithinAllowedRoots(rawTarget, allowedRoots)) {
        throw new PathTraversalError(
            `Directory path escapes allowed sandbox boundaries: ${dirPath}`
        )
    }

    if (decodedDir !== dirPath) {
        const decodedTarget = resolveRealTargetPath(decodedDir)
        if (!isWithinAllowedRoots(decodedTarget, allowedRoots)) {
            throw new PathTraversalError(
                `Directory path escapes allowed sandbox boundaries: ${decodedDir}`
            )
        }
    }
}

function assertNotSymbolicLink(candidatePath: string): void {
    try {
        const stats = fs.lstatSync(candidatePath)
        if (stats.isSymbolicLink()) {
            throw new PathTraversalError(
                `Symlinks are strictly forbidden for file operations: ${candidatePath}`
            )
        }
    } catch (err: unknown) {
        if (err instanceof PathTraversalError) {
            throw err
        }
        const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
        if (code === 'ENOENT') return
        throw err
    }
}

/**
 * Validates that a file path is strictly bounded and refuses symlinks (on both raw and
 * percent-decoded paths) to prevent any file-level traversal tricks.
 */
export function assertSafeFilePath(filePath: string, providedRoots: string[]): void {
    // First ensure the logical directory path is within boundaries
    const rawDir = path.dirname(filePath)
    assertSafeDirectoryPath(rawDir, providedRoots)

    // [BOUNDARY] The directory check never sees the basename; reject URL-encoded separators/traversal hidden in it.
    const rawBase = path.basename(filePath)
    let decodedBase: string
    try {
        decodedBase = decodeURIComponent(rawBase)
    } catch {
        throw new PathTraversalError(`Malformed URL-encoding in file name: ${rawBase}`)
    }
    if (
        /[\\/:]/.test(rawBase) ||
        /[\\/:]/.test(decodedBase) ||
        decodedBase === '..' ||
        decodedBase === '.' ||
        decodedBase.includes('\0') ||
        WIN_RESERVED_DEVICE_RE.test(rawBase) ||
        WIN_RESERVED_DEVICE_RE.test(decodedBase)
    ) {
        throw new PathTraversalError(`File name escapes allowed sandbox boundaries: ${decodedBase}`)
    }

    let decodedDir: string
    try {
        decodedDir = decodeURIComponent(rawDir)
    } catch {
        throw new PathTraversalError(`Malformed URL-encoding in directory path: ${rawDir}`)
    }

    const candidates = new Set([
        filePath,
        path.join(rawDir, decodedBase),
        path.join(decodedDir, decodedBase),
    ])
    for (const candidate of candidates) {
        assertNotSymbolicLink(candidate)
    }
}
