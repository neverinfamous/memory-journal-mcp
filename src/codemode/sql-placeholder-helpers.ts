/**
 * Quote-aware SQL statement boundary, placeholder scanning, and named/positional
 * record-bind resolution helpers for `sql-positional-binder.ts` (H3 & M10).
 *
 * [BOUNDARY] Worker-thread safe: pure TypeScript/JS helpers with zero host imports.
 */

import { advanceQuotedChar, findTopLevelSqlKeyword } from './sql-literal-scope.js'

export interface Placeholder {
    column: string | undefined
    inWhere: boolean
    namedKey?: string
}

export const COLUMN_BEFORE_PLACEHOLDER = /[`"'[]?([A-Za-z_][\w]*)[`"'\]]?\s*(?:=|==|LIKE)\s*$/i

export function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export function normalizeSqlColumn(raw: string): string {
    const col = raw.trim().replace(/[`"'[\]]/g, '').toLowerCase()
    const dot = col.lastIndexOf('.')
    return dot >= 0 ? col.slice(dot + 1) : col
}

/** Returns `true` if `cleanSql` contains non-whitespace tokens after a top-level `;`. */
export function hasMultipleTopLevelSqlStatements(cleanSql: string): boolean {
    let quote: string | null = null
    let seenSemicolon = false
    for (let i = 0; i < cleanSql.length; i++) {
        const ch = cleanSql[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(cleanSql, i, quote)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            if (seenSemicolon) return true
            quote = ch
            continue
        }
        if (seenSemicolon) {
            if (!/\s/.test(ch)) return true
            continue
        }
        if (ch === ';') seenSemicolon = true
    }
    return false
}

/** Lists every `?` and named placeholder (`:name`/`@name`/`$name`) outside SQL quotes. */
export function listSqlPlaceholders(cleanSql: string): Placeholder[] {
    const result: Placeholder[] = []
    let quote: string | null = null
    const whereIdx = findTopLevelSqlKeyword(cleanSql, 'WHERE')
    for (let i = 0; i < cleanSql.length; i++) {
        const ch = cleanSql[i] ?? ''
        if (quote !== null) {
            const step = advanceQuotedChar(cleanSql, i, quote)
            i = step.nextIndex
            if (step.closed) quote = null
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch
            continue
        }
        const prev = i > 0 ? (cleanSql[i - 1] ?? '') : ''
        if (ch === '?') {
            const match = COLUMN_BEFORE_PLACEHOLDER.exec(cleanSql.slice(Math.max(0, i - 160), i))
            result.push({
                column: match?.[1] !== undefined ? normalizeSqlColumn(match[1]) : undefined,
                inWhere: whereIdx >= 0 && i >= whereIdx,
            })
            continue
        }
        if ((ch === ':' || ch === '@' || ch === '$') && !/[A-Za-z0-9_$]/.test(prev) && /[A-Za-z_]/.test(cleanSql[i + 1] ?? '')) {
            let end = i + 2
            while (end < cleanSql.length && /[\w]/.test(cleanSql[end] ?? '')) end++
            const namedKey = cleanSql.slice(i, end)
            const match = COLUMN_BEFORE_PLACEHOLDER.exec(cleanSql.slice(Math.max(0, i - 160), i))
            result.push({
                column: match?.[1] !== undefined ? normalizeSqlColumn(match[1]) : undefined,
                inWhere: whereIdx >= 0 && i >= whereIdx,
                namedKey,
            })
            i = end - 1
        }
    }
    return result
}

interface RecordEntry {
    id: number
    key: string
    snakeCol: string
    value: unknown
}

export interface SqlRecordBindIndex {
    readonly hasRecords: boolean
    resolveNamed(namedKey: string): RecordEntry | undefined
    resolveColumn(column: string): RecordEntry | undefined
    unconsumedEntries(consumedIds: ReadonlySet<number>): { snakeCol: string; value: unknown }[]
}

const COLUMN_SYNONYMS: Record<string, readonly string[]> = Object.assign(
    Object.create(null) as Record<string, readonly string[]>,
    {
        id: ['id', 'entry_id'],
        entry_id: ['entry_id', 'id'],
        project_number: ['project_number', 'project_id'],
        project_id: ['project_id', 'project_number'],
        entry_type: ['entry_type', 'type'],
        type: ['type', 'entry_type'],
    }
)

export function createSqlRecordBindIndex(args: unknown[]): SqlRecordBindIndex {
    const entries: RecordEntry[] = []
    const byExact = Object.create(null) as Record<string, RecordEntry>
    const byStripped = Object.create(null) as Record<string, RecordEntry>
    const byLower = Object.create(null) as Record<string, RecordEntry>
    const bySnake = Object.create(null) as Record<string, RecordEntry>

    for (const arg of args) {
        if (!isPlainRecord(arg)) continue
        for (const [key, value] of Object.entries(arg)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
            const stripped = key.replace(/^[@:$]/, '')
            const snakeCol = stripped.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).toLowerCase()
            const entry: RecordEntry = { id: entries.length, key, snakeCol, value }
            entries.push(entry)
            byExact[key] = entry
            if (!Object.hasOwn(byStripped, stripped)) byStripped[stripped] = entry
            const lower = stripped.toLowerCase()
            if (!Object.hasOwn(byLower, lower)) byLower[lower] = entry
            if (!Object.hasOwn(bySnake, snakeCol)) bySnake[snakeCol] = entry
        }
    }

    return {
        hasRecords: entries.length > 0,
        resolveNamed(namedKey: string): RecordEntry | undefined {
            if (Object.hasOwn(byExact, namedKey)) return byExact[namedKey]
            const stripped = namedKey.slice(1)
            if (Object.hasOwn(byStripped, stripped)) return byStripped[stripped]
            const lower = stripped.toLowerCase()
            if (Object.hasOwn(byLower, lower)) return byLower[lower]
            const snake = stripped.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).toLowerCase()
            return Object.hasOwn(bySnake, snake) ? bySnake[snake] : undefined
        },
        resolveColumn(column: string): RecordEntry | undefined {
            const candidates = Object.hasOwn(COLUMN_SYNONYMS, column) ? COLUMN_SYNONYMS[column] : [column]
            if (candidates === undefined) return undefined
            for (const c of candidates) {
                if (Object.hasOwn(bySnake, c)) return bySnake[c]
            }
            return undefined
        },
        unconsumedEntries(consumedIds: ReadonlySet<number>): { snakeCol: string; value: unknown }[] {
            const out: { snakeCol: string; value: unknown }[] = []
            for (const entry of entries) {
                if (!consumedIds.has(entry.id)) {
                    out.push({ snakeCol: entry.snakeCol, value: entry.value })
                }
            }
            return out
        },
    }
}
