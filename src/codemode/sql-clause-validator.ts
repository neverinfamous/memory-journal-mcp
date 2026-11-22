/**
 * Top-level SQL trailing-clause validator for Code Mode SQL recovery and binding.
 * [INVARIANT] Extracted from `sql-literal-scope.ts` so `sql-literal-scope.ts` stays <= 450L
 * and worker-bundle imports stay strictly host-free.
 */

import { advanceQuotedChar } from './sql-literal-scope.js'

const MUTATION_UNSUPPORTED_KEYWORDS = new Set([
    'ORDER',
    'LIMIT',
    'OFFSET',
    'UNION',
    'EXCEPT',
    'INTERSECT',
    'RETURNING',
    'JOIN',
])

const SELECT_UNSUPPORTED_KEYWORDS = new Set([
    'UNION',
    'EXCEPT',
    'INTERSECT',
    'OFFSET',
    'GROUP',
    'HAVING',
    'RETURNING',
    'JOIN',
])

const BY_FOLLOWED_KEYWORDS = new Set(['ORDER', 'GROUP'])

function isUnsupportedKeywordAt(
    cleanSql: string,
    upperToken: string,
    endIdx: number,
    statementKind: 'select' | 'mutation'
): boolean {
    const disallowed =
        statementKind === 'mutation' ? MUTATION_UNSUPPORTED_KEYWORDS : SELECT_UNSUPPORTED_KEYWORDS
    if (disallowed.has(upperToken)) {
        if (BY_FOLLOWED_KEYWORDS.has(upperToken)) {
            return /^\s+BY\b/i.test(cleanSql.slice(endIdx))
        }
        return true
    }
    if (statementKind === 'select' && upperToken === 'LIMIT') {
        const afterLimit = cleanSql.slice(endIdx)
        return !/^\s+[1-9]\d*\s*;?\s*$/.test(afterLimit)
    }
    return false
}

/**
 * Returns true if `cleanSql` contains a top-level clause unsupported by Code Mode SQL recovery/binding
 * (e.g. mutation `ORDER BY`/`LIMIT`/`OFFSET`/`UNION`/`RETURNING`, or select `UNION`/`GROUP BY`/`HAVING`/invalid `LIMIT`).
 */
export function hasUnsupportedSqlTrailingClause(
    cleanSql: string,
    statementKind: 'select' | 'mutation'
): boolean {
    let quote: string | null = null
    let depth = 0
    for (let i = 0; i < cleanSql.length; i++) {
        const ch = cleanSql[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(cleanSql, i, quote)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
            continue
        }
        if (ch === '(') {
            depth++
            continue
        }
        if (ch === ')') {
            if (depth > 0) depth--
            continue
        }
        if (depth !== 0 || !/[A-Za-z_]/.test(ch)) continue
        const prev = i > 0 ? (cleanSql[i - 1] ?? '') : ''
        if (/[A-Za-z0-9_$.]/.test(prev)) continue

        let end = i + 1
        while (end < cleanSql.length && /[A-Za-z0-9_$]/.test(cleanSql[end] ?? '')) {
            end++
        }
        const upperToken = cleanSql.slice(i, end).toUpperCase()
        if (isUnsupportedKeywordAt(cleanSql, upperToken, end, statementKind)) {
            return true
        }
        i = end - 1
    }
    return false
}
