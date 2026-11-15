/**
 * SQL and prepared statement recovery helpers for Code Mode execution payloads.
 */

import {
    ENTRY_TABLE_NAMES,
    extractTopLevelUpdateSetClause,
    extractTopLevelWhereClause,
    findTopLevelSqlKeyword,
    hasUnsupportedWherePredicate,
    scopeFromSqlLiterals,
    splitSqlValueList,
    splitTopLevelSqlAndClauses,
    stripBalancedOuterParens,
} from '../../../codemode/sql-literal-scope.js'
import { cleanSqlText, parseSqlStatement } from '../../../codemode/sql-positional-binder.js'

const SPECIAL_TABLES = new Set([
    'tags',
    'entry_tags',
    'journal_tags',
    'projects',
    'project_registry',
    'relationships',
    'entry_relationships',
    'links',
    'team_members',
    'members',
    'author_aliases',
    'aliases',
    'audit_log',
    'audit',
    'audit_logs',
])

const CLAUSE_ID_REGEX =
    /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)$/i
const CLAUSE_LIKE_REGEX =
    /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?(?:content|title|tags|body|text|summary|name)[`"']?\s+(?:LIKE|ILIKE|=)\s*('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*")$/i

function unquoteSqlString(raw: string): string | null {
    const trimmed = raw.trim()
    if (trimmed.length < 2) return null
    const quote = trimmed[0]
    if ((quote !== "'" && quote !== '"') || !trimmed.endsWith(quote)) return null
    const inner = trimmed.slice(1, -1)
    const doubled = quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/""/g, '"')
    return doubled.replace(/\\(['"\\])/g, '$1')
}

function parseCleanRecoverableSql(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()
    if (/\b(?:const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) {
        return null
    }
    const cleanSql = cleanSqlText(trimmed)
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
    return cleanSql
}

function extractTopLevelWhereId(whereClause: string): number | undefined {
    for (const rawClause of splitTopLevelSqlAndClauses(whereClause)) {
        const match = CLAUSE_ID_REGEX.exec(stripBalancedOuterParens(rawClause))
        if (match?.[1] !== undefined) return parseInt(match[1], 10)
    }
    return undefined
}

function extractTopLevelWhereLikeQuery(whereClause: string): string | undefined {
    for (const rawClause of splitTopLevelSqlAndClauses(whereClause)) {
        const match = CLAUSE_LIKE_REGEX.exec(stripBalancedOuterParens(rawClause))
        if (match?.[1] === undefined) continue
        const unquoted = unquoteSqlString(match[1])
        if (unquoted === null) continue
        const query = unquoted.replace(/^%+|%+$/g, '')
        if (query !== '') return query
    }
    return undefined
}

function extractTopLevelLimit(cleanSql: string): number | undefined {
    const limitIdx = findTopLevelSqlKeyword(cleanSql, 'LIMIT')
    if (limitIdx < 0) return undefined
    const match = /^LIMIT\s+(\d+)\b/i.exec(cleanSql.slice(limitIdx))
    return match?.[1] !== undefined ? parseInt(match[1], 10) : undefined
}

function specialWhereAllowedCols(table: string): readonly string[] {
    if (table === 'relationships' || table === 'entry_relationships' || table === 'links') {
        return ['workspace_id', 'project_number', 'project_id', 'id', 'entry_id']
    }
    return ['workspace_id', 'project_number', 'project_id']
}

function hasUnsupportedSpecialTableWhere(sqlWhere: string, allowedCols: readonly string[]): boolean {
    const clauses = splitTopLevelSqlAndClauses(sqlWhere)
    if (clauses.length === 0) return false
    const allowedSet = new Set(allowedCols.map((c) => c.toLowerCase()))
    for (const rawClause of clauses) {
        const clause = stripBalancedOuterParens(rawClause)
        if (clause === '') return true
        const match =
            /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z_][\w]*)[`"']?\s*=\s*(?:'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\d+)$/i.exec(
                clause
            )
        if (match?.[1] === undefined || !allowedSet.has(match[1].toLowerCase())) {
            return true
        }
    }
    return false
}

function recoverSpecialTableSelect(
    cleanSql: string,
    tableName: string,
    whereClause: string,
    idVal: number | undefined,
    scopeFields: Record<string, unknown>
): string | null {
    if (!/^SELECT\b/i.test(cleanSql)) return null
    if (hasUnsupportedSpecialTableWhere(whereClause, specialWhereAllowedCols(tableName))) {
        return null
    }
    if (tableName === 'tags' || tableName === 'entry_tags' || tableName === 'journal_tags') {
        return `return await mj.core.listTags(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'projects' || tableName === 'project_registry') {
        return `return await mj.admin.listProjects(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'relationships' || tableName === 'entry_relationships' || tableName === 'links') {
        const relParams = idVal !== undefined ? { entry_id: idVal, ...scopeFields } : scopeFields
        return `return await mj.relationships.visualizeRelationships(${JSON.stringify(relParams)});`
    }
    if (tableName === 'team_members' || tableName === 'members') {
        return `return await mj.team.teamListMembers(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'author_aliases' || tableName === 'aliases') {
        return `return await mj.team.teamListAuthorAliases(${JSON.stringify(scopeFields)});`
    }
    return `return await mj.admin.searchAuditLog(${JSON.stringify(scopeFields)});`
}

function recoverEntrySelect(
    cleanSql: string,
    tableName: string | undefined,
    whereClause: string,
    idVal: number | undefined,
    limitVal: number | undefined,
    scopeFields: Record<string, unknown>
): string | null {
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return null
    const wherePos = findTopLevelSqlKeyword(cleanSql, 'WHERE')
    const selectHead = (wherePos >= 0 ? cleanSql.slice(0, wherePos) : cleanSql).replace(
        /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"/g,
        "''"
    )
    if (/\bCOUNT\s*\(/i.test(selectHead)) return null
    if (idVal !== undefined) {
        if (Object.keys(scopeFields).length === 0) {
            return `return await mj.core.getEntryById({ entry_id: ${String(idVal)} });`
        }
        return `return await mj.core.getEntryById(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
    }
    const searchQuery = extractTopLevelWhereLikeQuery(whereClause)
    if (searchQuery !== undefined) {
        const searchParams: Record<string, unknown> = { query: searchQuery, ...scopeFields }
        if (limitVal !== undefined) searchParams['limit'] = limitVal
        return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
    }
    return null
}

function recoverEntryUpdate(
    cleanSql: string,
    updateTable: string | undefined,
    idVal: number | undefined,
    scopeFields: Record<string, unknown>
): string | null {
    if (updateTable === undefined || !ENTRY_TABLE_NAMES.has(updateTable) || idVal === undefined) {
        return null
    }
    const setClause = extractTopLevelUpdateSetClause(cleanSql)
    let setContent: string | undefined
    let setWs: string | undefined
    let setProj: number | undefined
    for (const assignment of splitSqlValueList(setClause)) {
        const eq = assignment.indexOf('=')
        if (eq < 0) continue
        const col = assignment.slice(0, eq).trim().replace(/[`"']/g, '').toLowerCase()
        const rhs = assignment.slice(eq + 1).trim()
        if (col === 'content') {
            setContent = unquoteSqlString(rhs) ?? undefined
        } else if (col === 'workspace_id') {
            const ws = unquoteSqlString(rhs)?.trim()
            if (ws !== undefined && ws !== '') setWs = ws
        } else if (col === 'project_number' || col === 'project_id') {
            const cleaned = (unquoteSqlString(rhs) ?? rhs).trim()
            if (/^\d+$/.test(cleaned)) setProj = parseInt(cleaned, 10)
        }
    }
    if (setContent === undefined) return null
    const whereProj =
        typeof scopeFields['project_number'] === 'number' ? scopeFields['project_number'] : undefined
    if (setProj !== undefined && whereProj !== undefined && setProj !== whereProj) {
        return null
    }
    const updatePayload: Record<string, unknown> = {
        entry_id: idVal,
        content: setContent,
        ...scopeFields,
        ...(setWs !== undefined ? { target_workspace_id: setWs } : {}),
        ...(whereProj === undefined && setProj !== undefined ? { project_number: setProj } : {}),
    }
    return `return await mj.admin.updateEntry(${JSON.stringify(updatePayload)});`
}

/**
 * Auto-heals raw SQL queries passed as code or script in Code Mode,
 * translating them to corresponding type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverSqlCode(code: string): string | null {
    const cleanSql = parseCleanRecoverableSql(code)
    if (cleanSql === null) return null
    if (hasUnsupportedWherePredicate(cleanSql)) return null

    const fromMatch = /\bFROM\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = fromMatch?.[1]?.toLowerCase()
    const updateTableMatch = /^UPDATE\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const updateTable = updateTableMatch?.[1]?.toLowerCase()
    const limitVal = extractTopLevelLimit(cleanSql)
    const whereClause = extractTopLevelWhereClause(cleanSql)
    const idVal = extractTopLevelWhereId(whereClause)
    const scopeFields = scopeFromSqlLiterals(cleanSql)

    if (tableName !== undefined && SPECIAL_TABLES.has(tableName)) {
        return recoverSpecialTableSelect(cleanSql, tableName, whereClause, idVal, scopeFields)
    }
    if (/^SELECT\b/i.test(cleanSql)) {
        return recoverEntrySelect(cleanSql, tableName, whereClause, idVal, limitVal, scopeFields)
    }
    if (/^INSERT\s+INTO\b/i.test(cleanSql)) {
        const parsedInsert = parseSqlStatement(cleanSql, [])
        if (parsedInsert.action === 'create') {
            return `return await mj.core.createEntry(${JSON.stringify(parsedInsert.params)});`
        }
        return null
    }
    if (/^UPDATE\b/i.test(cleanSql)) {
        return recoverEntryUpdate(cleanSql, updateTable, idVal, scopeFields)
    }
    if (/^DELETE\b/i.test(cleanSql)) {
        if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName) || idVal === undefined) {
            return null
        }
        return `return await mj.admin.deleteEntry(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
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
