import { getAuthContext } from '../auth/auth-context.js'
import { SecurityError, PathTraversalError } from './path-safety.js'

export {
    SecurityError,
    PathTraversalError,
    assertSafeDirectoryPath,
    assertSafeFilePath,
} from './path-safety.js'

// ============================================================================
// Typed Security Errors
// ============================================================================

/**
 * Thrown when an invalid date format pattern is detected
 */
export class InvalidDateFormatError extends SecurityError {
    constructor(value: string) {
        super(`Invalid date format pattern: '${value}'`, 'INVALID_DATE_FORMAT')
        this.name = 'InvalidDateFormatError'
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
    year: '%Y',
} as const

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
    if (!Object.hasOwn(ALLOWED_DATE_FORMATS, groupBy)) {
        throw new InvalidDateFormatError(groupBy)
    }
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

// ============================================================================
// Error Message Sanitization
// ============================================================================

/**
 * Patterns that may contain sensitive tokens in error messages.
 * Used to scrub error output before logging.
 */
const TOKEN_PATTERNS = [
    // GitHub personal access tokens (classic and fine-grained)
    /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    /github_pat_[A-Za-z0-9_]{82,}/g,
    // JWT Tokens
    /eyJ[a-zA-Z0-9_-]{2,}\.eyJ[a-zA-Z0-9_-]{2,}\.[a-zA-Z0-9_-]{2,}/g,
    // Slack tokens
    /xox[baprs]-[A-Za-z0-9-]+/g,
    // AWS API Keys
    /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g,
    // Authorization headers in error dumps (catch-all for token, Bearer, Basic)
    /Authorization:(?:\s+(?:token|Bearer|Basic))?\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
    // Generic token patterns standalone
    /Bearer\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
    /Basic\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
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
// Untrusted Content Boundaries
// ============================================================================

/**
 * Marks free-text content as untrusted remote origin for LLM instruction consumption.
 * Defends against prompt-injection by surrounding external inputs with tags.
 *
 * Will not insert nested tags if the content is already marked.
 */
export function markUntrustedContent(content: string | undefined | null): string {
    if (!content) return ''
    let trimmed = content.trim()
    if (!trimmed) return ''

    // Strip any existing literal or entity-encoded tags to prevent breakout/nesting
    trimmed = trimmed.replace(
        /&lt;\/?untrusted_remote_content[^&]*&gt;|<\/?untrusted_remote_content[^>]*>/gi,
        ''
    )
    // Escape HTML entities to prevent prompt injection (& first so &lt; cannot be unescaped)
    trimmed = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    return `<untrusted_remote_content>\n${trimmed}\n</untrusted_remote_content>`
}

/**
 * Utility for formatting remote content natively for inline single-line contexts.
 */
export function markUntrustedContentInline(content: string | undefined | null): string {
    if (!content) return ''
    let cleaned = content

    // Strip existing literal or entity-encoded wrappers to normalize for inline layout
    cleaned = cleaned.replace(
        /&lt;\/?untrusted_remote_content[^&]*&gt;|<\/?untrusted_remote_content[^>]*>/gi,
        ''
    )
    // Escape HTML entities to prevent prompt injection (& first so &lt; cannot be unescaped)
    cleaned = cleaned.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    return `<untrusted_remote_content>${cleaned}</untrusted_remote_content>`
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
    return raw.replace(/\p{Cc}/gu, '').slice(0, 100)
}

// ============================================================================
// Author Resolution
// ============================================================================

/**
 * Resolve the author name strictly from the authenticated context.
 * Prioritizes authenticated claims over TEAM_AUTHOR environment variables.
 * Uses sanitizeAuthor() to strip control characters and cap length.
 */
export function nonEmptyAuthClaim(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.toLowerCase() !== 'unknown' ? trimmed : undefined
}

export function resolveAuthenticatedAuthor(): string {
    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const claims = authCtx.claims
        const claimAuthor =
            nonEmptyAuthClaim(claims?.['email']) ??
            nonEmptyAuthClaim(claims?.['preferred_username']) ??
            nonEmptyAuthClaim(claims?.sub) ??
            nonEmptyAuthClaim(claims?.['subject']) ??
            nonEmptyAuthClaim(claims?.client_id)
        if (claimAuthor !== undefined) {
            const sanitized = sanitizeAuthor(claimAuthor)
            if (sanitized.length > 0 && sanitized.toLowerCase() !== 'unknown') {
                return sanitized
            }
        }
        return 'unknown'
    }

    return resolveAuthor()
}

function sanitizeValidAuthor(raw: string | undefined): string | undefined {
    if (raw === undefined || raw === '') return undefined
    const sanitized = sanitizeAuthor(raw).trim()
    if (sanitized === '' || sanitized.toLowerCase() === 'unknown') return undefined
    return sanitized
}

/**
 * Resolve the author name for team-shared entries.
 * Priority: TEAM_AUTHOR env → req.auth.sub → local OS username → 'unknown'.
 * Uses sanitizeAuthor() to strip control characters and cap length, falling
 * through to lower priorities if sanitization produces `""` or `'unknown'`.
 */
export function resolveAuthor(): string {
    const envAuthor = sanitizeValidAuthor(process.env['TEAM_AUTHOR']?.trim().replace(/"/g, ''))
    if (envAuthor !== undefined) {
        return envAuthor
    }

    const authCtx = getAuthContext()
    const claimSub = sanitizeValidAuthor(authCtx?.claims?.sub)
    if (claimSub !== undefined) {
        return claimSub
    }
    if (authCtx?.authenticated) {
        return 'unknown'
    }

    const localUser = process.env['USERNAME'] || process.env['USER']
    const sanitizedLocal = sanitizeValidAuthor(localUser?.toLowerCase())
    if (sanitizedLocal !== undefined) {
        return sanitizedLocal
    }

    return 'unknown'
}
