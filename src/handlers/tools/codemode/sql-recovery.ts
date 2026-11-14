/**
 * SQL and prepared statement recovery helpers for Code Mode execution payloads.
 */

import { scopeFromSqlLiterals } from '../../../codemode/sql-literal-scope.js'
import { parseSqlStatement } from '../../../codemode/sql-positional-binder.js'
import { extractAndRecoverEntryCode } from './json-entry-recovery.js'

/**
 * Auto-heals raw SQL queries passed as code or script in Code Mode,
 * translating them to corresponding type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverSqlCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()

    if (/\b(?:const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) {
        return null
    }

    const cleanSql = trimmed
        .replace(/^--[^\n]*\n/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()

    const isSql =
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(cleanSql) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)
    if (!isSql) return null

    if (
        /^(?:PRAGMA|SHOW|DESCRIBE|EXPLAIN|SCHEMA|TABLES)\b/i.test(cleanSql) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)
    ) {
        return null
    }

    const fromMatch = /\bFROM\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = fromMatch?.[1]?.toLowerCase()

    const limitMatch = /\bLIMIT\s+(\d+)/i.exec(cleanSql)
    const limitVal = limitMatch?.[1] !== undefined ? parseInt(limitMatch[1], 10) : undefined

    const idMatch = /\b(?:WHERE|AND)\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
    const idVal = idMatch?.[1] !== undefined ? parseInt(idMatch[1], 10) : undefined

    const likeMatch =
        /\b(?:WHERE|AND)\s+[`"']?(?:content|title|tags|body|text|summary|name)[`"']?\s+(?:LIKE|ILIKE|=)\s*['"]%?([^%'"]+)%?['"]/i.exec(
            cleanSql
        )
    const searchQuery = likeMatch?.[1]

    const isCount = /\bCOUNT\s*\(/i.test(cleanSql)

    const scopeFields = scopeFromSqlLiterals(cleanSql)

    if (
        tableName === 'tags' ||
        tableName === 'entry_tags' ||
        tableName === 'journal_tags' ||
        tableName === 'projects' ||
        tableName === 'project_registry' ||
        tableName === 'relationships' ||
        tableName === 'entry_relationships' ||
        tableName === 'links' ||
        tableName === 'team_members' ||
        tableName === 'members' ||
        tableName === 'author_aliases' ||
        tableName === 'aliases' ||
        tableName === 'audit_log' ||
        tableName === 'audit' ||
        tableName === 'audit_logs'
    ) {
        if (!/^SELECT\b/i.test(cleanSql)) return null
    }

    if (tableName === 'tags' || tableName === 'entry_tags' || tableName === 'journal_tags') {
        return `return await mj.core.listTags(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'projects' || tableName === 'project_registry') {
        return `return await mj.admin.listProjects(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'relationships' || tableName === 'entry_relationships' || tableName === 'links') {
        if (idVal !== undefined) {
            return `return await mj.relationships.visualizeRelationships(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
        }
        return `return await mj.relationships.visualizeRelationships(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'team_members' || tableName === 'members') {
        return `return await mj.team.teamListMembers(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'author_aliases' || tableName === 'aliases') {
        return `return await mj.team.teamListAuthorAliases(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'audit_log' || tableName === 'audit' || tableName === 'audit_logs') {
        return `return await mj.admin.searchAuditLog(${JSON.stringify(scopeFields)});`
    }

    if (/^SELECT\b/i.test(cleanSql)) {
        if (isCount) {
            return null
        }
        if (idVal !== undefined) {
            if (Object.keys(scopeFields).length === 0) {
                return `return await mj.core.getEntryById({ entry_id: ${String(idVal)} });`
            }
            return `return await mj.core.getEntryById(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
        }
        if (searchQuery !== undefined && searchQuery !== '') {
            const searchParams: Record<string, unknown> = { query: searchQuery, ...scopeFields }
            if (limitVal !== undefined) searchParams['limit'] = limitVal
            return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
        }
        return null
    }

    if (/^INSERT\s+INTO\b/i.test(cleanSql)) {
        const rec = extractAndRecoverEntryCode(cleanSql)
        if (rec !== null) return rec
        return null
    }

    if (/^UPDATE\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            const setClause = /\bSET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(cleanSql)?.[1] ?? ''
            const setContentMatch = /\bcontent\s*=\s*(['"])([\s\S]*?)\1/i.exec(setClause)
            if (setContentMatch?.[2] !== undefined) {
                const setWsMatch = /[`"']?workspace_id[`"']?\s*=\s*(['"])([^'"]+)\1/i.exec(setClause)
                const setProjMatch = /[`"']?(?:project_number|project_id)[`"']?\s*=\s*['"]?(\d+)['"]?/i.exec(setClause)
                const setWs = setWsMatch?.[2]?.trim()
                const setProj = setProjMatch?.[1] !== undefined ? parseInt(setProjMatch[1], 10) : undefined
                const whereProj =
                    typeof scopeFields['project_number'] === 'number'
                        ? scopeFields['project_number']
                        : undefined
                if (setProj !== undefined && whereProj !== undefined && setProj !== whereProj) {
                    return null
                }
                const updatePayload: Record<string, unknown> = {
                    entry_id: idVal,
                    content: setContentMatch[2],
                    ...scopeFields,
                    ...(setWs !== undefined && setWs !== '' ? { target_workspace_id: setWs } : {}),
                    ...(whereProj === undefined && setProj !== undefined ? { project_number: setProj } : {}),
                }
                return `return await mj.admin.updateEntry(${JSON.stringify(updatePayload)});`
            }
            return null
        }
        return null
    }

    if (/^DELETE\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            return `return await mj.admin.deleteEntry(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
        }
        return null
    }

    return null
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

const UNPARSEABLE_ARG = Symbol('UNPARSEABLE_ARG')

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
    // 1. Try safe JSON.parse first
    try {
        const parsed: unknown = JSON.parse(`[${rawArgs}]`)
        if (isUnknownArray(parsed)) return parsed
    } catch {
        // Fallback to linear state-machine splitter (no vm.runInNewContext or catastrophic regexes)
    }

    // 2. Linear O(N) top-level comma splitter and literal parser; abort if any arg is a live JS expression.
    const tokens = splitTopLevelCommaArgs(rawArgs)
    const parsed = tokens.map(parseSingleArgToken)
    if (parsed.some((item) => item === UNPARSEABLE_ARG)) return null
    return parsed
}

/**
 * Auto-heals prepared statement execution patterns (db.prepare(...).run(...), stmt.run(...))
 * into corresponding canonical mj.* API calls.
 */
export function extractAndRecoverPreparedStatementCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    if (!code.includes('.prepare(')) return null

    const prepMatch = /\.prepare\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(code)
    if (prepMatch?.[2] === undefined) return null
    const rawSql = prepMatch[2].trim()

    const runMatch = /\.(?:run|get|all)\s*\(([\s\S]*?)\)(?:\s*;|\s*\n|$)/.exec(code)
    let parsedArgs: unknown[] = []
    if (runMatch?.[1] !== undefined) {
        const rawArgs = runMatch[1].trim()
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

const PREPARED_ACTION_TARGETS: Partial<Record<string, string>> = {
    update: 'mj.admin.updateEntry',
    create: 'mj.core.createEntry',
    delete: 'mj.admin.deleteEntry',
    get_by_id: 'mj.core.getEntryById',
}
