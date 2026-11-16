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

export function extractAndRecoverPreparedStatementCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const stripped = stripCommentsAndStrings(code)
    if (!stripped.includes('.prepare(')) return null
    if (!/\.(?:run|get|all)\s*\(/.test(stripped)) return null
    if (hasValidJsSyntax(code) && REAL_MJ_API_CALL_RE.test(stripped)) {
        return null
    }

    const chainedMatch =
        /\.prepare\s*\(\s*(['"`])([\s\S]*?)\1\s*\)\s*\.(?:run|get|all)\s*\(([\s\S]*?)\)(?:\s*;|\s*\n|$)/.exec(
            code
        )
    let rawSql: string | undefined
    let rawRunArgs: string | undefined
    if (chainedMatch?.[2] !== undefined) {
        rawSql = chainedMatch[2].trim()
        rawRunArgs = chainedMatch[3]
    } else {
        const boundMatch =
            /(?:(?:^|[;\n])\s*(?:const|let|var)\s+|(?:^|[;\n])\s*)([A-Za-z_$][\w$]*)\s*=[^;\n]*?\.prepare\s*\(\s*(['"`])([\s\S]*?)\2\s*\)/.exec(
                code
            )
        const stmtVar = boundMatch?.[1]
        if (stmtVar !== undefined && boundMatch?.[3] !== undefined) {
            const afterPrep = code.slice(boundMatch.index + boundMatch[0].length)
            const stmtCallRe = /\b([A-Za-z_$][\w$]*)\s*\.(?:run|get|all)\s*\(([\s\S]*?)\)(?:\s*;|\s*\n|$)/g
            for (const m of afterPrep.matchAll(stmtCallRe)) {
                if (m[1] === stmtVar) {
                    rawSql = boundMatch[3].trim()
                    rawRunArgs = m[2]
                    break
                }
            }
        }
    }
    if (rawSql === undefined) return null

    let parsedArgs: unknown[] = []
    if (rawRunArgs !== undefined) {
        const rawArgs = rawRunArgs.trim()
        if (rawArgs.length > 0) {
            const recovered = parsePreparedStatementArgs(rawArgs)
            if (recovered === null) return null
            parsedArgs = recovered
        }
    }

    const { action, params } = parseSqlStatement(rawSql, parsedArgs)
    const target = PREPARED_ACTION_TARGETS[action]
    if (target === undefined) return null
    return `return await ${target}(${JSON.stringify(params)});`
}
