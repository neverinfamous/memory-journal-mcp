export const ENTRY_TABLE_NAMES = new Set([
    'memory_journal',
    'entries',
    'journal',
    'journal_entries',
    'memories',
])

const SQL_LITERAL_PATTERN = /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"/g

function advanceQuotedChar(sql: string, i: number, quote: string): { nextIndex: number; closed: boolean } {
    const ch = sql[i] ?? ''
    if (ch === '\\' && i + 1 < sql.length) {
        return { nextIndex: i + 1, closed: false }
    }
    if (ch === quote) {
        if (sql[i + 1] === quote) {
            return { nextIndex: i + 1, closed: false }
        }
        return { nextIndex: i, closed: true }
    }
    return { nextIndex: i, closed: false }
}

function unquoteSqlLiteral(raw: string): string {
    if (raw.length < 2) return raw
    const quote = raw[0] ?? ''
    const inner = raw.slice(1, -1)
    const doubled = quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/""/g, '"')
    return doubled.replace(/\\(['"\\])/g, '$1')
}

export function stripBalancedOuterParens(raw: string): string {
    let current = raw.trim()
    while (current.startsWith('(') && current.endsWith(')')) {
        let quote: string | null = null
        let depth = 0
        let balancedOuter = true
        for (let i = 0; i < current.length; i++) {
            const ch = current[i] ?? ''
            if (quote !== null) {
                const step = advanceQuotedChar(current, i, quote)
                i = step.nextIndex
                if (step.closed) quote = null
                continue
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                quote = ch
            } else if (ch === '(') {
                depth++
            } else if (ch === ')') {
                depth--
                if (depth === 0 && i < current.length - 1) {
                    balancedOuter = false
                    break
                }
            }
        }
        if (!balancedOuter || depth !== 0) break
        current = current.slice(1, -1).trim()
    }
    return current
}

export function findTopLevelSqlKeyword(
    sql: string,
    keyword: 'WHERE' | 'SET' | 'LIMIT' | 'ORDER' | 'VALUES',
    startIndex = 0
): number {
    let quote: string | null = null
    let depth = 0
    for (let i = startIndex; i < sql.length; i++) {
        const ch = sql[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(sql, i, quote)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
        } else if (ch === '(') {
            depth++
        } else if (ch === ')') {
            if (depth > 0) depth--
        } else if (depth === 0) {
            const prev = i > 0 ? (sql[i - 1] ?? '') : ''
            const next = sql[i + keyword.length] ?? ''
            if (
                (i === 0 || !/[A-Za-z0-9_$]/.test(prev)) &&
                sql.slice(i, i + keyword.length).toUpperCase() === keyword &&
                (next === '' || !/[A-Za-z0-9_$]/.test(next)) &&
                (keyword !== 'ORDER' || /^\s+BY\b/i.test(sql.slice(i + 5)))
            ) {
                return i
            }
        }
    }
    return -1
}

export function extractTopLevelWhereClause(cleanSql: string): string {
    const whereIdx = findTopLevelSqlKeyword(cleanSql, 'WHERE')
    if (whereIdx < 0) return ''
    const candidates = [
        findTopLevelSqlKeyword(cleanSql, 'ORDER', whereIdx + 5),
        findTopLevelSqlKeyword(cleanSql, 'LIMIT', whereIdx + 5),
    ].filter((idx) => idx >= 0)
    const endIdx = candidates.length > 0 ? Math.min(...candidates) : cleanSql.length
    return cleanSql.slice(whereIdx, endIdx).replace(/;\s*$/, '').trim()
}

export function extractTopLevelUpdateSetClause(cleanSql: string): string {
    const setIdx = findTopLevelSqlKeyword(cleanSql, 'SET')
    if (setIdx < 0) return ''
    const candidates = [
        findTopLevelSqlKeyword(cleanSql, 'WHERE', setIdx + 3),
        findTopLevelSqlKeyword(cleanSql, 'LIMIT', setIdx + 3),
    ].filter((idx) => idx >= 0)
    const endIdx = candidates.length > 0 ? Math.min(...candidates) : cleanSql.length
    return cleanSql.slice(setIdx + 3, endIdx).replace(/;\s*$/, '').trim()
}

export function splitTopLevelSqlAndClauses(whereClause: string): string[] {
    const body = whereClause.replace(/^\s*WHERE\b/i, '').replace(/;\s*$/, '').trim()
    if (body === '') return []
    const clauses: string[] = []
    let current = ''
    let quote: string | null = null
    let depth = 0
    for (let i = 0; i < body.length; i++) {
        const ch = body[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(body, i, quote)
            current += body.slice(i, step.nextIndex + 1)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
            current += ch
        } else if (ch === '(') {
            depth++
            current += ch
        } else if (ch === ')') {
            if (depth > 0) depth--
            current += ch
        } else if (
            depth === 0 &&
            (i === 0 || !/[A-Za-z0-9_$]/.test(body[i - 1] ?? '')) &&
            body.slice(i, i + 3).toUpperCase() === 'AND' &&
            (i + 3 >= body.length || !/[A-Za-z0-9_$]/.test(body[i + 3] ?? ''))
        ) {
            if (current.trim() !== '') clauses.push(current.trim())
            current = ''
            i += 2
        } else {
            current += ch
        }
    }
    if (current.trim() !== '') clauses.push(current.trim())
    return clauses
}

export function splitSqlValueList(raw: string): string[] {
    const values: string[] = []
    let current = ''
    let quote: string | null = null
    let depth = 0
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(raw, i, quote)
            current += raw.slice(i, step.nextIndex + 1)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            current += ch
        } else if (ch === '(') {
            depth++
            current += ch
        } else if (ch === ')') {
            if (depth > 0) depth--
            current += ch
        } else if (ch === ',' && depth === 0) {
            values.push(current.trim())
            current = ''
        } else {
            current += ch
        }
    }
    if (current.trim() !== '') values.push(current.trim())
    return values
}

export function extractParenGroup(sql: string, openIdx: number): { inner: string; endIdx: number } | null {
    if (sql[openIdx] !== '(') return null
    let quote: string | null = null
    let depth = 0
    for (let i = openIdx; i < sql.length; i++) {
        const ch = sql[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(sql, i, quote)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
        } else if (ch === '(') {
            depth++
        } else if (ch === ')') {
            depth--
            if (depth === 0) return { inner: sql.slice(openIdx + 1, i), endIdx: i }
        }
    }
    return null
}

export function scopeFromInsertLiterals(cleanSql: string): Record<string, unknown> {
    const valuesIdx = findTopLevelSqlKeyword(cleanSql, 'VALUES')
    if (valuesIdx < 0) return {}
    const head = cleanSql.slice(0, valuesIdx)
    const openCols = head.indexOf('(')
    if (openCols < 0) return {}
    const colGroup = extractParenGroup(head, openCols)
    const openVals = cleanSql.indexOf('(', valuesIdx + 6)
    if (colGroup === null || openVals < 0) return {}
    const valGroup = extractParenGroup(cleanSql, openVals)
    if (valGroup === null) return {}
    const trailing = cleanSql.slice(valGroup.endIdx + 1).replace(/;\s*$/, '').trim()
    if (trailing !== '' && !/^RETURNING\b/i.test(trailing)) return {}

    const columns = colGroup.inner
        .split(',')
        .map((column) => column.trim().replace(/[`"']/g, '').toLowerCase())
    const values = splitSqlValueList(valGroup.inner)
    const scope: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
        const rawCol = columns[i]
        const column = rawCol?.replace(/^[a-zA-Z_][\w]*\./, '')
        const raw = values[i]
        if (column === undefined || raw === undefined || raw === '?') continue
        if (
            column === 'workspace_id' &&
            raw.length >= 2 &&
            ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))
        ) {
            const ws = unquoteSqlLiteral(raw).trim()
            if (ws !== '') scope['workspace_id'] = ws
        }
        if (column === 'project_number' || column === 'project_id') {
            const unquoted =
                raw.length >= 2 &&
                ((raw.startsWith("'") && raw.endsWith("'")) ||
                    (raw.startsWith('"') && raw.endsWith('"')))
                    ? unquoteSqlLiteral(raw).trim()
                    : raw.trim()
            if (/^\d+$/.test(unquoted)) scope['project_number'] = Number(unquoted)
        }
    }
    return scope
}

export function hasUnsupportedWherePredicate(cleanSql: string): boolean {
    const whereClause = extractTopLevelWhereClause(cleanSql)
    if (whereClause === '') return false
    const body = whereClause.replace(/^\s*WHERE\b/i, '')
    const strippedWhere = body.replace(SQL_LITERAL_PATTERN, "''")
    return /\b(?:OR|NOT|IS\s+(?:NOT\s+)?NULL|IN\s*\()\b|!=|<>|[<>]/i.test(strippedWhere)
}

export function scopeFromSqlLiterals(cleanSql: string): Record<string, unknown> {
    const whereClause = extractTopLevelWhereClause(cleanSql)
    if (whereClause === '') return {}
    const scope: Record<string, unknown> = {}
    for (const rawClause of splitTopLevelSqlAndClauses(whereClause)) {
        const clause = stripBalancedOuterParens(rawClause)
        const projMatch =
            /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?(?:project_number|project_id)[`"']?\s*=\s*['"]?(\d+)['"]?$/i.exec(
                clause
            )
        if (projMatch?.[1] !== undefined && scope['project_number'] === undefined) {
            scope['project_number'] = parseInt(projMatch[1], 10)
            continue
        }
        const wsMatch =
            /^(?:[`"']?[a-zA-Z_][\w]*[`"']?\.)?[`"']?workspace_id[`"']?\s*=\s*('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*")$/i.exec(
                clause
            )
        if (wsMatch?.[1] !== undefined && scope['workspace_id'] === undefined) {
            const wsVal = unquoteSqlLiteral(wsMatch[1]).trim()
            if (wsVal !== '') scope['workspace_id'] = wsVal
        }
    }
    return scope
}
