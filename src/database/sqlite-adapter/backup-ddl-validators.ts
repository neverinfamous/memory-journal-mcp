/**
 * Strict SQLite DDL allowlist validators for incoming backup verification (M1, M2).
 * Separated from `backup-schema-guard.ts` to keep both modules well below 450 lines.
 */

export function scanSqlQuotedSpan(sql: string, start: number, open: string): number {
    const close = open === '[' ? ']' : open
    let i = start + 1
    while (i < sql.length) {
        const c = sql[i] ?? ''
        if (c === close) {
            if (close !== ']' && sql[i + 1] === close) {
                i += 2
                continue
            }
            return i + 1
        }
        i++
    }
    return i
}

export function stripSqlComments(sql: string): string {
    let out = ''
    let i = 0
    while (i < sql.length) {
        const ch = sql[i] ?? ''
        const next = sql[i + 1] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            const end = scanSqlQuotedSpan(sql, i, ch)
            out += sql.slice(i, end)
            i = end
            continue
        }
        if (ch === '-' && next === '-') {
            const nl = sql.indexOf('\n', i + 2)
            i = nl === -1 ? sql.length : nl + 1
            out += ' '
            continue
        }
        if (ch === '/' && next === '*') {
            const end = sql.indexOf('*/', i + 2)
            i = end === -1 ? sql.length : end + 2
            out += ' '
            continue
        }
        out += ch
        i++
    }
    return out
}

function maskQuotedTokens(sql: string): string {
    let out = ''
    let i = 0
    while (i < sql.length) {
        const ch = sql[i] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            i = scanSqlQuotedSpan(sql, i, ch)
            // Keep string literals as whitespace, but replace identifier-quoted spans with a
            // sentinel identifier so quoted function calls (e.g. "zeroblob"(10)) still match.
            out += ch === "'" ? ' ' : ' _QID_ '
            continue
        }
        out += ch
        i++
    }
    return out
}

function findMatchingParen(sql: string, openParenIdx: number): number {
    let depth = 0
    let i = openParenIdx
    while (i < sql.length) {
        const ch = sql[i] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            i = scanSqlQuotedSpan(sql, i, ch)
            continue
        }
        if (ch === '(') depth++
        else if (ch === ')') {
            depth--
            if (depth === 0) return i
        }
        i++
    }
    return -1
}

function splitTopLevelSqlArgs(inner: string): string[] | null {
    const parts: string[] = []
    let depth = 0
    let start = 0
    let i = 0
    while (i < inner.length) {
        const ch = inner[i] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            i = scanSqlQuotedSpan(inner, i, ch)
            continue
        }
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') {
            depth--
            if (depth < 0) return null
        } else if (ch === ',' && depth === 0) {
            parts.push(inner.slice(start, i).trim())
            start = i + 1
        }
        i++
    }
    if (depth !== 0) return null
    parts.push(inner.slice(start).trim())
    return parts.filter((p) => p.length > 0)
}

function extractTrailingParenBody(
    cleanSql: string,
    headerRe: RegExp
): { body: string; tail: string } | null {
    const match = headerRe.exec(cleanSql)
    if (match === null) return null
    const openIdx = match[0].length - 1
    const closeIdx = findMatchingParen(cleanSql, openIdx)
    if (closeIdx === -1) return null
    return {
        body: cleanSql.slice(openIdx + 1, closeIdx),
        tail: cleanSql.slice(closeIdx + 1).trim(),
    }
}

const FTS_CONTENT_PREFIX_RE =
    /^\s*CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`[]?main["`\]]?\.)?["`[]?fts_content["`\]]?\s+USING\s+fts5\s*\(/i
const VEC_EMBEDDINGS_PREFIX_RE =
    /^\s*CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`[]?main["`\]]?\.)?["`[]?vec_embeddings["`\]]?\s+USING\s+vec0\s*\(/i
const SAFE_FTS_TOKENIZER_RE =
    /^tokenize\s*=\s*'(?:porter|unicode61|ascii)(?:\s+(?:porter|unicode61|ascii)){0,2}'$/i

function isValidFtsContentDdl(cleanSql: string): boolean {
    const extracted = extractTrailingParenBody(cleanSql, FTS_CONTENT_PREFIX_RE)
    if (extracted === null || (extracted.tail !== '' && extracted.tail !== ';')) return false
    const args = splitTopLevelSqlArgs(extracted.body)
    if (args === null || args.length < 3) return false

    let hasContentCol = false
    let hasContentTable = false
    let hasContentRowid = false
    for (const arg of args) {
        if (/^["`[]?content["`\]]?$/i.test(arg)) hasContentCol = true
        else if (/^content\s*=\s*(?:'memory_journal'|"memory_journal"|`memory_journal`|\[memory_journal\]|memory_journal)$/i.test(arg)) hasContentTable = true
        else if (/^content_rowid\s*=\s*(?:'id'|"id"|`id`|\[id\]|id)$/i.test(arg)) hasContentRowid = true
        else if (!SAFE_FTS_TOKENIZER_RE.test(arg)) return false
    }
    return hasContentCol && hasContentTable && hasContentRowid
}

function isValidVecEmbeddingsDdl(cleanSql: string): boolean {
    const extracted = extractTrailingParenBody(cleanSql, VEC_EMBEDDINGS_PREFIX_RE)
    if (extracted === null || (extracted.tail !== '' && extracted.tail !== ';')) return false
    const args = splitTopLevelSqlArgs(extracted.body)
    if (args === null || args.length < 2) return false

    let hasEntryId = false
    let hasEmbedding = false
    for (const arg of args) {
        const chunkMatch = /^chunk_size\s*=\s*([1-9]\d{0,4})$/i.exec(arg)
        if (chunkMatch?.[1] !== undefined) {
            const size = Number(chunkMatch[1])
            if (size < 1 || size > 65536) return false
            continue
        }
        if (/^["`[]?entry_id["`\]]?\s+INTEGER\s+PRIMARY\s+KEY$/i.test(arg)) {
            hasEntryId = true
            continue
        }
        const vecMatch = /^["`[]?embedding["`\]]?\s+float\[([1-9]\d{0,3})\]$/i.exec(arg)
        if (vecMatch?.[1] !== undefined) {
            const dims = Number(vecMatch[1])
            if (dims < 1 || dims > 8192) return false
            hasEmbedding = true
            continue
        }
        return false
    }
    return hasEntryId && hasEmbedding
}

/** Validate `fts_content` / `vec_embeddings` virtual-table DDLs against strict option allowlists. */
export function isAllowedBackupVirtualTable(name: string, cleanSql: string): boolean {
    if (name === 'fts_content') return isValidFtsContentDdl(cleanSql)
    if (name === 'vec_embeddings') return isValidVecEmbeddingsDdl(cleanSql)
    return false
}

function extractKeywordParenClauses(cleanSql: string, keyword: string): string[] {
    const bodies: string[] = []
    const kwRe = new RegExp(`\\b${keyword}\\s*\\(`, 'yi')
    let i = 0
    while (i < cleanSql.length) {
        const ch = cleanSql[i] ?? ''
        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            i = scanSqlQuotedSpan(cleanSql, i, ch)
            continue
        }
        kwRe.lastIndex = i
        const m = kwRe.exec(cleanSql)
        if (m?.index !== i) {
            i++
            continue
        }
        const openIdx = cleanSql.indexOf('(', i + keyword.length)
        const closeIdx = findMatchingParen(cleanSql, openIdx)
        if (closeIdx === -1) {
            throw new Error(`Malformed SQLite ${keyword} clause in backup DDL`)
        }
        bodies.push(cleanSql.slice(openIdx + 1, closeIdx))
        i = closeIdx + 1
    }
    return bodies
}

const SAFE_DEFAULT_PAREN_RE =
    /^(?:datetime\s*\(\s*'now'\s*\)|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL|[+-]?\d+(?:\.\d+)?|'(?:''|[^'])*')$/i
const UNSAFE_EXPR_FUNC_RE = /\b(?!(?:IN|NOT|AND|OR|IS|NULL)\b)[A-Za-z_][A-Za-z0-9_]*\s*\(/i

function assertSafeTableDdl(name: string, cleanSql: string, unquoted: string): void {
    if (/\bGENERATED\s+ALWAYS\b/i.test(unquoted) || /\bAS\s*\(/i.test(unquoted)) {
        throw new Error(`Disallowed generated column in backup table: ${name}`)
    }
    for (const defExpr of extractKeywordParenClauses(cleanSql, 'DEFAULT')) {
        if (!SAFE_DEFAULT_PAREN_RE.test(defExpr.trim())) {
            throw new Error(`Disallowed SQLite DEFAULT expression in backup table: ${name}`)
        }
    }
    for (const checkExpr of extractKeywordParenClauses(cleanSql, 'CHECK')) {
        const checkUnquoted = maskQuotedTokens(checkExpr)
        if (/\bSELECT\b/i.test(checkUnquoted) || UNSAFE_EXPR_FUNC_RE.test(checkUnquoted)) {
            throw new Error(`Disallowed SQLite CHECK expression in backup table: ${name}`)
        }
    }
}

const CREATE_INDEX_ON_PREFIX_RE =
    /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:["`[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?|\S+)\.)?(?:["`[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?|\S+)\s+ON\s+(?:["`[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?|\S+)\s*\(/i

function assertSafeIndexDdl(name: string, cleanSql: string): void {
    const extracted = extractTrailingParenBody(cleanSql, CREATE_INDEX_ON_PREFIX_RE)
    if (extracted === null) {
        throw new Error(`Disallowed SQLite index DDL in backup: ${name}`)
    }
    const cols = splitTopLevelSqlArgs(extracted.body)
    if (cols === null || cols.length === 0) {
        throw new Error(`Disallowed SQLite index column list in backup: ${name}`)
    }
    for (const col of cols) {
        const stripped = col.replace(/\s+(?:COLLATE\s+[A-Za-z0-9_]+|ASC|DESC)\s*$/i, '').trim()
        const strippedNoSort = stripped
            .replace(/\s+(?:ASC|DESC)$/i, '')
            .replace(/\s+COLLATE\s+[A-Za-z0-9_]+$/i, '')
            .trim()
        const unquotedCol = maskQuotedTokens(strippedNoSort)
        if (unquotedCol.includes('(') && !/^\s*LOWER\s*\(\s*["`[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?\s*\)\s*$/i.test(strippedNoSort)) {
            throw new Error(`Disallowed SQLite index expression in backup: ${name}`)
        }
    }
    if (extracted.tail !== '' && extracted.tail !== ';') {
        const whereUnquoted = maskQuotedTokens(extracted.tail)
        if (!/^\s*WHERE\b/i.test(whereUnquoted) || /\bSELECT\b/i.test(whereUnquoted) || UNSAFE_EXPR_FUNC_RE.test(whereUnquoted)) {
            throw new Error(`Disallowed SQLite index predicate in backup: ${name}`)
        }
    }
}

/** Reject subqueries, generated columns, expression indexes, and function calls in backup tables/indexes. */
export function assertSafeTableAndIndexDdl(type: string, name: string, cleanSql: string): void {
    const unquoted = maskQuotedTokens(cleanSql)
    if (/\bSELECT\b/i.test(unquoted)) {
        throw new Error(`Disallowed SQLite subquery in backup ${type}: ${name}`)
    }
    if (type === 'table') {
        assertSafeTableDdl(name, cleanSql, unquoted)
        return
    }
    if (type === 'index') {
        assertSafeIndexDdl(name, cleanSql)
    }
}
