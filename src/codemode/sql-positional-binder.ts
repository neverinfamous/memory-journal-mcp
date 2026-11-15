/**
 * SQL positional binder — maps raw `db.prepare(sql).run(...binds)` hallucinations onto
 * journal method payloads by binding each `?` placeholder to the column it targets.
 *
 * [INVARIANT] A bind value is only ever assigned to the column named next to its
 * placeholder. Statements whose placeholders cannot be paired 1:1 with positional
 * binds resolve to `unmapped` instead of guessing (e.g. "first number = entry_id").
 */

import {
    ENTRY_TABLE_NAMES,
    extractParenGroup,
    extractTopLevelUpdateSetClause,
    extractTopLevelWhereClause,
    findTopLevelSqlKeyword,
    hasUnsupportedWherePredicate,
    scopeFromInsertLiterals,
    scopeFromSqlLiterals,
    splitSqlValueList,
    splitTopLevelSqlAndClauses,
    stripBalancedOuterParens,
} from './sql-literal-scope.js'

export interface ParsedSql {
    action: 'create' | 'update' | 'delete' | 'get_by_id' | 'unmapped' | 'other'
    params: Record<string, unknown>
}

interface Placeholder {
    column: string | undefined
    inWhere: boolean
}

const UNMAPPED: ParsedSql = { action: 'unmapped', params: {} }
const UNPARSEABLE = Symbol('unparseable')
const CLAUSE_ID_LITERAL =
    /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)$/i
const COLUMN_BEFORE_PLACEHOLDER = /[`"'[]?([A-Za-z_][\w]*)[`"'\]]?\s*(?:=|==|LIKE)\s*$/i

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function normalizeColumn(raw: string): string {
    const col = raw.trim().replace(/[`"'[\]]/g, '').toLowerCase()
    const dot = col.lastIndexOf('.')
    return dot >= 0 ? col.slice(dot + 1) : col
}

/** Lists every `?` outside string literals with its target column and clause. */
function listPlaceholders(cleanSql: string): Placeholder[] {
    const result: Placeholder[] = []
    let quote: string | null = null
    let depth = 0
    const whereIdx = findTopLevelSqlKeyword(cleanSql, 'WHERE')
    for (let i = 0; i < cleanSql.length; i++) {
        const ch = cleanSql[i] ?? ''
        if (quote !== null) {
            if (ch === '\\' && i + 1 < cleanSql.length) {
                i++
                continue
            }
            if (ch === quote) {
                if (cleanSql[i + 1] === quote) {
                    i++
                    continue
                }
                quote = null
            }
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch
            continue
        }
        if (ch === '(') depth++
        else if (ch === ')' && depth > 0) depth--
        if (ch === '?') {
            const match = COLUMN_BEFORE_PLACEHOLDER.exec(cleanSql.slice(0, i))
            const inWhere = whereIdx >= 0 && i >= whereIdx && depth >= 0
            result.push({
                column: match?.[1] !== undefined ? normalizeColumn(match[1]) : undefined,
                inWhere,
            })
        }
    }
    return result
}

function toPositiveInt(val: unknown): number | undefined {
    if (typeof val === 'number' && Number.isInteger(val) && val > 0) return val
    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
        const n = Number(val.trim())
        return n > 0 ? n : undefined
    }
    return undefined
}

function toTags(val: unknown): string[] | undefined {
    if (Array.isArray(val)) return val.map(String)
    if (typeof val !== 'string') return undefined
    const trimmed = val.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed: unknown = JSON.parse(trimmed)
            if (Array.isArray(parsed)) return parsed.map(String)
        } catch {
            // Not JSON: fall through to comma-separated parsing.
        }
    }
    return trimmed === '' ? [] : trimmed.split(',').map((t) => t.trim()).filter((t) => t !== '')
}

/** Assigns a bound value to its canonical journal field; returns false when the column is unknown. */
function assignColumn(payload: Record<string, unknown>, column: string, val: unknown): boolean {
    switch (column) {
        case 'id':
        case 'entry_id': {
            const id = toPositiveInt(val)
            if (id !== undefined) payload['entry_id'] = id
            return id !== undefined
        }
        case 'project_number':
        case 'project_id': {
            if (val === null) {
                payload['project_number'] = null
                return true
            }
            const pn = toPositiveInt(val)
            if (pn !== undefined) payload['project_number'] = pn
            return pn !== undefined
        }
        case 'workspace_id':
            if (typeof val === 'string' && val.trim() !== '') {
                payload['workspace_id'] = val.trim()
                return true
            }
            return false
        case 'significance_type':
            if (val === null || typeof val === 'string') {
                payload['significance_type'] = val
                return true
            }
            return false
        case 'content':
        case 'title':
            if (typeof val === 'string') {
                payload[column] = val
                return true
            }
            return false
        case 'entry_type':
        case 'type':
            if (typeof val === 'string') payload['entry_type'] = val
            return true
        case 'tags': {
            const tags = toTags(val)
            if (tags !== undefined) payload['tags'] = tags
            return true
        }
        case 'is_personal':
            payload['is_personal'] = val === true || val === 1 || val === '1' || val === 'true'
            return true
        default:
            return false
    }
}

function mergeRecordBinds(payload: Record<string, unknown>, args: unknown[]): boolean {
    for (const arg of args) {
        if (!isPlainRecord(arg)) continue
        for (const [key, val] of Object.entries(arg)) {
            const col = key.replace(/^[@:$]/, '').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
            if (!assignColumn(payload, col, val)) return false
        }
    }
    return true
}

function parseLiteral(raw: string): unknown {
    const trimmed = raw.trim()
    if (/^null$/i.test(trimmed)) return null
    if (/^true$/i.test(trimmed)) return true
    if (/^false$/i.test(trimmed)) return false
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
    if (
        trimmed.length >= 2 &&
        ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"')))
    ) {
        const inner = trimmed.slice(1, -1)
        const doubled = trimmed.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/""/g, '"')
        return doubled.replace(/\\(['"\\])/g, '$1')
    }
    return UNPARSEABLE
}

/**
 * Binds positional values against placeholder columns. Fails when a placeholder is left
 * unbound or names no column; surplus trailing binds are ignored (never re-interpreted).
 */
function bindPlaceholders(
    cleanSql: string,
    args: unknown[],
    onBind: (placeholder: Placeholder, val: unknown) => boolean
): boolean {
    const positional = args.filter((a) => !isPlainRecord(a))
    const placeholders = listPlaceholders(cleanSql)
    if (positional.length === 0) return placeholders.length === 0 || args.some(isPlainRecord)
    if (positional.length < placeholders.length) return false
    for (let i = 0; i < placeholders.length; i++) {
        const ph = placeholders[i]
        if (ph === undefined || !onBind(ph, positional[i])) return false
    }
    return true
}

function applyWhereScope(payload: Record<string, unknown>, cleanSql: string): void {
    const sqlScope = scopeFromSqlLiterals(cleanSql)
    if (payload['workspace_id'] === undefined && typeof sqlScope['workspace_id'] === 'string') {
        payload['workspace_id'] = sqlScope['workspace_id']
    }
    if (payload['project_number'] === undefined && typeof sqlScope['project_number'] === 'number') {
        payload['project_number'] = sqlScope['project_number']
    }
}

function literalEntryId(cleanSql: string): number | undefined {
    const whereClause = extractTopLevelWhereClause(cleanSql)
    if (whereClause === '') return undefined
    for (const rawClause of splitTopLevelSqlAndClauses(whereClause)) {
        const match = CLAUSE_ID_LITERAL.exec(stripBalancedOuterParens(rawClause))
        if (match?.[1] !== undefined) return parseInt(match[1], 10)
    }
    return undefined
}

function parseUpdate(cleanSql: string, args: unknown[]): ParsedSql {
    const tableMatch = /^UPDATE\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = tableMatch?.[1]?.toLowerCase()
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return UNMAPPED
    if (hasUnsupportedWherePredicate(cleanSql)) return UNMAPPED

    const setFields: Record<string, unknown> = {}
    const where: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) where['entry_id'] = id

    const bound = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined) return false
        return assignColumn(ph.inWhere ? where : setFields, ph.column, val)
    })
    if (!bound) return UNMAPPED

    const setClause = extractTopLevelUpdateSetClause(cleanSql)
    for (const assignment of splitSqlValueList(setClause)) {
        const eq = assignment.indexOf('=')
        if (eq < 0) continue
        const rhs = assignment.slice(eq + 1).trim()
        if (rhs === '?' || /^[@:$][A-Za-z_][\w]*$/.test(rhs)) continue
        const literal = parseLiteral(rhs)
        if (
            literal === UNPARSEABLE ||
            !assignColumn(setFields, normalizeColumn(assignment.slice(0, eq)), literal)
        ) {
            return UNMAPPED
        }
    }

    const payload: Record<string, unknown> = { ...setFields }
    if (typeof payload['workspace_id'] === 'string' && payload['workspace_id'] !== '') {
        payload['target_workspace_id'] ??= payload['workspace_id']
        Reflect.deleteProperty(payload, 'workspace_id')
    }
    if (!mergeRecordBinds(payload, args)) return UNMAPPED
    const whereClause = extractTopLevelWhereClause(cleanSql)
    const whereLiteralScope = scopeFromSqlLiterals(whereClause)
    const whereProj =
        typeof where['project_number'] === 'number'
            ? where['project_number']
            : typeof whereLiteralScope['project_number'] === 'number'
              ? whereLiteralScope['project_number']
              : undefined
    if (
        setFields['project_number'] !== undefined &&
        whereProj !== undefined &&
        Number(setFields['project_number']) !== whereProj
    ) {
        return UNMAPPED
    }
    if (where['entry_id'] !== undefined) payload['entry_id'] = where['entry_id']
    if (where['workspace_id'] !== undefined) payload['workspace_id'] ??= where['workspace_id']
    if (where['project_number'] !== undefined) payload['project_number'] ??= where['project_number']
    applyWhereScope(payload, whereClause)
    if (payload['entry_id'] === undefined) return UNMAPPED
    return { action: 'update', params: payload }
}

function bindInsertColumns(
    payload: Record<string, unknown>,
    columns: string[],
    values: string[],
    positional: unknown[],
    hasRecordBind: boolean
): boolean {
    if (columns.length !== values.length) return false
    let cursor = 0
    for (let i = 0; i < columns.length; i++) {
        const column = columns[i] ?? ''
        const raw = values[i] ?? ''
        const rawTrimmed = raw.trim()
        if (rawTrimmed === '?' || /^[@:$][A-Za-z_][\w]*$/.test(rawTrimmed)) {
            if (rawTrimmed !== '?') continue
            // Record-only binds (named params) leave placeholders to mergeRecordBinds.
            if (positional.length === 0) {
                if (!hasRecordBind) return false
                continue
            }
            if (cursor >= positional.length) return false
            if (!assignColumn(payload, column, positional[cursor++])) return false
            continue
        }
        const literal = parseLiteral(raw)
        if (literal === UNPARSEABLE || !assignColumn(payload, column, literal)) return false
    }
    return true
}

function parseInsert(cleanSql: string, args: unknown[]): ParsedSql {
    const tableMatch = /^INSERT\s+INTO\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = tableMatch?.[1]?.toLowerCase()
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return UNMAPPED

    const payload: Record<string, unknown> = {}
    const positional = args.filter((a) => !isPlainRecord(a))
    const hasRecordBind = args.some(isPlainRecord)
    const valuesIdx = findTopLevelSqlKeyword(cleanSql, 'VALUES')
    const head = valuesIdx >= 0 ? cleanSql.slice(0, valuesIdx) : ''
    const openCols = head.indexOf('(')
    const openVals = valuesIdx >= 0 ? cleanSql.indexOf('(', valuesIdx + 6) : -1
    const colGroup = openCols >= 0 ? extractParenGroup(head, openCols) : null
    const valGroup = openVals >= 0 ? extractParenGroup(cleanSql, openVals) : null
    if (colGroup !== null && valGroup !== null) {
        const trailing = cleanSql.slice(valGroup.endIdx + 1).replace(/;\s*$/, '').trim()
        if (trailing !== '' && !/^RETURNING\b/i.test(trailing)) return UNMAPPED
        const columns = colGroup.inner.split(',').map(normalizeColumn)
        const values = splitSqlValueList(valGroup.inner)
        if (!bindInsertColumns(payload, columns, values, positional, hasRecordBind)) return UNMAPPED
    } else if (positional.length > 0) {
        return UNMAPPED
    }
    if (!mergeRecordBinds(payload, args)) return UNMAPPED
    const literalScope = scopeFromInsertLiterals(cleanSql)
    if (payload['workspace_id'] === undefined && typeof literalScope['workspace_id'] === 'string') {
        payload['workspace_id'] = literalScope['workspace_id']
    }
    if (payload['project_number'] === undefined && typeof literalScope['project_number'] === 'number') {
        payload['project_number'] = literalScope['project_number']
    }
    if (typeof payload['content'] !== 'string' || payload['content'] === '') return UNMAPPED
    payload['entry_type'] ??= 'technical_note'
    return { action: 'create', params: payload }
}

function parseWhereOnly(cleanSql: string, args: unknown[], action: 'delete' | 'get_by_id'): ParsedSql {
    const tableMatch = /\bFROM\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = tableMatch?.[1]?.toLowerCase()
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return UNMAPPED
    if (hasUnsupportedWherePredicate(cleanSql)) return UNMAPPED

    const payload: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) payload['entry_id'] = id
    const bound = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined || !ph.inWhere) return false
        return assignColumn(payload, ph.column, val)
    })
    if (!bound) return UNMAPPED
    const records: Record<string, unknown> = {}
    if (!mergeRecordBinds(records, args)) return UNMAPPED
    if (records['workspace_id'] !== undefined) payload['workspace_id'] = records['workspace_id']
    if (records['project_number'] !== undefined) payload['project_number'] = records['project_number']
    if (records['entry_id'] !== undefined) payload['entry_id'] ??= records['entry_id']
    applyWhereScope(payload, cleanSql)
    if (payload['entry_id'] === undefined) return UNMAPPED
    return { action, params: payload }
}

/** Strips leading line comments and block comments from a SQL string. */
export function cleanSqlText(sql: string): string {
    return sql
        .trim()
        .replace(/^--[^\n]*\n/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
}

/** Parses a SQL statement + positional/record binds into a journal action payload. */
export function parseSqlStatement(sql: string, args: unknown[]): ParsedSql {
    const cleanSql = cleanSqlText(sql)
    if (/^UPDATE\b/i.test(cleanSql)) return parseUpdate(cleanSql, args)
    if (/^INSERT\b/i.test(cleanSql)) return parseInsert(cleanSql, args)
    if (/^DELETE\b/i.test(cleanSql)) return parseWhereOnly(cleanSql, args, 'delete')
    if (/^SELECT\b/i.test(cleanSql)) return parseWhereOnly(cleanSql, args, 'get_by_id')
    return { action: 'other', params: {} }
}
