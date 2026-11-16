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

/**
 * Rigorous FTS5 Query Sanitization
 *
 * Prevents FTS5 catastrophic backtracking (ReDoS) and application-level syntax crashes
 * by aggressively stripping FTS control syntax and forcing queries into safe,
 * implicit AND-token sequences.
 *
 * Threat Vectors Mitigated:
 * - Unbalanced quotes & parentheses causing SQLITE_ERROR syntax crashes
 * - Deeply nested or hallucinated \`NEAR/xxx\` proximity operators causing FTS planner ReDoS
 * - Column filters (\`col:val\`) leaking unintended field traversals
 * - Naked booleans (\`word AND OR NOT word\`) confusing the FTS AST parser
 */
export function sanitizeFtsQuery(query: string): string {
    if (!query) return ''

    // Phase 1: Extract balanced quoted phrases and protect them
    const { phrases, remaining: withoutPhrases } = extractQuotedPhrases(query)

    // Phase 2-3: Strip NEAR/quotes and tokenize while protecting compound tokens for phrase matching
    const tokens = expandSearchTokens(withoutPhrases)
    const safeTokens: string[] = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (!token) continue

        if (/[./:@]/.test(token) && !token.endsWith('*')) {
            const segments = sanitizeCompoundSegments(token)
            if (segments.length >= 2) {
                safeTokens.push(`"${segments.join(' ')}"`)
                continue
            }
            if (segments.length === 0) continue
            const single = segments[0]
            if (single !== undefined && !/^(AND|OR|NOT)$/i.test(single)) {
                safeTokens.push(single)
                continue
            }
        }

        // Strip out non-alphanumeric characters, except hyphen, underscore, and asterisk
        let sanitizedToken = token.replace(/[^a-zA-Z0-9_*-]/g, '')
        if (!sanitizedToken) continue

        // Ensure asterisk is only at the end of the token for prefix matching,
        // preventing standalone asterisks or inner asterisks which cause syntax errors.
        const hasAsterisk = token.endsWith('*')
        sanitizedToken = sanitizedToken.replace(/\*/g, '')
        if (hasAsterisk && sanitizedToken.length > 0) {
            sanitizedToken += '*'
        }

        if (!sanitizedToken || sanitizedToken === '*') continue

        // Drop NEAR as it causes ReDoS
        if (/^NEAR\d*$/i.test(sanitizedToken)) continue

        const isOperator = /^(AND|OR|NOT)$/i.test(sanitizedToken)
        if (isOperator) {
            // Must be uppercase for FTS5
            sanitizedToken = sanitizedToken.toUpperCase()

            // Operators cannot be the first token
            if (safeTokens.length === 0) continue

            // Operators cannot be preceded by another operator
            const prevToken = safeTokens[safeTokens.length - 1]
            if (prevToken && /^(AND|OR|NOT)$/.test(prevToken)) {
                // If there are adjacent operators, skip the current one
                continue
            }

            // Operators must have a valid subsequent non-operator token
            if (!hasValidNextToken(tokens, i + 1)) continue
        }

        safeTokens.push(sanitizedToken)
    }

    while (safeTokens.length > 0 && /^(?:AND|OR|NOT)$/.test(safeTokens[safeTokens.length - 1] ?? '')) {
        safeTokens.pop()
    }
    while (safeTokens.length > 0 && /^(?:AND|OR)$/.test(safeTokens[0] ?? '')) {
        safeTokens.shift()
    }

    // Phase 4: Combine phrases + safe tokens
    // Phrases go first (they're the user's strongest intent signal)
    return [...phrases, ...safeTokens].join(' ')
}
