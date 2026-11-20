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
export const SENSITIVE_KEY_RE =
    /(?:token|secret|password|passwd|passphrase|authorization|auth[-_]?header|api[-_]?key|apikey|encryption[-_]?key|webhook(?:[-_]?(?:auth|url))?|private[-_]?key|client[-_]?secret|credential|cookie|bearer|^key$)/i

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
    // CLI secret flags (--auth-token, --github-token, --oauth-client-secret, --token, --secret, --password, --passphrase, --api-key, --webhook-auth, --encryption-key, --key)
    /(--(?:(?:[a-z0-9_-]+[-_])?(?:auth[-_]?token|token|secret|password|passphrase|api[-_]?key|webhook[-_]?auth|encryption[-_]?key|private[-_]?key)|key)(?:=|\s+))("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"']+)/gi,
    // SQLCipher key/rekey pragmas (handles escaped '' / \' within single quotes and "" / \" within double quotes)
    /(pragma\s+(?:re)?key\s*=\s*)(?:"x'[^']*'"|x'[^']*'|'(?:\\.|[^'\\]|'')*'|"(?:\\.|[^"\\]|"")*")/gi,
    // URL embedded credentials
    /(https?:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi,
    // Authorization headers in error dumps (catch-all for token, Bearer, Basic)
    /Authorization:(?:\s+(?:token|Bearer|Basic))?\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
    // Generic token patterns standalone
    /Bearer\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
    /Basic\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi,
] as const

const POTENTIAL_SECRET_RE =
    /(?:gh[pousr]_|github_pat_|eyJ|xox[baprs]-|AKIA|ABIA|ACCA|ASIA|Authorization:|Bearer\s|Basic\s|--(?:(?:[a-z0-9_-]+[-_])?(?:auth[-_]?token|token|secret|password|passphrase|api[-_]?key|webhook[-_]?auth|encryption[-_]?key|private[-_]?key)|key)(?:=|\s)|pragma\s+(?:re)?key\s*=|https?:\/\/[^/\s:@]+:[^/\s@]+@)/i

/**
 * Sanitizes an error message by replacing any detected tokens with '[REDACTED]'.
 * This is a defense-in-depth measure for error logging paths.
 *
 * @param message - The error message to sanitize
 * @returns The sanitized message with tokens replaced
 */
export function sanitizeErrorForLogging(message: string): string {
    if (!POTENTIAL_SECRET_RE.test(message)) return message
    let sanitized = message
    for (let i = 0; i < TOKEN_PATTERNS.length; i++) {
        const pattern = TOKEN_PATTERNS[i]
        if (pattern === undefined) continue
        pattern.lastIndex = 0
        if (i === 5) {
            sanitized = sanitized.replace(pattern, '$1[REDACTED]')
        } else if (i === 6) {
            sanitized = sanitized.replace(pattern, "$1'[REDACTED]'")
        } else if (i === 7) {
            sanitized = sanitized.replace(pattern, '$1[REDACTED]$2')
        } else {
            sanitized = sanitized.replace(pattern, '[REDACTED]')
        }
    }
    return sanitized
}

// ============================================================================
// Untrusted Content Boundaries
// ============================================================================

// C0/C1 control chars excluding horizontal tab (\t), LF (\n), and CR (\r), plus Unicode line/paragraph separators.
function stripUntrustedControlChars(value: string): string {
    return value.replace(/[\p{Cc}\u2028\u2029]/gu, (ch) =>
        ch === '\t' || ch === '\n' || ch === '\r' ? ch : ''
    )
}

function hasUntrustedControlChars(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i)
        if (
            c <= 8 ||
            c === 11 ||
            c === 12 ||
            (c >= 14 && c <= 31) ||
            (c >= 127 && c <= 159) ||
            c === 0x2028 ||
            c === 0x2029
        ) {
            return true
        }
    }
    return false
}

function unescapeFenceEntities(value: string): string {
    return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function markUntrustedContent(content: string | undefined | null): string {
    if (!content) return ''
    let trimmed = stripUntrustedControlChars(content).trim()
    if (!trimmed) return ''
    if (isAlreadyFencedUntrustedContent(trimmed)) return trimmed

    // Strip any existing literal or entity-encoded tags to prevent breakout/nesting, then normalize
    // entities so repeated calls stay idempotent without growing `&amp;lt;`.
    trimmed = stripUntrustedControlChars(
        unescapeFenceEntities(
            trimmed.replace(
                /&lt;\/?untrusted_remote_content[^&]*&gt;|<\/?untrusted_remote_content[^>]*>/gi,
                ''
            )
        )
    ).trim()
    if (!trimmed) return ''
    // Escape HTML entities to prevent prompt injection (& first so &lt; cannot be unescaped)
    trimmed = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    return `<untrusted_remote_content>\n${trimmed}\n</untrusted_remote_content>`
}

const INLINE_ALREADY_FENCED_RE =
    /^<untrusted_remote_content>[^<>\r\n\u2028\u2029]*<\/untrusted_remote_content>$/
const BLOCK_ALREADY_FENCED_RE =
    /^<untrusted_remote_content>(?:\n[^<>\u2028\u2029]*\n|[^<>\r\n\u2028\u2029]*)<\/untrusted_remote_content>$/
const ENCODED_FENCE_TAG_RE = /&lt;\/?untrusted_remote_content/i

/** Return true when `value` already has a single unescaped inline `<untrusted_remote_content>` wrapper. */
export function isAlreadyInlineFencedUntrustedContent(value: string): boolean {
    return (
        INLINE_ALREADY_FENCED_RE.test(value) &&
        !ENCODED_FENCE_TAG_RE.test(value) &&
        !hasUntrustedControlChars(value)
    )
}

/** Return true when `value` already has a single unescaped block or inline `<untrusted_remote_content>` wrapper. */
export function isAlreadyFencedUntrustedContent(value: string): boolean {
    return (
        BLOCK_ALREADY_FENCED_RE.test(value) &&
        !ENCODED_FENCE_TAG_RE.test(value) &&
        !hasUntrustedControlChars(value)
    )
}

/** Fence non-canonical git refs, branch names, or dynamic map keys containing markup/control chars. */
export function fenceNonCanonicalRefOrKey(value: string, allowSpaces = false): string {
    const needsFence = allowSpaces
        ? /[<>&\r\n\u2028\u2029]/u.test(value) || /\p{Cc}/u.test(value)
        : /[<>&\r\n\u2028\u2029\s]/u.test(value) || /\p{Cc}/u.test(value)
    if (!needsFence) return value
    return isAlreadyInlineFencedUntrustedContent(value)
        ? value
        : markUntrustedContentInline(value)
}

/**
 * Utility for formatting remote content natively for inline single-line contexts.
 */
export function markUntrustedContentInline(content: string | undefined | null): string {
    if (!content) return ''
    let cleaned = stripUntrustedControlChars(content.replace(/[\r\n\u2028\u2029]+/g, ' '))
    if (isAlreadyInlineFencedUntrustedContent(cleaned)) return cleaned

    // Strip existing literal or entity-encoded wrappers to normalize for inline layout
    cleaned = stripUntrustedControlChars(
        unescapeFenceEntities(
            cleaned.replace(
                /&lt;\/?untrusted_remote_content[^&]*&gt;|<\/?untrusted_remote_content[^>]*>/gi,
                ''
            )
        )
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
    return raw.replace(/[\p{Cc}\u2028\u2029]/gu, '').slice(0, 100)
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
        const verifiedEmail =
            claims?.['email_verified'] === true ? nonEmptyAuthClaim(claims['email']) : undefined
        const claimAuthor =
            nonEmptyAuthClaim(claims?.sub) ??
            nonEmptyAuthClaim(claims?.['subject']) ??
            verifiedEmail ??
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
