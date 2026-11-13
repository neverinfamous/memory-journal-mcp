/**
 * SQL positional binder — maps raw `db.prepare(sql).run(...binds)` hallucinations onto
 * journal method payloads by binding each `?` placeholder to the column it targets.
 *
 * [INVARIANT] A bind value is only ever assigned to the column named next to its
 * placeholder. Statements whose placeholders cannot be paired 1:1 with positional
 * binds resolve to `unmapped` instead of guessing (e.g. "first number = entry_id").
 */

import { scopeFromInsertLiterals, scopeFromSqlLiterals, splitSqlValueList } from './sql-literal-scope.js'

export interface ParsedSql {
    action: 'create' | 'update' | 'delete' | 'get_by_id' | 'unmapped' | 'other'
    params: Record<string, unknown>
}

interface Placeholder {
    column: string | undefined
    inWhere: boolean
}

const UNMAPPED: ParsedSql = { action: 'unmapped', params: {} }
const WHERE_ID_LITERAL = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)/i
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
    let inWhere = false
    for (let i = 0; i < cleanSql.length; i++) {
        const ch = cleanSql[i] ?? ''
        if (quote !== null) {
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }
        if (!inWhere && /^WHERE\b/i.test(cleanSql.slice(i, i + 6)) && /\W/.test(cleanSql[i - 1] ?? ' ')) {
            inWhere = true
        }
        if (ch === '?') {
            const match = COLUMN_BEFORE_PLACEHOLDER.exec(cleanSql.slice(0, i))
            result.push({ column: match?.[1] !== undefined ? normalizeColumn(match[1]) : undefined, inWhere })
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
            const pn = toPositiveInt(val)
            if (pn !== undefined) payload['project_number'] = pn
            return pn !== undefined
        }
        case 'workspace_id':
            if (typeof val === 'string' && val.trim() !== '') payload['workspace_id'] = val
            return true
        case 'content':
        case 'title':
        case 'significance_type':
            if (typeof val === 'string') payload[column] = val
            return true
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

function mergeRecordBinds(payload: Record<string, unknown>, args: unknown[]): void {
    for (const arg of args) {
        if (!isPlainRecord(arg)) continue
        for (const [key, val] of Object.entries(arg)) {
            const col = key.replace(/^[@:$]/, '').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
            assignColumn(payload, col, val)
        }
    }
}

function parseLiteral(raw: string): unknown {
    const trimmed = raw.trim()
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
    if (trimmed.length >= 2 && (trimmed.startsWith("'") || trimmed.startsWith('"'))) {
        return trimmed.slice(1, -1).replace(/''/g, "'")
    }
    return undefined
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
    if (positional.length === 0) return true
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
    const match = WHERE_ID_LITERAL.exec(cleanSql)
    return match?.[1] !== undefined ? parseInt(match[1], 10) : undefined
}

function parseUpdate(cleanSql: string, args: unknown[]): ParsedSql {
    const setFields: Record<string, unknown> = {}
    const where: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) where['entry_id'] = id

    const bound = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined) return false
        return assignColumn(ph.inWhere ? where : setFields, ph.column, val)
    })
    if (!bound) return UNMAPPED

    const setClause = /\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/i.exec(cleanSql)?.[1] ?? ''
    for (const assignment of splitSqlValueList(setClause)) {
        const eq = assignment.indexOf('=')
        if (eq < 0) continue
        const literal = parseLiteral(assignment.slice(eq + 1))
        if (literal !== undefined) assignColumn(setFields, normalizeColumn(assignment.slice(0, eq)), literal)
    }

    const payload: Record<string, unknown> = { ...setFields }
    mergeRecordBinds(payload, args)
    if (where['entry_id'] !== undefined) payload['entry_id'] = where['entry_id']
    if (where['workspace_id'] !== undefined) payload['workspace_id'] ??= where['workspace_id']
    if (where['project_number'] !== undefined) payload['project_number'] ??= where['project_number']
    applyWhereScope(payload, cleanSql)
    if (payload['entry_id'] === undefined) return UNMAPPED
    return { action: 'update', params: payload }
}

function parseInsert(cleanSql: string, args: unknown[]): ParsedSql {
    const payload: Record<string, unknown> = {}
    const match = /\bINSERT\s+INTO\b[\s\S]*?\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(cleanSql)
    const positional = args.filter((a) => !isPlainRecord(a))
    if (match?.[1] !== undefined && match[2] !== undefined) {
        const columns = match[1].split(',').map(normalizeColumn)
        const values = splitSqlValueList(match[2])
        if (columns.length !== values.length) return UNMAPPED
        let cursor = 0
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i] ?? ''
            const raw = values[i] ?? ''
            if (raw === '?') {
                // Record-only binds (named params) leave placeholders to mergeRecordBinds.
                if (positional.length === 0) continue
                if (cursor >= positional.length) return UNMAPPED
                assignColumn(payload, column, positional[cursor++])
            } else {
                const literal = parseLiteral(raw)
                if (literal !== undefined) assignColumn(payload, column, literal)
            }
        }
    } else if (positional.length > 0) {
        return UNMAPPED
    }
    mergeRecordBinds(payload, args)
    const literalScope = { ...scopeFromSqlLiterals(cleanSql), ...scopeFromInsertLiterals(cleanSql) }
    if (payload['workspace_id'] === undefined && typeof literalScope['workspace_id'] === 'string') {
        payload['workspace_id'] = literalScope['workspace_id']
    }
    if (payload['project_number'] === undefined && typeof literalScope['project_number'] === 'number') {
        payload['project_number'] = literalScope['project_number']
    }
    if (typeof payload['content'] !== 'string' || payload['content'] === '') return UNMAPPED
    payload['entry_type'] ??= 'technical_decision'
    return { action: 'create', params: payload }
}

function parseWhereOnly(cleanSql: string, args: unknown[], action: 'delete' | 'get_by_id'): ParsedSql {
    const payload: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) payload['entry_id'] = id
    const bound = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined || !ph.inWhere) return false
        return assignColumn(payload, ph.column, val)
    })
    if (!bound) return UNMAPPED
    const records: Record<string, unknown> = {}
    mergeRecordBinds(records, args)
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
