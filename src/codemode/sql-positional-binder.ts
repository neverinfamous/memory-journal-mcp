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
    extractFromTableName,
    extractParenGroup,
    extractTopLevelUpdateSetClause,
    extractTopLevelWhereClause,
    findTopLevelSqlKeyword,
    hasUnsupportedWherePredicate,
    isSupportedWhereClause,
    scopeFromInsertLiterals,
    scopeFromSqlLiterals,
    splitSqlValueList,
    splitTopLevelSqlAndClauses,
    stripBalancedOuterParens,
} from './sql-literal-scope.js'
import {
    createSqlRecordBindIndex,
    hasMultipleTopLevelSqlStatements,
    isPlainRecord,
    listSqlPlaceholders,
    normalizeSqlColumn,
    type Placeholder,
    type SqlRecordBindIndex,
} from './sql-placeholder-helpers.js'
import { parsePositiveProjectNumber } from '../utils/safe-positive-int.js'
import {
    assignColumn,
    bindSetColumnNameCheck,
    mergeUnusedRecordBinds,
    parseLiteral,
    type SqlLockedScope,
    UNPARSEABLE,
} from './sql-record-bind-helpers.js'

export interface ParsedSql {
    action: 'create' | 'update' | 'delete' | 'get_by_id' | 'unmapped' | 'other'
    params: Record<string, unknown>
}

const UNMAPPED: ParsedSql = { action: 'unmapped', params: {} }
const CLAUSE_ID_LITERAL =
    /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)$/i
const NAMED_PLACEHOLDER_RE = /^[@:$][A-Za-z_][\w]*$/

interface PlaceholderBindResult {
    ok: boolean
    bindIndex: SqlRecordBindIndex
    consumedIds: Set<number>
}

/**
 * Binds positional and named values against placeholder columns. Fails when any placeholder is
 * left unbound or names no column; surplus trailing positional binds are ignored.
 */
function bindPlaceholders(
    cleanSql: string,
    args: unknown[],
    onBind: (placeholder: Placeholder, val: unknown) => boolean
): PlaceholderBindResult {
    const positional = args.filter((a) => !isPlainRecord(a))
    const bindIndex = createSqlRecordBindIndex(args)
    const consumedIds = new Set<number>()
    const placeholders = listSqlPlaceholders(cleanSql)
    let posIdx = 0
    for (const ph of placeholders) {
        if (ph.namedKey !== undefined) {
            const match = bindIndex.resolveNamed(ph.namedKey)
            if (match === undefined) return { ok: false, bindIndex, consumedIds }
            consumedIds.add(match.id)
            if (!onBind(ph, match.value)) return { ok: false, bindIndex, consumedIds }
            continue
        }
        if (positional.length > 0) {
            if (posIdx >= positional.length || !onBind(ph, positional[posIdx++])) {
                return { ok: false, bindIndex, consumedIds }
            }
            continue
        }
        if (ph.column === undefined) return { ok: false, bindIndex, consumedIds }
        const match = bindIndex.resolveColumn(ph.column)
        if (match === undefined) return { ok: false, bindIndex, consumedIds }
        consumedIds.add(match.id)
        if (!onBind(ph, match.value)) return { ok: false, bindIndex, consumedIds }
    }
    return { ok: true, bindIndex, consumedIds }
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
        if (match?.[1] !== undefined) return parsePositiveProjectNumber(match[1])
    }
    return undefined
}

function parseUpdateSetLiterals(cleanSql: string, setFields: Record<string, unknown>): boolean {
    const setClause = extractTopLevelUpdateSetClause(cleanSql)
    const setAssignments = splitSqlValueList(setClause)
    if (setAssignments.length === 0) return false
    for (const assignment of setAssignments) {
        const eq = assignment.indexOf('=')
        if (eq < 0) return false
        const col = normalizeSqlColumn(assignment.slice(0, eq))
        if (!bindSetColumnNameCheck(col)) return false
        const rhs = assignment.slice(eq + 1).trim()
        if (rhs === '?' || NAMED_PLACEHOLDER_RE.test(rhs)) continue
        const literal = parseLiteral(rhs)
        if (literal === UNPARSEABLE || !assignColumn(setFields, col, literal)) return false
    }
    return true
}

function parseUpdate(cleanSql: string, args: unknown[]): ParsedSql {
    const tableMatch = /^UPDATE\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = tableMatch?.[1]?.toLowerCase()
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return UNMAPPED
    if (hasUnsupportedWherePredicate(cleanSql)) return UNMAPPED
    const whereClause = extractTopLevelWhereClause(cleanSql)
    if (whereClause === '' || !isSupportedWhereClause(whereClause, { allowPlaceholder: true })) {
        return UNMAPPED
    }

    const setFields: Record<string, unknown> = {}
    const where: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) where['entry_id'] = id

    const bindRes = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined) return false
        if (!ph.inWhere && !bindSetColumnNameCheck(ph.column)) return false
        return assignColumn(ph.inWhere ? where : setFields, ph.column, val)
    })
    if (!bindRes.ok || !parseUpdateSetLiterals(cleanSql, setFields)) return UNMAPPED

    const payload: Record<string, unknown> = { ...setFields }
    if (typeof payload['workspace_id'] === 'string' && payload['workspace_id'] !== '') {
        payload['target_workspace_id'] ??= payload['workspace_id']
        Reflect.deleteProperty(payload, 'workspace_id')
    }
    const whereLiteralScope = scopeFromSqlLiterals(whereClause)
    const boundWhereWs =
        typeof where['workspace_id'] === 'string'
            ? where['workspace_id']
            : typeof whereLiteralScope['workspace_id'] === 'string'
              ? whereLiteralScope['workspace_id']
              : undefined
    const whereProj =
        where['project_number'] !== undefined
            ? (where['project_number'] as number | null)
            : typeof whereLiteralScope['project_number'] === 'number'
              ? whereLiteralScope['project_number']
              : undefined
    const setProj = setFields['project_number'] as number | null | undefined
    if (setProj !== undefined && whereProj !== undefined && Number(setProj) !== whereProj) {
        return UNMAPPED
    }
    const lockedScope: SqlLockedScope = {
        workspaceId: boundWhereWs,
        targetWorkspaceId:
            typeof payload['target_workspace_id'] === 'string'
                ? payload['target_workspace_id']
                : undefined,
        projectNumber: whereProj ?? setProj,
    }
    if (!mergeUnusedRecordBinds(payload, bindRes.bindIndex, bindRes.consumedIds, lockedScope)) {
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
    bindIndex: SqlRecordBindIndex,
    consumedIds: Set<number>
): boolean {
    if (columns.length !== values.length) return false
    let cursor = 0
    for (let i = 0; i < columns.length; i++) {
        const column = columns[i] ?? ''
        const rawTrimmed = (values[i] ?? '').trim()
        if (NAMED_PLACEHOLDER_RE.test(rawTrimmed)) {
            const match = bindIndex.resolveNamed(rawTrimmed)
            if (match === undefined) return false
            consumedIds.add(match.id)
            if (!assignColumn(payload, column, match.value)) return false
            continue
        }
        if (rawTrimmed === '?') {
            if (positional.length > 0) {
                if (cursor >= positional.length || !assignColumn(payload, column, positional[cursor++])) {
                    return false
                }
                continue
            }
            const match = bindIndex.resolveColumn(column)
            if (match === undefined) return false
            consumedIds.add(match.id)
            if (!assignColumn(payload, column, match.value)) return false
            continue
        }
        const literal = parseLiteral(rawTrimmed)
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
    const bindIndex = createSqlRecordBindIndex(args)
    const consumedIds = new Set<number>()
    const valuesIdx = findTopLevelSqlKeyword(cleanSql, 'VALUES')
    const head = valuesIdx >= 0 ? cleanSql.slice(0, valuesIdx) : ''
    const openCols = head.indexOf('(')
    const openVals = valuesIdx >= 0 ? cleanSql.indexOf('(', valuesIdx + 6) : -1
    const colGroup = openCols >= 0 ? extractParenGroup(head, openCols) : null
    const valGroup = openVals >= 0 ? extractParenGroup(cleanSql, openVals) : null
    if (colGroup !== null && valGroup !== null) {
        const trailing = cleanSql.slice(valGroup.endIdx + 1).replace(/;\s*$/, '').trim()
        if (trailing !== '' && !/^RETURNING\b/i.test(trailing)) return UNMAPPED
        const columns = colGroup.inner.split(',').map(normalizeSqlColumn)
        const values = splitSqlValueList(valGroup.inner)
        if (!bindInsertColumns(payload, columns, values, positional, bindIndex, consumedIds)) {
            return UNMAPPED
        }
    } else if (positional.length > 0) {
        return UNMAPPED
    }
    const literalScope = scopeFromInsertLiterals(cleanSql)
    const lockedScope: SqlLockedScope = {
        workspaceId:
            typeof payload['workspace_id'] === 'string'
                ? payload['workspace_id']
                : typeof literalScope['workspace_id'] === 'string'
                  ? literalScope['workspace_id']
                  : undefined,
        projectNumber:
            payload['project_number'] !== undefined
                ? (payload['project_number'] as number | null)
                : typeof literalScope['project_number'] === 'number'
                  ? literalScope['project_number']
                  : undefined,
    }
    if (!mergeUnusedRecordBinds(payload, bindIndex, consumedIds, lockedScope)) return UNMAPPED
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
    const tableName = extractFromTableName(cleanSql)
    if (tableName === undefined || !ENTRY_TABLE_NAMES.has(tableName)) return UNMAPPED
    if (hasUnsupportedWherePredicate(cleanSql)) return UNMAPPED
    const whereClause = extractTopLevelWhereClause(cleanSql)
    if (whereClause === '' || !isSupportedWhereClause(whereClause, { allowPlaceholder: true })) {
        return UNMAPPED
    }

    const payload: Record<string, unknown> = {}
    const id = literalEntryId(cleanSql)
    if (id !== undefined) payload['entry_id'] = id
    const bindRes = bindPlaceholders(cleanSql, args, (ph, val) => {
        if (ph.column === undefined || !ph.inWhere) return false
        return assignColumn(payload, ph.column, val)
    })
    if (!bindRes.ok) return UNMAPPED
    const literalScope = scopeFromSqlLiterals(whereClause)
    const lockedScope: SqlLockedScope = {
        workspaceId:
            typeof payload['workspace_id'] === 'string'
                ? payload['workspace_id']
                : typeof literalScope['workspace_id'] === 'string'
                  ? literalScope['workspace_id']
                  : undefined,
        projectNumber:
            payload['project_number'] !== undefined
                ? (payload['project_number'] as number | null)
                : typeof literalScope['project_number'] === 'number'
                  ? literalScope['project_number']
                  : undefined,
    }
    const records: Record<string, unknown> = {}
    if (!mergeUnusedRecordBinds(records, bindRes.bindIndex, bindRes.consumedIds, lockedScope)) {
        return UNMAPPED
    }
    if (records['workspace_id'] !== undefined) payload['workspace_id'] ??= records['workspace_id']
    if (records['project_number'] !== undefined) payload['project_number'] ??= records['project_number']
    if (records['entry_id'] !== undefined) payload['entry_id'] ??= records['entry_id']
    applyWhereScope(payload, cleanSql)
    if (payload['entry_id'] === undefined) return UNMAPPED
    return { action, params: payload }
}

/** Strips `--` line comments and block comments outside SQL string literals. */
export function cleanSqlText(sql: string): string {
    const out: string[] = []
    let quote: string | null = null
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i] ?? ''
        if (quote !== null) {
            out.push(ch)
            if (ch === '\\' && i + 1 < sql.length) { out.push(sql[++i] ?? '') }
            else if (ch === quote && sql[i + 1] === quote) { out.push(quote); i++ }
            else if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out.push(ch) }
        else if (ch === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i + 2)
            if (nl === -1) break
            out.push('\n'); i = nl
        } else if (ch === '/' && sql[i + 1] === '*') {
            const end = sql.indexOf('*/', i + 2)
            if (end === -1) break
            out.push(' '); i = end + 1
        } else out.push(ch)
    }
    return out.join('').trim()
}

/** Parses a SQL statement + positional/record binds into a journal action payload. */
export function parseSqlStatement(sql: string, args: unknown[]): ParsedSql {
    const cleanSql = cleanSqlText(sql)
    if (hasMultipleTopLevelSqlStatements(cleanSql)) return UNMAPPED
    if (/^UPDATE\b/i.test(cleanSql)) return parseUpdate(cleanSql, args)
    if (/^INSERT\b/i.test(cleanSql)) return parseInsert(cleanSql, args)
    if (/^DELETE\b/i.test(cleanSql)) return parseWhereOnly(cleanSql, args, 'delete')
    if (/^SELECT\b/i.test(cleanSql)) return parseWhereOnly(cleanSql, args, 'get_by_id')
    return { action: 'other', params: {} }
}
