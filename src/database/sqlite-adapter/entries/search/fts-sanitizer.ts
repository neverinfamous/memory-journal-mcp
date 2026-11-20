// ============================================================================
// FTS5 Helpers
// ============================================================================

/** True when a non-operator token exists at or after `startIndex` (FTS5 operators need an operand). */
function hasValidNextToken(tokens: string[], startIndex: number): boolean {
    for (let j = startIndex; j < tokens.length; j++) {
        const rawNext = tokens[j]
        if (!rawNext) continue

        let nextToken = rawNext.replace(/[^a-zA-Z0-9_*-]/g, '')
        nextToken = nextToken.replace(/\*/g, '').replace(/^-+$/, '')
        if (nextToken && !/^(?:AND|OR|NOT|NEAR(?:\d+)?)$/i.test(nextToken)) {
            return true
        }
    }
    return false
}

/**
 * Extract balanced quoted phrases (sanitised) and return them with the remaining text.
 * Compound delimiters (`.`, `/`, `:`, `@`) split into space-separated phrase terms;
 * hyphens and underscores inside words are preserved.
 */
function extractQuotedPhrases(query: string): { phrases: string[]; remaining: string } {
    const phrases: string[] = []
    const remaining = query.replace(/"([^"]+)"/g, (_match, inner: string) => {
        const safeInner = inner
            .replace(/[./:@]+/g, ' ')
            .split(/\s+/)
            .map((t: string) => t.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter((t: string) => t.length > 0)
            .join(' ')
        if (safeInner) {
            phrases.push(`"${safeInner}"`)
        }
        return ' ' // Replace the matched phrase with space in the remaining text
    })
    return { phrases, remaining }
}

/** Expand non-quoted text into tokens, preserving compound delimiter chunks as atomic phrase candidates. */
function expandSearchTokens(rawText: string): string[] {
    const stripped = rawText
        .replace(/\bNEAR(?:\/\d+)?\b/gi, ' ')
        .replace(/"/g, ' ')
    const tokens: string[] = []
    for (const chunk of stripped.split(/\s+/)) {
        if (!chunk) continue
        if (/[./:@]/.test(chunk) && !chunk.endsWith('*')) {
            tokens.push(chunk)
        } else {
            for (const part of chunk.replace(/-/g, ' ').split(/\s+/)) {
                if (part) tokens.push(part)
            }
        }
    }
    return tokens
}

/** Convert compound tokens (`AGENTS.md`, `@scope/pkg`, `memory://agent-id`) into phrase or single segments. */
function sanitizeCompoundSegments(token: string): string[] {
    return token
        .split(/[./:@-]+/)
        .map((seg: string) => seg.replace(/[^a-zA-Z0-9_]/g, ''))
        .filter((seg: string) => seg.length > 0 && !/^NEAR\d*$/i.test(seg))
}

function normalizeSingleFtsToken(
    token: string,
    tokens: string[],
    index: number,
    safeTokens: string[]
): string | null {
    if (/[./:@]/.test(token) && !token.endsWith('*')) {
        const segments = sanitizeCompoundSegments(token)
        if (segments.length >= 2) return `"${segments.join(' ')}"`
        if (segments.length === 0) return null
        const single = segments[0]
        if (single !== undefined && !/^(AND|OR|NOT)$/i.test(single)) return single
    }

    let sanitized = token
        .replace(/[^a-zA-Z0-9_*-]/g, '')
        .replace(/\*/g, '')
        .replace(/^-+|-+$/g, '')
    if (!sanitized) return null
    if (token.endsWith('*')) sanitized += '*'
    if (/^NEAR\d*\*?$/i.test(sanitized)) return null
    if (/^(?:AND|OR|NOT)\*$/i.test(sanitized)) return sanitized.toLowerCase()

    if (!/^(AND|OR|NOT)$/i.test(sanitized)) return sanitized

    sanitized = sanitized.toUpperCase()
    if (safeTokens.length === 0) return null
    const prevToken = safeTokens[safeTokens.length - 1]
    if (prevToken !== undefined && /^(AND|OR|NOT)$/.test(prevToken)) return null
    return hasValidNextToken(tokens, index + 1) ? sanitized : null
}

/**
 * Rigorous FTS5 Query Sanitization
 */
export function sanitizeFtsQuery(query: string): string {
    if (!query) return ''

    const { phrases, remaining: withoutPhrases } = extractQuotedPhrases(query)
    const tokens = expandSearchTokens(withoutPhrases)
    const safeTokens: string[] = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (!token) continue
        const normalized = normalizeSingleFtsToken(token, tokens, i, safeTokens)
        if (normalized !== null) safeTokens.push(normalized)
    }

    while (safeTokens.length > 0 && /^(?:AND|OR|NOT)$/.test(safeTokens[safeTokens.length - 1] ?? '')) {
        safeTokens.pop()
    }
    while (safeTokens.length > 0 && /^(?:AND|OR)$/.test(safeTokens[0] ?? '')) {
        safeTokens.shift()
    }

    return [...phrases, ...safeTokens].join(' ')
}

/**
 * Returns true when an error is a recoverable SQLite FTS5 query syntax/column/token failure
 * that should trigger a LIKE fallback across both search and facet count queries.
 */
export function isFts5QueryError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    const msg = err.message.toLowerCase()
    return (
        msg.includes('syntax error') ||
        msg.includes('no such column') ||
        msg.includes('unterminated string') ||
        msg.includes('unrecognized token')
    )
}
