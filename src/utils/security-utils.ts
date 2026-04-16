import { execFileSync } from 'node:child_process'
import { MemoryJournalMcpError } from '../types/errors.js'
import { ErrorCategory } from '../types/error-types.js'

/** Timeout for shelling out to git commands (ms) */
const GIT_COMMAND_TIMEOUT_MS = 3000

// ============================================================================
// Typed Security Errors
// ============================================================================

/**
 * Base class for security-related errors.
 * Extends MemoryJournalMcpError with VALIDATION category.
 */
export class SecurityError extends MemoryJournalMcpError {
    constructor(message: string, code: string) {
        super(message, code, ErrorCategory.VALIDATION, {
            suggestion: 'Check input for security violations',
            recoverable: false,
        })
        this.name = 'SecurityError'
    }
}

/**
 * Thrown when an invalid date format pattern is detected
 */
export class InvalidDateFormatError extends SecurityError {
    constructor(value: string) {
        super(`Invalid date format pattern: '${value}'`, 'INVALID_DATE_FORMAT')
        this.name = 'InvalidDateFormatError'
    }
}

/**
 * Thrown when path traversal is detected in input
 */
export class PathTraversalError extends SecurityError {
    constructor(path: string) {
        super(`Path traversal detected: '${path}'`, 'PATH_TRAVERSAL')
        this.name = 'PathTraversalError'
    }
}

// ============================================================================
// Date Format Validation
// ============================================================================

/**
 * Whitelist of allowed strftime format patterns for SQLite.
 * These are the only patterns allowed to be interpolated into SQL.
 */
const ALLOWED_DATE_FORMATS: Record<string, string> = {
    day: '%Y-%m-%d',
    week: '%Y-W%W',
    month: '%Y-%m',
} as const

export type DateGroupBy = 'day' | 'week' | 'month'

/**
 * Validates and returns a safe strftime format pattern.
 *
 * @param groupBy - The grouping period ('day', 'week', or 'month')
 * @returns The validated strftime format pattern
 * @throws InvalidDateFormatError if the groupBy value is invalid
 *
 * @example
 * ```typescript
 * const format = validateDateFormatPattern('day') // Returns '%Y-%m-%d'
 * const format = validateDateFormatPattern('invalid') // Throws InvalidDateFormatError
 * ```
 */
export function validateDateFormatPattern(groupBy: string): string {
    const format = ALLOWED_DATE_FORMATS[groupBy]
    if (!format) {
        throw new InvalidDateFormatError(groupBy)
    }
    return format
}

// ============================================================================
// Search Query Sanitization
// ============================================================================

/**
 * Escapes special characters in LIKE patterns to prevent injection.
 * SQLite LIKE uses % and _ as wildcards.
 *
 * @param query - The user-provided search query
 * @returns Escaped query safe for use in LIKE patterns
 *
 * @example
 * ```typescript
 * sanitizeSearchQuery('100%') // Returns '100\\%'
 * sanitizeSearchQuery('test_value') // Returns 'test\\_value'
 * ```
 */
export function sanitizeSearchQuery(query: string): string {
    // Escape backslashes first, then LIKE wildcards
    return query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Validates that a filename does not contain path traversal characters.
 *
 * @param filename - The filename to validate
 * @throws PathTraversalError if path traversal is detected
 */
export function assertNoPathTraversal(filename: string): void {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        throw new PathTraversalError(filename)
    }
}

import fs from 'node:fs'
import path from 'node:path'

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
export function assertSafeDirectoryPath(dirPath: string, providedRoots?: string[]): void {
    // 1. Initial basic check for traversal strings
    const normalized = dirPath.replace(/\\/g, '/')
    const segments = normalized.split('/')
    if (segments.some((s) => s === '..')) {
        throw new PathTraversalError(dirPath)
    }

    const resolved = path.resolve(dirPath)

    // 2. Resolve realpath iteratively by stepping up the tree until an existing directory is found.
    // This prevents symlink traversal bypasses where the final node does not exist but a parent is a symlink pointing outside.
    let currentDir = resolved
    let existingRealPath = ''

    while (currentDir !== path.parse(currentDir).root) {
        try {
            existingRealPath = fs.realpathSync(currentDir)
            break
        } catch {
            currentDir = path.dirname(currentDir)
        }
    }

    if (!existingRealPath) {
        try {
            existingRealPath = fs.realpathSync(currentDir) // root resolution
        } catch {
            existingRealPath = currentDir
        }
    }

    // The target path is the successfully evaluated real path plus any non-existent trailing segments
    const remainder = path.relative(currentDir, resolved)
    const targetPath = remainder ? path.join(existingRealPath, remainder) : existingRealPath

    // 3. Define safe boundaries
    const rawRoots: string[] = providedRoots ?? [process.cwd()]
    const allowedRoots: string[] = []

    for (const root of rawRoots) {
        try {
            allowedRoots.push(fs.realpathSync(path.resolve(root)))
        } catch {
            allowedRoots.push(path.resolve(root))
        }
    }

    // 4. Verify the targetPath is structurally inside at least one allowed root
    const isAllowed = allowedRoots.some(root => {
        const rel = path.relative(root, targetPath)
        // If relative path is '..' or starts with '../' (or '..\'), it escapes the root
        return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
    })

    if (!isAllowed) {
        throw new PathTraversalError(`Directory path escapes allowed sandbox boundaries: ${dirPath}`)
    }
}

/**
 * Validates that a file path is strictly bounded and refuses symlinks to prevent
 * any file-level traversal tricks.
 */
export function assertSafeFilePath(filePath: string, providedRoots?: string[]): void {
    // First ensure the logical path is within boundaries
    assertSafeDirectoryPath(path.dirname(filePath), providedRoots)

    // Second, if the file exists, ensure it is not a symlink that could trick the system
    try {
        const stats = fs.lstatSync(filePath)
        if (stats.isSymbolicLink()) {
            throw new PathTraversalError(`Symlinks are strictly forbidden for file operations: ${filePath}`)
        }
    } catch (err: unknown) {
        // If file doesn't exist, that's fine, but if it's our error, throw it
        if (err instanceof PathTraversalError) {
            throw err
        }
    }
}

// ============================================================================
// Error Message Sanitization
// ============================================================================

/**
 * Patterns that may contain sensitive tokens in error messages.
 * Used to scrub error output before logging.
 */
const TOKEN_PATTERNS = [
    // GitHub personal access tokens (classic and fine-grained)
    /ghp_[A-Za-z0-9_]{36,}/g,
    /github_pat_[A-Za-z0-9_]{82,}/g,
    // Authorization headers in error dumps
    /Authorization:\s*(?:token|Bearer)\s+\S+/gi,
    // Generic Bearer tokens
    /Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi,
] as const

/**
 * Sanitizes an error message by replacing any detected tokens with '[REDACTED]'.
 * This is a defense-in-depth measure for error logging paths.
 *
 * @param message - The error message to sanitize
 * @returns The sanitized message with tokens replaced
 */
export function sanitizeErrorForLogging(message: string): string {
    let sanitized = message
    for (const pattern of TOKEN_PATTERNS) {
        // Reset lastIndex for global regex patterns
        pattern.lastIndex = 0
        sanitized = sanitized.replace(pattern, '[REDACTED]')
    }
    return sanitized
}

// ============================================================================
// Author Sanitization
// ============================================================================

/**
 * Sanitize an author string: strip control characters and cap length.
 * Prevents crafted git config or TEAM_AUTHOR values from injecting
 * control characters into the database or JSON payloads.
 *
 * @param raw - The raw author string from git config or environment
 * @returns Sanitized string with control characters removed and length capped at 100
 */
export function sanitizeAuthor(raw: string): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100)
}

// ============================================================================
// Author Resolution
// ============================================================================

let cachedAuthor: string | null = null

/**
 * Resolve the author name for team-shared entries.
 * Priority: TEAM_AUTHOR env → git config user.name → 'unknown'.
 * Caches the result after the first lookup.
 *
 * Uses sanitizeAuthor() to strip control characters and cap length.
 */
export function resolveAuthor(): string {
    if (cachedAuthor !== null) return cachedAuthor

    const envAuthor = process.env['TEAM_AUTHOR']?.trim().replace(/"/g, '')
    if (envAuthor) {
        cachedAuthor = sanitizeAuthor(envAuthor)
        return cachedAuthor
    }

    try {
        const gitUser = execFileSync('git', ['config', 'user.name'], {
            encoding: 'utf-8',
            timeout: GIT_COMMAND_TIMEOUT_MS,
        })
            .trim()
            .replace(/"/g, '')
        if (gitUser) {
            cachedAuthor = sanitizeAuthor(gitUser)
            return cachedAuthor
        }
    } catch {
        // Git not available
    }

    cachedAuthor = 'unknown'
    return cachedAuthor
}
