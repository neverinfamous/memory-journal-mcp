/**
 * Delimiter-balance validation helper extracted from `security-stripper-state.ts`
 * to keep both worker-thread-safe lexer modules cleanly under the 500-line ceiling.
 */

/**
 * Returns true if stripped sandbox code drops any delimiter (`}`, `)`, `]`) below zero depth,
 * preventing early breakout from the top-level `vm.Script` async IIFE wrapper.
 */
export function hasUnbalancedClosingDelimiter(strippedCode: string): boolean {
    let braceDepth = 0
    let parenDepth = 0
    let bracketDepth = 0
    let inQuote: string | null = null
    let i = 0
    while (i < strippedCode.length) {
        const ch = strippedCode[i] ?? ''
        if (inQuote !== null) {
            if (ch === '\\') {
                i += 2
                continue
            }
            if (ch === inQuote) inQuote = null
            i++
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inQuote = ch
        } else if (ch === '{') braceDepth++
        else if (ch === '}') {
            if (--braceDepth < 0) return true
        } else if (ch === '(') parenDepth++
        else if (ch === ')') {
            if (--parenDepth < 0) return true
        } else if (ch === '[') bracketDepth++
        else if (ch === ']') {
            if (--bracketDepth < 0) return true
        }
        i++
    }
    return false
}
