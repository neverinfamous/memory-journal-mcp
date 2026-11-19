/**
 * Prepared statement recovery helpers split out of `sql-recovery.ts`.
 */

import * as vm from 'node:vm'
import { parseSqlStatement } from '../../../codemode/sql-positional-binder.js'
import { stripCommentsAndStrings } from '../../../codemode/security-stripper.js'

const UNPARSEABLE_ARG = Symbol('UNPARSEABLE_ARG')

const PREPARED_ACTION_TARGETS: Partial<Record<string, string>> = {
    update: 'mj.admin.updateEntry',
    create: 'mj.core.createEntry',
    delete: 'mj.admin.deleteEntry',
    get_by_id: 'mj.core.getEntryById',
}

function splitTopLevelCommaArgs(rawArgs: string): string[] {
    const tokens: string[] = []
    let current = ''
    let quote: string | null = null
    let escaped = false
    let depth = 0

    for (const ch of rawArgs) {
        if (quote !== null) {
            current += ch
            if (escaped) {
                escaped = false
            } else if (ch === '\\') {
                escaped = true
            } else if (ch === quote) {
                quote = null
            }
            continue
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch
            current += ch
        } else if (ch === '[' || ch === '{' || ch === '(') {
            depth++
            current += ch
        } else if (ch === ']' || ch === '}' || ch === ')') {
            if (depth > 0) depth--
            current += ch
        } else if (ch === ',' && depth === 0) {
            tokens.push(current)
            current = ''
        } else {
            current += ch
        }
    }
    if (current.trim().length > 0) {
        tokens.push(current)
    }
    return tokens
}

function unescapeStringLiteral(inner: string): string {
    let result = ''
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i] ?? ''
        if (ch === '\\' && i + 1 < inner.length) {
            const next = inner[++i] ?? ''
            if (next === 'n') result += '\n'
            else if (next === 'r') result += '\r'
            else if (next === 't') result += '\t'
            else result += next
        } else {
            result += ch
        }
    }
    return result
}

function parseSingleArgToken(rawToken: string): unknown {
    const trimmed = rawToken.trim()
    if (trimmed === 'null' || trimmed === 'undefined') return null
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.includes('${'))
    ) {
        return unescapeStringLiteral(trimmed.slice(1, -1))
    }
    if (trimmed.startsWith('JSON.stringify(') && trimmed.endsWith(')')) {
        try {
            const inner = trimmed.slice(15, -1).trim()
            const parsed: unknown = JSON.parse(inner)
            return parsed
        } catch {
            return UNPARSEABLE_ARG
        }
    }
    if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
        try {
            return JSON.parse(trimmed) as unknown
        } catch {
            return UNPARSEABLE_ARG
        }
    }
    return UNPARSEABLE_ARG
}

function isUnknownArray(val: unknown): val is unknown[] {
    return Array.isArray(val)
}

function parsePreparedStatementArgs(rawArgs: string): unknown[] | null {
    if (rawArgs.length > 50_000) return []
    try {
        const parsed: unknown = JSON.parse(`[${rawArgs}]`)
        if (isUnknownArray(parsed)) return parsed
    } catch {
        // Fallback to linear state-machine splitter (no vm.runInNewContext or catastrophic regexes)
    }

    const tokens = splitTopLevelCommaArgs(rawArgs)
    const parsed = tokens.map(parseSingleArgToken)
    if (parsed.some((item) => item === UNPARSEABLE_ARG)) return null
    return parsed
}

function hasValidJsSyntax(src: string): boolean {
    try {
        new vm.Script(`(async () => {\n${src}\n})()`)
        return true
    } catch {
        return false
    }
}

/**
 * Auto-heals prepared statement execution patterns (db.prepare(...).run(...), stmt.run(...))
 * into corresponding canonical mj.* API calls. Requires both `.prepare(` and `.run/.get/.all(`
 * outside string literals/comments so prose/literals inside valid `mj.*` calls are never rewritten.
 */
const REAL_MJ_API_CALL_RE =
    /\bmj\s*\.\s*(?:core|search|admin|team|analytics|relationships|io|git|backup|github|executeCode|help|readResource|getContext|createEntry|searchEntries|getRecentEntries|getEntryById|updateEntry|deleteEntry|listTags)\b/

function scanBalancedQuotedString(
    code: string,
    openQuoteIdx: number
): { value: string; closeQuoteIdx: number } | null {
    const quote = code[openQuoteIdx]
    if (quote !== "'" && quote !== '"' && quote !== '`') return null
    let i = openQuoteIdx + 1
    while (i < code.length) {
        const ch = code[i]
        if (ch === '\\') {
            i += 2
            continue
        }
        if (ch === quote) {
            return { value: code.slice(openQuoteIdx + 1, i), closeQuoteIdx: i }
        }
        i++
    }
    return null
}

function scanSimpleParenBody(
    code: string,
    openParenIdx: number
): { body: string; afterCloseIdx: number } | null {
    if (code[openParenIdx] !== '(') return null
    let depth = 1
    let i = openParenIdx + 1
    while (i < code.length && depth > 0) {
        const ch = code[i]
        if (ch === "'" || ch === '"' || ch === '`') {
            const quoted = scanBalancedQuotedString(code, i)
            if (quoted === null) return null
            i = quoted.closeQuoteIdx + 1
            continue
        }
        if (ch === '(') depth++
        else if (ch === ')') depth--
        i++
    }
    if (depth !== 0) return null
    return { body: code.slice(openParenIdx + 1, i - 1), afterCloseIdx: i }
}

function extractPrepareSqlAt(
    code: string,
    prepareIdx: number
): { sql: string; afterPrepareCloseIdx: number } | null {
    const afterKeyword = prepareIdx + '.prepare'.length
    let i = afterKeyword
    while (i < code.length && /\s/.test(code[i] ?? '')) i++
    if (code[i] !== '(') return null
    i++
    while (i < code.length && /\s/.test(code[i] ?? '')) i++
    const quoted = scanBalancedQuotedString(code, i)
    if (quoted === null) return null
    let j = quoted.closeQuoteIdx + 1
    while (j < code.length && /\s/.test(code[j] ?? '')) j++
    if (code[j] !== ')') return null
    return { sql: quoted.value.trim(), afterPrepareCloseIdx: j + 1 }
}

function extractPreparedSqlAndRunArgs(
    code: string
): { rawSql: string; rawRunArgs: string } | null {
    const prepIdx = code.indexOf('.prepare')
    if (prepIdx === -1) return null
    const prep = extractPrepareSqlAt(code, prepIdx)
    if (prep === null) return null

    const tail = code.slice(prep.afterPrepareCloseIdx)
    const chainedExec = /^\s*\.(?:run|get|all)\s*\(/.exec(tail)
    if (chainedExec !== null) {
        const openParenIdx = prep.afterPrepareCloseIdx + chainedExec[0].length - 1
        const callArgs = scanSimpleParenBody(code, openParenIdx)
        if (callArgs === null) return null
        const afterCall = code.slice(callArgs.afterCloseIdx)
        if (!/^(?:\s*;|\s*\r?\n|\s*$)/.test(afterCall)) return null
        return { rawSql: prep.sql, rawRunArgs: callArgs.body }
    }

    const prefix = code.slice(0, prepIdx)
    const boundVarMatch = /(?:^|[;\n])\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=[^;\n]*$/.exec(
        prefix
    )
    const stmtVar = boundVarMatch?.[1]
    if (stmtVar === undefined) return null
    const stmtCallRe = /\b([A-Za-z_$][\w$]*)\s*\.(?:run|get|all)\s*\(/g
    for (const m of tail.matchAll(stmtCallRe)) {
        if (m[1] !== stmtVar || m.index === undefined) continue
        const openParenIdx = prep.afterPrepareCloseIdx + m.index + m[0].length - 1
        const callArgs = scanSimpleParenBody(code, openParenIdx)
        if (callArgs === null) continue
        const afterCall = code.slice(callArgs.afterCloseIdx)
        if (!/^(?:\s*;|\s*\r?\n|\s*$)/.test(afterCall)) continue
        return { rawSql: prep.sql, rawRunArgs: callArgs.body }
    }
    return null
}

const MAX_PREPARED_RECOVERY_LENGTH = 32_768

export function extractAndRecoverPreparedStatementCode(code: string): string | null {
    if (
        !code ||
        typeof code !== 'string' ||
        code.length > MAX_PREPARED_RECOVERY_LENGTH ||
        !code.includes('.prepare')
    ) {
        return null
    }
    const stripped = stripCommentsAndStrings(code)
    if (!stripped.includes('.prepare(')) return null
    if (!/\.(?:run|get|all)\s*\(/.test(stripped)) return null
    if (hasValidJsSyntax(code) && REAL_MJ_API_CALL_RE.test(stripped)) {
        return null
    }

    const extracted = extractPreparedSqlAndRunArgs(code)
    if (extracted === null) return null
    const { rawSql, rawRunArgs } = extracted

    let parsedArgs: unknown[] = []
    const rawArgs = rawRunArgs.trim()
    if (rawArgs.length > 0) {
        const recovered = parsePreparedStatementArgs(rawArgs)
        if (recovered === null) return null
        parsedArgs = recovered
    }

    const { action, params } = parseSqlStatement(rawSql, parsedArgs)
    const target = PREPARED_ACTION_TARGETS[action]
    if (target === undefined) return null
    return `return await ${target}(${JSON.stringify(params)});`
}
