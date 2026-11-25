import { getAuthContext } from '../auth/auth-context.js'
import { SecurityError, PathTraversalError } from './path-safety.js'

export {
    SecurityError,
    PathTraversalError,
    assertSafeChildFile,
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

const TOKEN_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
    // GitHub personal access tokens (classic and fine-grained)
    { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: '[REDACTED]' },
    { pattern: /github_pat_[A-Za-z0-9_]{82,}/g, replacement: '[REDACTED]' },
    // JWT Tokens
    { pattern: /eyJ[a-zA-Z0-9_-]{2,}\.eyJ[a-zA-Z0-9_-]{2,}\.[a-zA-Z0-9_-]{2,}/g, replacement: '[REDACTED]' },
    // Slack tokens
    { pattern: /xox[baprs]-[A-Za-z0-9-]+/g, replacement: '[REDACTED]' },
    // AWS API Keys
    { pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
    // Authorization headers & Bearer/Basic tokens BEFORE CLI secret-flag pattern
    { pattern: /Authorization:(?:\s+(?:token|Bearer|Basic))?\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi, replacement: '[REDACTED]' },
    { pattern: /Bearer\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi, replacement: '[REDACTED]' },
    { pattern: /Basic\s+["']?[A-Za-z0-9._~+/#=-]+["']?/gi, replacement: '[REDACTED]' },
    // CLI secret flags (--auth-token, --github-token, --oauth-client-secret, --token, --secret, --password, --passphrase, --api-key, --webhook-auth, --encryption-key, --key)
    {
        pattern: /(?<![A-Za-z0-9_-])(--(?:(?:[a-z0-9]{1,32}[-_]){0,4}(?:auth[-_]?token|token|secret|password|passphrase|api[-_]?key|webhook[-_]?auth|encryption[-_]?key|private[-_]?key)|key)(?:=|\s+))("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"']+)/gi,
        replacement: '$1[REDACTED]',
    },
    // SQLCipher key/rekey pragmas (handles escaped '' / \' within single quotes and "" / \" within double quotes)
    {
        pattern: /(pragma\s+(?:re)?key\s*=\s*)(?:"x'[^']*'"|x'[^']*'|'(?:\\.|[^'\\]|'')*'|"(?:\\.|[^"\\]|"")*")/gi,
        replacement: "$1'[REDACTED]'",
    },
    // URL embedded credentials
    { pattern: /(https?:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi, replacement: '$1[REDACTED]$2' },
] as const

const POTENTIAL_SECRET_RE =
    /(?:gh[pousr]_|github_pat_|eyJ|xox[baprs]-|AKIA|ABIA|ACCA|ASIA|Authorization:|Bearer\s|Basic\s|(?<![A-Za-z0-9_-])--(?:(?:[a-z0-9]{1,32}[-_]){0,4}(?:auth[-_]?token|token|secret|password|passphrase|api[-_]?key|webhook[-_]?auth|encryption[-_]?key|private[-_]?key)|key)(?:=|\s)|pragma\s+(?:re)?key\s*=|https?:\/\/[^/\s:@]+:[^/\s@]+@)/i

const DEFAULT_PLACEHOLDER_AUTH_TOKEN = 'change_this_to_a_secure_token_for_production'

/** Returns true when `token` matches a default or `CHANGEME_` placeholder secret. */
export function isPlaceholderAuthToken(token: string | undefined | null): boolean {
    if (typeof token !== 'string') return false
    const trimmed = token.trim()
    return trimmed === DEFAULT_PLACEHOLDER_AUTH_TOKEN || /^CHANGEME_/i.test(trimmed)
}

const REMOTE_URL_USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^/\s]+@/i
const SCP_URL_PASSWORD_RE = /^([^/\s:@]+):[^/\s@]+@/

/**
 * Strip embedded credentials or userinfo from a Git remote URL and redact residual tokens.
 */
export function sanitizeRemoteUrl(remoteUrl: string | null | undefined): string | null {
    if (remoteUrl === null || remoteUrl === undefined) return null
    const trimmed = remoteUrl.trim()
    if (trimmed === '') return null

    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol === 'ssh:' || parsed.protocol === 'sftp:') {
            parsed.password = ''
            if (parsed.username !== 'git') {
                parsed.username = ''
            }
        } else {
            parsed.username = ''
            parsed.password = ''
        }
        return sanitizeErrorForLogging(parsed.toString())
    } catch {
        const stripped = trimmed
            .replace(REMOTE_URL_USERINFO_RE, '$1')
            .replace(SCP_URL_PASSWORD_RE, '$1@')
        return sanitizeErrorForLogging(stripped)
    }
}

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
    for (const rule of TOKEN_PATTERNS) {
        rule.pattern.lastIndex = 0
        sanitized = sanitized.replace(rule.pattern, rule.replacement)
    }
    return sanitized
}

// ============================================================================
// Untrusted Content Boundaries
// ============================================================================

// C0/C1 control chars excluding horizontal tab (\t), LF (\n), and CR (\r), plus Unicode line/paragraph separators.
function stripUntrustedControlChars(value: string): string {
    if (!hasUntrustedControlChars(value)) return value
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

/**
 * [BOUNDARY] Strip literal and entity-encoded `<untrusted_remote_content>` tags in a bounded
 * fixed-point loop so split/nested tags cannot reconstruct themselves, while forbidding the
 * encoded-tag pattern from crossing `¦` list separators, newlines, or other entities.
 */
function stripNestedFenceTags(value: string): string {
    let current = value
    for (let pass = 0; pass < 8; pass++) {
        const stripped = current.replace(
            /&lt;\/?untrusted_remote_content[^&¦\r\n<>]*&gt;|<\/?untrusted_remote_content[^<>¦\r\n]*>/gi,
            ''
        )
        if (stripped === current) break
        current = stripped
    }
    return current
}

export function markUntrustedContent(content: string | undefined | null): string {
    if (!content) return ''
    let trimmed = stripUntrustedControlChars(content).trim()
    if (!trimmed) return ''
    if (isAlreadyFencedUntrustedContent(trimmed)) return trimmed

    // Strip any existing literal or entity-encoded tags to prevent breakout/nesting, then normalize
    // entities so repeated calls stay idempotent without growing `&amp;lt;`.
    trimmed = stripNestedFenceTags(unescapeFenceEntities(stripNestedFenceTags(trimmed))).trim()
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
const UNSAFE_REF_ALLOW_SPACES_RE = /[<>&\t\r\n\u2028\u2029]/
const UNSAFE_REF_STRICT_RE = /[<>&\r\n\u2028\u2029\s]/

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
    const needsFence =
        (allowSpaces ? UNSAFE_REF_ALLOW_SPACES_RE.test(value) : UNSAFE_REF_STRICT_RE.test(value)) ||
        hasUntrustedControlChars(value)
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
    cleaned = stripNestedFenceTags(unescapeFenceEntities(stripNestedFenceTags(cleaned)))
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

export function resolveExplicitTeamAuthor(): string | undefined {
    return sanitizeValidAuthor(process.env['TEAM_AUTHOR']?.trim().replace(/"/g, ''))
}

export function resolveAuthenticatedAuthor(): string {
    const authCtx = getAuthContext()
    if (authCtx?.authenticated) {
        const claims = authCtx.claims
        const verifiedEmail =
            claims?.['email_verified'] === true ? nonEmptyAuthClaim(claims['email']) : undefined
        const candidates = [
            nonEmptyAuthClaim(claims?.sub),
            nonEmptyAuthClaim(claims?.['subject']),
            verifiedEmail,
            nonEmptyAuthClaim(claims?.client_id),
        ]
        for (const candidate of candidates) {
            const sanitized = sanitizeValidAuthor(candidate)
            if (sanitized !== undefined) return sanitized
        }
        return 'unknown'
    }

    return resolveExplicitTeamAuthor() ?? 'unknown'
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
