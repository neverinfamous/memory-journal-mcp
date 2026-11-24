/**
 * SQL and prepared statement recovery helpers for Code Mode execution payloads.
 */

import {
    ENTRY_TABLE_NAMES,
    extractFromTableName,
    extractTopLevelUpdateSetClause,
    extractTopLevelWhereClause,
    findTopLevelSqlKeyword,
    hasUnsupportedWherePredicate,
    isSingleSqlStringLiteral,
    isSupportedWhereClause,
    scopeFromSqlLiterals,
    splitSqlValueList,
    splitTopLevelSqlAndClauses,
    stripBalancedOuterParens,
} from '../../../codemode/sql-literal-scope.js'
import { cleanSqlText, parseSqlStatement } from '../../../codemode/sql-positional-binder.js'
import { hasUnsupportedSqlTrailingClause } from '../../../codemode/sql-clause-validator.js'
import { hasMultipleTopLevelSqlStatements } from '../../../codemode/sql-placeholder-helpers.js'
import {
    parseCanonicalPositiveInt,
    parsePositiveProjectNumber,
} from '../../../utils/safe-positive-int.js'

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
    if (!isSingleSqlStringLiteral(trimmed)) return null
    const quote = trimmed[0]
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
    if (hasMultipleTopLevelSqlStatements(cleanSql)) return null
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
    if (/^SELECT\b/i.test(cleanSql) && hasUnsupportedSqlTrailingClause(cleanSql, 'select')) {
        return null
    }
    if (/^(?:UPDATE|DELETE)\b/i.test(cleanSql) && hasUnsupportedSqlTrailingClause(cleanSql, 'mutation')) {
        return null
    }
    return cleanSql
}

function extractTopLevelWhereId(whereClause: string): number | undefined {
    for (const rawClause of splitTopLevelSqlAndClauses(whereClause)) {
        const match = CLAUSE_ID_REGEX.exec(stripBalancedOuterParens(rawClause))
        if (match?.[1] !== undefined) return parsePositiveProjectNumber(match[1])
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
    return match?.[1] !== undefined ? parseCanonicalPositiveInt(match[1]) : undefined
}

function specialWhereAllowedCols(table: string): readonly string[] {
    if (
        table === 'projects' ||
        table === 'project_registry' ||
        table === 'team_members' ||
        table === 'members'
    ) {
        return []
    }
    if (table === 'relationships' || table === 'entry_relationships' || table === 'links') {
        return ['workspace_id', 'project_number', 'project_id', 'id', 'entry_id']
    }
    return ['workspace_id', 'project_number', 'project_id']
}

function isValidSpecialWhereRhs(col: string, rhs: string): boolean {
    if (col === 'workspace_id') {
        const val = unquoteSqlString(rhs)
        return val !== null && val.trim() !== ''
    }
    const raw = (unquoteSqlString(rhs) ?? rhs).trim()
    return parseCanonicalPositiveInt(raw) !== undefined
}

function hasUnsupportedSpecialTableWhere(sqlWhere: string, allowedCols: readonly string[]): boolean {
    const clauses = splitTopLevelSqlAndClauses(sqlWhere)
    if (clauses.length === 0) return false
    const allowedSet = new Set(allowedCols.map((c) => c.toLowerCase()))
    const seenCols = new Set<string>()
    for (const rawClause of clauses) {
        const clause = stripBalancedOuterParens(rawClause)
        if (clause === '') return true
        const match =
            /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z_][\w]*)[`"']?\s*=\s*('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\d+)$/i.exec(
                clause
            )
        if (match?.[1] === undefined || match[2] === undefined) return true
        const col = match[1].toLowerCase()
        const canonicalCol =
            col === 'id' || col === 'entry_id'
                ? 'id'
                : col === 'project_number' || col === 'project_id'
                  ? 'project_number'
                  : col
        if (!allowedSet.has(col) || seenCols.has(canonicalCol) || !isValidSpecialWhereRhs(col, match[2])) {
            return true
        }
        seenCols.add(canonicalCol)
    }
    return false
}

function recoverSpecialTableSelect(
    cleanSql: string,
    tableName: string,
    whereClause: string,
    idVal: number | undefined,
    limitVal: number | undefined,
    scopeFields: Record<string, unknown>
): string | null {
    if (!/^SELECT\b/i.test(cleanSql)) return null
    if (hasUnsupportedSpecialTableWhere(whereClause, specialWhereAllowedCols(tableName))) {
        return null
    }
    if (tableName === 'relationships' || tableName === 'entry_relationships' || tableName === 'links') {
        const relParams: Record<string, unknown> = idVal !== undefined ? { entry_id: idVal, ...scopeFields } : { ...scopeFields }
        if (limitVal !== undefined) relParams['limit'] = limitVal
        return `return await mj.relationships.visualizeRelationships(${JSON.stringify(relParams)});`
    }
    if (tableName === 'audit_log' || tableName === 'audit' || tableName === 'audit_logs') {
        const auditParams: Record<string, unknown> = limitVal !== undefined ? { ...scopeFields, limit: limitVal } : scopeFields
        return `return await mj.admin.searchAuditLog(${JSON.stringify(auditParams)});`
    }
    if (limitVal !== undefined) return null
    if (tableName === 'tags' || tableName === 'entry_tags' || tableName === 'journal_tags') {
        return `return await mj.core.listTags(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'projects' || tableName === 'project_registry') {
        return `return await mj.admin.listProjects(${JSON.stringify(scopeFields)});`
    }
    if (tableName === 'team_members' || tableName === 'members') {
        return `return await mj.team.teamListMembers(${JSON.stringify(scopeFields)});`
    }
    return `return await mj.team.teamListAuthorAliases(${JSON.stringify(scopeFields)});`
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
    if (
        whereClause === '' ||
        !isSupportedWhereClause(whereClause, {
            allowPlaceholder: false,
            allowSelectContentEquality: true,
        })
    ) {
        return null
    }
    const wherePos = findTopLevelSqlKeyword(cleanSql, 'WHERE')
    const selectHead = (wherePos >= 0 ? cleanSql.slice(0, wherePos) : cleanSql).replace(
        /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"/g,
        "''"
    )
    if (/\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(selectHead)) return null
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

function assignSqlUpdateSetField(
    setFields: Record<string, unknown>,
    col: string,
    rhs: string
): boolean {
    if (col === 'content' || col === 'title' || col === 'entry_type' || col === 'type') {
        const val = unquoteSqlString(rhs)
        if (val === null || val === '') return false
        setFields[col === 'type' ? 'entry_type' : col] = val
        return true
    }
    if (col === 'significance_type') {
        if (/^null$/i.test(rhs)) {
            setFields['significance_type'] = null
            return true
        }
        const val = unquoteSqlString(rhs)
        if (val === null) return false
        setFields['significance_type'] = val
        return true
    }
    if (col === 'workspace_id') {
        const ws = unquoteSqlString(rhs)?.trim()
        if (ws === undefined || ws === '') return false
        setFields['target_workspace_id'] = ws
        return true
    }
    if (col === 'project_number' || col === 'project_id') {
        if (/^null$/i.test(rhs)) {
            setFields['project_number'] = null
            return true
        }
        const cleaned = (unquoteSqlString(rhs) ?? rhs).trim()
        const n = parsePositiveProjectNumber(cleaned)
        if (n === undefined) return false
        setFields['project_number'] = n
        return true
    }
    return false
}

function recoverEntryUpdate(
    cleanSql: string,
    updateTable: string | undefined,
    whereClause: string,
    idVal: number | undefined,
    scopeFields: Record<string, unknown>
): string | null {
    if (updateTable === undefined || !ENTRY_TABLE_NAMES.has(updateTable) || idVal === undefined) {
        return null
    }
    if (whereClause === '' || !isSupportedWhereClause(whereClause, { allowPlaceholder: false })) {
        return null
    }
    const setClause = extractTopLevelUpdateSetClause(cleanSql)
    const assignments = splitSqlValueList(setClause)
    if (assignments.length === 0) return null
    const setFields: Record<string, unknown> = {}
    for (const assignment of assignments) {
        const eq = assignment.indexOf('=')
        if (eq < 0) return null
        const col = assignment
            .slice(0, eq)
            .trim()
            .replace(/[`"']/g, '')
            .replace(/^[a-zA-Z_][\w]*\./, '')
            .toLowerCase()
        const rhs = assignment.slice(eq + 1).trim()
        if (!assignSqlUpdateSetField(setFields, col, rhs)) return null
    }
    if (Object.keys(setFields).length === 0) return null
    const whereProj =
        typeof scopeFields['project_number'] === 'number' ? scopeFields['project_number'] : undefined
    const hasSetProj = Object.hasOwn(setFields, 'project_number') && setFields['project_number'] !== undefined
    if (hasSetProj && whereProj !== undefined && setFields['project_number'] !== whereProj) {
        return null
    }
    const updatePayload: Record<string, unknown> = {
        entry_id: idVal,
        ...setFields,
        ...scopeFields,
        ...(whereProj !== undefined ? { project_number: whereProj } : {}),
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

    const tableName = extractFromTableName(cleanSql)
    const updateTableMatch = /^UPDATE\s+(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const updateTable = updateTableMatch?.[1]?.toLowerCase()
    const limitVal = extractTopLevelLimit(cleanSql)
    const whereClause = extractTopLevelWhereClause(cleanSql)
    const idVal = extractTopLevelWhereId(whereClause)
    const scopeFields = scopeFromSqlLiterals(cleanSql)

    if (/^SELECT\b/i.test(cleanSql) && tableName !== undefined && SPECIAL_TABLES.has(tableName)) {
        return recoverSpecialTableSelect(cleanSql, tableName, whereClause, idVal, limitVal, scopeFields)
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
        return recoverEntryUpdate(cleanSql, updateTable, whereClause, idVal, scopeFields)
    }
    if (/^DELETE\b/i.test(cleanSql)) {
        if (
            tableName === undefined ||
            !ENTRY_TABLE_NAMES.has(tableName) ||
            idVal === undefined ||
            whereClause === '' ||
            !isSupportedWhereClause(whereClause, { allowPlaceholder: false })
        ) {
            return null
        }
        return `return await mj.admin.deleteEntry(${JSON.stringify({ entry_id: idVal, ...scopeFields })});`
    }
    return null
}

export { extractAndRecoverPreparedStatementCode } from './sql-prepared-recovery.js'
