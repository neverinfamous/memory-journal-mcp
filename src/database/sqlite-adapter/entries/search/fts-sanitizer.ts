// ============================================================================
// FTS5 Helpers
// ============================================================================

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
    const phrases: string[] = []
    const withoutPhrases = query.replace(/"([^"]+)"/g, (_match, inner: string) => {
        // Sanitize tokens inside the phrase (strip special chars, keep alphanumeric + hyphen + underscore)
        const safeInner = inner
            .split(/\s+/)
            .map((t: string) => t.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter((t: string) => t.length > 0)
            .join(' ')
        if (safeInner) {
            phrases.push(`"${safeInner}"`)
        }
        return ' ' // Replace the matched phrase with space in the remaining text
    })

    // Phase 2: Strip any remaining unbalanced quotes and replace hyphens with spaces
    // Bare hyphens in FTS5 cause syntax errors. We replace them with spaces so they become implicit AND matches.
    const noQuotes = withoutPhrases.replace(/"/g, ' ').replace(/-/g, ' ')

    // Phase 3: Tokenize and sanitize the non-phrase portion
    const tokens = noQuotes.split(/\s+/)
    const safeTokens: string[] = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (!token) continue

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
            let hasValidNext = false
            for (let j = i + 1; j < tokens.length; j++) {
                const rawNext = tokens[j]
                if (!rawNext) continue

                let nextToken = rawNext.replace(/[^a-zA-Z0-9_*-]/g, '')
                nextToken = nextToken.replace(/\*/g, '')
                if (nextToken && !/^(AND|OR|NOT|NEAR)$/i.test(nextToken)) {
                    hasValidNext = true
                    break
                }
            }

            if (!hasValidNext) continue
        }

        safeTokens.push(sanitizedToken)
    }

    // Phase 4: Combine phrases + safe tokens
    // Phrases go first (they're the user's strongest intent signal)
    return [...phrases, ...safeTokens].join(' ')
}
