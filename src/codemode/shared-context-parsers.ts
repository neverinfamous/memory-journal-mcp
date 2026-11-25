/**
 * Shared zero-dependency context and byte-limit parsers used by both the host Code Mode
 * dispatcher (`sandbox-user-context.ts`) and worker nested execution (`nested-exec-payload.ts`).
 */

function isPlainContextRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Parses positive byte or kilobyte size limits (`1024`, `"64kb"`, `"2mb"`, `"512b"`).
 * Rejects non-finite numbers and unparseable trailing junk instead of truncating with `parseInt`.
 */
export function parseByteSizeValue(
    val: unknown,
    defaultUnit: 'b' | 'kb' = 'b'
): number | undefined {
    const defaultMult = defaultUnit === 'kb' ? 1024 : 1
    if (typeof val === 'number') {
        return Number.isFinite(val) && val > 0 ? Math.round(val * defaultMult) : undefined
    }
    if (typeof val === 'string') {
        const trimmed = val.trim()
        const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|bytes|b)?$/i.exec(trimmed)
        if (match?.[1] !== undefined) {
            const num = Number(match[1])
            if (!Number.isFinite(num) || num <= 0) return undefined
            const unit = (match[2] ?? defaultUnit).toLowerCase()
            if (unit === 'mb') return Math.round(num * 1024 * 1024)
            if (unit === 'kb') return Math.round(num * 1024)
            return Math.round(num)
        }
    }
    return undefined
}

/** Parses stringified `context` payloads, returning structured records for JSON objects. */
export function parseStringContextPayload(raw: string): Record<string, unknown> {
    const trimmed = raw.trim()
    const looksJson =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    if (!looksJson) return { content: raw, text: raw, raw }
    try {
        const parsed: unknown = JSON.parse(trimmed)
        return isPlainContextRecord(parsed) ? parsed : { value: parsed, raw, text: raw, content: raw }
    } catch {
        return { content: raw, text: raw, raw }
    }
}

const OPTIONAL_QUERY_SEARCH_FIELDS = [
    'tags',
    'exclude_tags',
    'mode',
    'entry_type',
    'significance_type',
    'start_date',
    'end_date',
    'sort_by',
    'sort_order',
    'is_personal',
    'offset',
    'use_semantic',
    'cursor',
    'include_team',
    'include_archived',
    'fuzzy_match',
    'auto_correct',
    'min_importance',
    'session_id',
] as const

const QUERY_SEARCH_CAMEL_ALIASES: readonly (readonly [string, string])[] = [
    ['excludeTags', 'exclude_tags'],
    ['entryType', 'entry_type'],
    ['significanceType', 'significance_type'],
    ['startDate', 'start_date'],
    ['endDate', 'end_date'],
    ['sortBy', 'sort_by'],
    ['sortOrder', 'sort_order'],
    ['isPersonal', 'is_personal'],
    ['useSemantic', 'use_semantic'],
    ['includeTeam', 'include_team'],
    ['includeArchived', 'include_archived'],
    ['fuzzyMatch', 'fuzzy_match'],
    ['autoCorrect', 'auto_correct'],
    ['minImportance', 'min_importance'],
    ['sessionId', 'session_id'],
]

/** Forwards supported `searchEntries` filters and explicit `limit` onto a synthesized query payload. */
export function appendOptionalQuerySearchFields(
    searchPayload: Record<string, unknown>,
    source: Record<string, unknown>,
    fallbackLimit?: unknown
): void {
    const rawLimit = source['limit'] !== undefined ? source['limit'] : fallbackLimit
    if (rawLimit !== undefined) {
        searchPayload['limit'] = rawLimit
    }
    for (const key of OPTIONAL_QUERY_SEARCH_FIELDS) {
        if (source[key] !== undefined && searchPayload[key] === undefined) {
            searchPayload[key] = source[key]
        }
    }
    for (const [camelKey, snakeKey] of QUERY_SEARCH_CAMEL_ALIASES) {
        if (source[snakeKey] === undefined && source[camelKey] !== undefined && searchPayload[snakeKey] === undefined) {
            searchPayload[snakeKey] = source[camelKey]
        }
    }
    if (source['use_test_db'] === true || source['useTestDb'] === true) {
        searchPayload['use_test_db'] = true
    }
}

/** Normalizes arbitrary `context` values into a mutable plain record wrapper. */
export function normalizeUserContextPayload(context: unknown): Record<string, unknown> {
    if (context === undefined || context === null) return {}
    if (isPlainContextRecord(context)) return { ...context }
    if (typeof context === 'string') return parseStringContextPayload(context)
    return { value: context, raw: context }
}
