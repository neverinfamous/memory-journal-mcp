/**
 * Security Utilities for Memory Journal MCP Server
 *
 * Centralized security validation following MCP Security Patterns.
 * Uses typed errors for consistent error handling across the codebase.
 */

// ============================================================================
// Typed Security Errors
// ============================================================================

/**
 * Base class for security-related errors
 */
export class SecurityError extends Error {
    readonly code: string

    constructor(message: string, code: string) {
        super(message)
        this.name = 'SecurityError'
        this.code = code
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
 * Thrown when SQL injection patterns are detected in input
 */
export class SqlInjectionError extends SecurityError {
    constructor(pattern: string) {
        super(`Potential SQL injection detected: '${pattern}'`, 'SQL_INJECTION')
        this.name = 'SqlInjectionError'
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
// SQL Injection Detection
// ============================================================================

/**
 * Patterns that indicate SQL injection attempts.
 * Used for validation in edge cases where parameterized queries aren't possible.
 */
const SQL_INJECTION_PATTERNS = [
    /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|TRUNCATE)/i,
    /--\s*/,
    /\/\*[\s\S]*?\*\//,
    /UNION\s+(ALL\s+)?SELECT/i,
    /'\s*OR\s+['"]?1['"]?\s*=\s*['"]?1/i,
    /ATTACH\s+DATABASE/i,
    /DETACH\s+DATABASE/i,
    /load_extension\s*\(/i,
] as const

/**
 * Checks if a string contains potential SQL injection patterns.
 * This is a secondary defense layer; parameterized queries are the primary defense.
 *
 * @param input - The string to check
 * @returns true if injection patterns are detected, false otherwise
 */
export function containsSqlInjection(input: string): boolean {
    return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(input))
}

/**
 * Validates that input does not contain SQL injection patterns.
 *
 * @param input - The string to validate
 * @throws SqlInjectionError if injection patterns are detected
 */
export function assertNoSqlInjection(input: string): void {
    if (containsSqlInjection(input)) {
        throw new SqlInjectionError(input.substring(0, 50))
    }
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
