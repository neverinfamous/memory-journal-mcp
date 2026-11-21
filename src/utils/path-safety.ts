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

function selectPathModule(targetInput: string): typeof path {
    return WIN_DRIVE_PATH_RE.test(targetInput) ? path.win32 : path
}

/**
 * Resolve the real path of the target, stepping up to the nearest existing ancestor so symlinked
 * parents cannot be used to escape when the final node does not exist yet.
 */
function resolveRealTargetPath(targetInput: string): string {
    const pathMod = selectPathModule(targetInput)
    const normalizedInput = pathMod === path.win32 ? targetInput.replace(/\//g, '\\') : targetInput
    const resolved = pathMod.resolve(normalizedInput)

    // 2. Resolve realpath iteratively by stepping up the tree until an existing directory is found.
    // This prevents symlink traversal bypasses where the final node does not exist but a parent is a symlink pointing outside.
    const root = pathMod.parse(resolved).root
    let currentDir = resolved
    let existingRealPath = ''

    while (currentDir !== root) {
        try {
            existingRealPath = fs.realpathSync.native(currentDir)
            break
        } catch (err: unknown) {
            let stat: fs.Stats | undefined
            try {
                stat = fs.lstatSync(currentDir, { throwIfNoEntry: false })
            } catch {
                // Inaccessible segment (e.g., EACCES/ENOTDIR); step up to parent
                stat = undefined
            }
            if (stat?.isSymbolicLink()) {
                throw new PathTraversalError(
                    `Dangling symbolic link cannot be verified inside sandbox boundaries: ${currentDir}`
                )
            }
            if (stat !== undefined) {
                const code =
                    typeof err === 'object' && err !== null && 'code' in err
                        ? (err as { code?: unknown }).code
                        : undefined
                if (code !== 'ENOENT') throw err
            }
        }
        currentDir = pathMod.dirname(currentDir)
    }

    if (!existingRealPath) {
        try {
            existingRealPath = fs.realpathSync.native(currentDir) // root resolution
        } catch {
            existingRealPath = currentDir
        }
    }

    // The target path is the successfully evaluated real path plus any non-existent trailing segments
    const remainder = pathMod.relative(currentDir, resolved)
    return remainder ? pathMod.join(existingRealPath, remainder) : existingRealPath
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
        const pathMod = selectPathModule(root)
        const normalizedRoot = pathMod === path.win32 ? root.replace(/\//g, '\\') : root
        const resolvedRoot = pathMod.resolve(normalizedRoot)
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

const WIN_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/

function pathIsInsideRoot(root: string, targetPath: string): boolean {
    const winSyntax = WIN_DRIVE_PATH_RE.test(root) || WIN_DRIVE_PATH_RE.test(targetPath)
    const pathMod = winSyntax ? path.win32 : path
    const caseFold = winSyntax || process.platform === 'win32'
    const rawRoot = winSyntax ? root.replace(/\//g, '\\') : root
    const rawTarget = winSyntax ? targetPath.replace(/\//g, '\\') : targetPath
    const normalizedRoot = caseFold ? pathMod.resolve(rawRoot).toLowerCase() : pathMod.resolve(rawRoot)
    const normalizedTarget = caseFold ? pathMod.resolve(rawTarget).toLowerCase() : pathMod.resolve(rawTarget)
    const rel = pathMod.relative(normalizedRoot, normalizedTarget)
    return rel !== '..' && !rel.startsWith(`..${pathMod.sep}`) && !pathMod.isAbsolute(rel)
}

/** Returns true when `targetPath` resolves structurally inside at least one root in `allowedRoots`. */
function isWithinAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
    return allowedRoots.some((root) => pathIsInsideRoot(root, targetPath))
}

const WIN_RESERVED_DEVICE_RE =
    /^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\s*\..*)?\s*$/i
const WIN_DRIVE_RELATIVE_RE = /^[A-Za-z]:(?![\\/])/

export function hasUnsafeAdsColon(dirPath: string): boolean {
    const trimmed = dirPath.trimStart()
    return WIN_DRIVE_RELATIVE_RE.test(trimmed) || trimmed.replace(/^[A-Za-z]:(?=[\\/])/, '').includes(':')
}

export function hasTrailingDotOrSpaceSegment(targetPath: string): boolean {
    const segments = targetPath.split(/[\\/]/)
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (seg === undefined || seg === '' || seg === '.' || seg === '..') continue
        if (i === 0 && /^[A-Za-z]:$/.test(seg)) continue
        if (/[. ]$/.test(seg)) return true
    }
    return false
}

function hasTrailingSpaceSegment(targetPath: string): boolean {
    const segments = targetPath.split(/[\\/]/)
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (seg === undefined || seg === '' || seg === '.' || seg === '..') continue
        if (i === 0 && /^[A-Za-z]:$/.test(seg)) continue
        if (/\s$/.test(seg)) return true
    }
    return false
}

function stripWinTrailingDotsAndSpaces(targetPath: string): string {
    return targetPath
        .split(/([\\/])/)
        .map((part, idx) => {
            if (part === '' || part === '/' || part === '\\' || part === '.' || part === '..') {
                return part
            }
            if (idx === 0 && /^[A-Za-z]:$/.test(part)) return part
            return part.replace(/[. ]+$/, '')
        })
        .join('')
}

/**
 * Returns true if any non-drive path segment matches a Win32 reserved device name
 * (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including trailing dots/spaces).
 */
export function hasWinReservedDeviceSegment(targetPath: string): boolean {
    const segments = targetPath.split(/[\\/]/)
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (seg === undefined || seg === '' || seg === '.' || seg === '..') continue
        if (i === 0 && /^[A-Za-z]:$/.test(seg)) continue
        if (WIN_RESERVED_DEVICE_RE.test(seg)) return true
    }
    return false
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
const UNC_OR_WIN_DEVICE_PREFIX_RE = /^[\\/]{2}/

function extractUncShareRoot(rawPath: string): { hostShare: string; segments: string[] } | null {
    const normalized = rawPath.trimStart().replace(/\\/g, '/')
    if (!normalized.startsWith('//')) return null
    const rest = normalized.slice(2).replace(/\/+$/, '')
    const parts = rest.split('/')
    const host = parts[0] ?? ''
    const share = parts[1] ?? ''
    if (host === '' || host === '.' || host === '?' || share === '') return null
    return {
        hostShare: `//${host.toLowerCase()}/${share.toLowerCase()}`,
        segments: parts.map((s) => s.toLowerCase()),
    }
}

function isWithinLogicalUncRoot(targetPath: string, providedRoots: readonly string[]): boolean {
    const forward = targetPath.trimStart().replace(/\\/g, '/')
    if (forward.split('/').some((s) => s === '..')) return false
    const targetUnc = extractUncShareRoot(targetPath)
    if (targetUnc === null) return false
    return providedRoots.some((root) => {
        const rootUnc = extractUncShareRoot(root)
        if (rootUnc?.hostShare !== targetUnc.hostShare) return false
        if (targetUnc.segments.length < rootUnc.segments.length) return false
        for (let i = 0; i < rootUnc.segments.length; i++) {
            if (targetUnc.segments[i] !== rootUnc.segments[i]) return false
        }
        return true
    })
}

function hasUncOrWinDevicePrefix(targetPath: string, providedRoots: readonly string[]): boolean {
    const trimmed = targetPath.trimStart()
    if (!UNC_OR_WIN_DEVICE_PREFIX_RE.test(trimmed)) return false
    // Reject `\\.\` / `\\?\` / `\/.\` / `/\?\` / `//./` / `//?/` Win32 device namespace prefixes unconditionally
    if (/^[\\/]{2}[.?][\\/]/.test(trimmed)) return true
    // On Windows (or for prefixes containing a backslash), block UNC paths prior to any fs syscall unless within a configured UNC root's share and prefix
    const leadingTwo = trimmed.slice(0, 2)
    if (process.platform !== 'win32' && !leadingTwo.includes('\\')) return false
    return !isWithinLogicalUncRoot(trimmed, providedRoots)
}

export function assertSafeDirectoryPath(dirPath: string, providedRoots: string[]): void {
    if (
        dirPath.includes('\0') ||
        hasUncOrWinDevicePrefix(dirPath, providedRoots) ||
        hasUnsafeAdsColon(dirPath) ||
        hasWinReservedDeviceSegment(dirPath) ||
        hasTrailingSpaceSegment(dirPath) ||
        dirPath
            .replace(/\\/g, '/')
            .split('/')
            .some((s) => s === '..')
    ) {
        throw new PathTraversalError(dirPath)
    }
    const decodedDir = decodeSafeDirPath(dirPath)
    if (
        decodedDir !== dirPath &&
        (hasUncOrWinDevicePrefix(decodedDir, providedRoots) ||
            hasUnsafeAdsColon(decodedDir) ||
            hasWinReservedDeviceSegment(decodedDir) ||
            hasTrailingSpaceSegment(decodedDir))
    ) {
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

    const winTrimmed = stripWinTrailingDotsAndSpaces(decodedDir)
    if (
        winTrimmed !== decodedDir &&
        !isWithinAllowedRoots(resolveRealTargetPath(winTrimmed), allowedRoots)
    ) {
        throw new PathTraversalError(
            `Directory path escapes allowed sandbox boundaries: ${winTrimmed}`
        )
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
 * Validates basename traversal/encoding/device rules and refuses symlinks inside an
 * already-validated parent directory.
 */
export function assertSafeChildFile(rawDir: string, rawBase: string, filePath?: string): void {
    const pathMod: typeof path = WIN_DRIVE_PATH_RE.test(rawDir) ? path.win32 : path
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
        /[.\s]$/.test(rawBase) ||
        /[.\s]$/.test(decodedBase) ||
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

    const targetPath = filePath ?? pathMod.join(rawDir, rawBase)
    const candidates = new Set([
        targetPath,
        pathMod.join(rawDir, decodedBase),
        pathMod.join(decodedDir, decodedBase),
    ])
    for (const candidate of candidates) {
        assertNotSymbolicLink(candidate)
    }
}

/**
 * Validates that a file path is strictly bounded and refuses symlinks (on both raw and
 * percent-decoded paths) to prevent any file-level traversal tricks.
 */
export function assertSafeFilePath(filePath: string, providedRoots: string[]): void {
    if (WIN_DRIVE_RELATIVE_RE.test(filePath.trimStart())) {
        throw new PathTraversalError(filePath)
    }
    const pathMod: typeof path = WIN_DRIVE_PATH_RE.test(filePath) ? path.win32 : path
    // First ensure the logical directory path is within boundaries
    const rawDir = pathMod.dirname(filePath)
    assertSafeDirectoryPath(rawDir, providedRoots)

    // [BOUNDARY] The directory check never sees the basename; reject URL-encoded separators/traversal hidden in it.
    assertSafeChildFile(rawDir, pathMod.basename(filePath), filePath)
}
