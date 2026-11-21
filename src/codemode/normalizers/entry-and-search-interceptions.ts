import { healIncludeArchivedField } from '../../handlers/tools/schemas/hallucination-healer-fields.js'
import { isRecord } from './shared-utils.js'
import {
    applyBatchAndMutationInterceptions,
    batchValidationError as validationError,
} from './batch-mutation-interceptions.js'

const SEARCH_METHODS = new Set([
    'search_entries', 'searchEntries', 'team_search', 'teamSearch',
    'search_by_date_range', 'searchByDateRange', 'team_search_by_date_range', 'teamSearchByDateRange',
    'semantic_search', 'semanticSearch', 'team_semantic_search', 'teamSemanticSearch',
    'cross_team_search', 'crossTeamSearch',
])

const EXACT_MATCH_SEARCH_METHODS = new Set([
    'search_entries', 'searchEntries', 'team_search', 'teamSearch',
    'search_by_date_range', 'searchByDateRange', 'team_search_by_date_range', 'teamSearchByDateRange',
    'cross_team_search', 'crossTeamSearch',
])

const SINGLE_ID_METHODS = new Set([
    'delete_entry', 'deleteEntry', 'restore_entry', 'restoreEntry',
    'get_entry_by_id', 'getEntryById', 'team_get_entry_by_id', 'teamGetEntryById',
    'get_entry_history', 'getEntryHistory', 'add_to_vector_index', 'addToVectorIndex',
    'team_add_to_vector_index', 'teamAddToVectorIndex', 'add_to_index', 'addToIndex',
    'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry', 'edit', 'update',
    'team_delete_entry', 'teamDeleteEntry', 'delete', 'team_restore_entry', 'teamRestoreEntry',
    'restore', 'team_restore', 'teamRestore',
])

const DATE_RANGE_METHODS = new Set([
    'search_by_date_range', 'searchByDateRange', 'team_search_by_date_range', 'teamSearchByDateRange',
])
const SEARCH_MODE_METHODS = new Set(['search_entries', 'searchEntries', 'team_search', 'teamSearch'])
const DATE_RANGE_FORBIDDEN_KEYS = ['q', 'query', 'text', 'message', 'description', 'keep', 'path'] as const
const SEARCH_QUERY_ALIAS_KEYS = ['q', 'text', 'message', 'description', 'path', 'keep'] as const
const POSITIVE_INT_STR_RE = /^[1-9]\d*$/

function applySearchQueryInterception(
    methodName: string,
    obj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    healIncludeArchivedField(obj)

    const isDateRange = DATE_RANGE_METHODS.has(methodName)
    if (isDateRange && DATE_RANGE_FORBIDDEN_KEYS.some((k) => obj[k] !== undefined)) {
        return validationError(
            `${methodName} does not support search queries. It only searches by date.`,
            'Use team_search (or search_entries) if you want to search by text, or remove the text/query parameters.'
        )
    }

    for (const alias of SEARCH_QUERY_ALIAS_KEYS) {
        if (obj[alias] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj[alias]
            Reflect.deleteProperty(obj, alias)
        }
    }
    if (obj['start'] !== undefined && obj['start_date'] === undefined) {
        obj['start_date'] = obj['start']
        delete obj['start']
    }
    if (obj['end'] !== undefined && obj['end_date'] === undefined) {
        obj['end_date'] = obj['end']
        delete obj['end']
    }
    if (typeof obj['limit'] === 'string') {
        const trimmed = obj['limit'].trim()
        if (POSITIVE_INT_STR_RE.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) obj['limit'] = parsed
        }
    }
    if (
        (methodName === 'team_search' || methodName === 'teamSearch') &&
        (obj['mode'] === 'fts' || obj['mode'] === 'auto')
    ) {
        delete obj['mode']
    }
    if (!SEARCH_MODE_METHODS.has(methodName) && obj['mode'] !== undefined) {
        return validationError(
            `${methodName} does not support the 'mode' parameter.`,
            'Remove the mode parameter or use search_entries instead.'
        )
    }
    return { obj }
}

function applyExactMatchSearchInterception(
    methodName: string,
    obj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    if ('exact_match' in obj) {
        const isFuzzy = obj['exact_match'] === false
        obj['fuzzy_match'] = isFuzzy
        if (methodName !== 'cross_team_search' && methodName !== 'crossTeamSearch') obj['auto_correct'] = isFuzzy
        delete obj['exact_match']
    } else if (obj['fuzzy_match'] === true && !('auto_correct' in obj)) {
        if (methodName !== 'cross_team_search' && methodName !== 'crossTeamSearch') obj['auto_correct'] = true
    }

    if (typeof obj['start_date'] === 'string' && (obj['end_date'] === undefined || obj['end_date'] === null || obj['end_date'] === '')) {
        obj['end_date'] = new Date().toISOString().split('T')[0]
    }

    if (
        (methodName === 'team_search' || methodName === 'teamSearch' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') &&
        obj['project_number'] == null
    ) {
        const tags = Array.isArray(obj['tags']) ? obj['tags'] : undefined
        const entryType = typeof obj['entry_type'] === 'string' ? obj['entry_type'] : undefined
        const isFlagSearch = Boolean(tags && tags.length > 0 && tags.every((t) => typeof t === 'string' && t.startsWith('flag:'))) || entryType === 'flag'
        if (!isFlagSearch) {
            const label =
                methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange'
                    ? 'Cross-project team date range searches'
                    : 'Cross-project team searches'
            return validationError(
                `${label} are only permitted for flags. Provide a project_number or filter by entry_type="flag" or flag:* tags.`,
                'Provide a project_number, or use tags starting with "flag:" or entry_type="flag"'
            )
        }
    }
    return { obj }
}

function normalizeTwoArgUpdateEntry(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (
        (methodName === 'update_entry' || methodName === 'updateEntry') &&
        args.length === 2 &&
        (typeof args[0] === 'number' || typeof args[0] === 'string') &&
        isRecord(args[1])
    ) {
        if (typeof args[0] === 'string') {
            const trimmed = args[0].trim()
            const digits = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
            if (!/^[1-9]\d*$/.test(digits)) {
                return validationError(
                    `${methodName} requires a numeric entry_id, but received a non-numeric string ('${args[0]}'). Journal entries use auto-incrementing integer IDs.`,
                    'Provide a positive integer ID.'
                )
            }
            const parsed = Number(digits)
            if (!Number.isSafeInteger(parsed) || String(parsed) !== digits) {
                return validationError(
                    `${methodName} received an out-of-range entry_id ('${args[0]}').`,
                    'Provide a safe positive integer ID.'
                )
            }
            return { args: [{ entry_id: parsed, ...args[1] }] }
        }
        if (Number.isSafeInteger(args[0]) && args[0] > 0) {
            return { args: [{ entry_id: args[0], ...args[1] }] }
        }
        return validationError(
            `${methodName} requires a finite safe integer entry_id.`,
            'Provide a positive integer ID.'
        )
    }
    return { args }
}

export function applyEntryAndSearchInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (SEARCH_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const searchRes = applySearchQueryInterception(methodName, { ...args[0] })
        if ('error' in searchRes) return searchRes
        args[0] = searchRes.obj
    }

    if (EXACT_MATCH_SEARCH_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const exactRes = applyExactMatchSearchInterception(methodName, { ...args[0] })
        if ('error' in exactRes) return exactRes
        args[0] = exactRes.obj
    }

    if (SINGLE_ID_METHODS.has(methodName)) {
        const singleRes = applySingleIdInterception(methodName, args)
        if ('error' in singleRes) return singleRes
        args = singleRes.args
    }

    const twoArgRes = normalizeTwoArgUpdateEntry(methodName, args)
    if ('error' in twoArgRes) return twoArgRes

    return applyBatchAndMutationInterceptions(methodName, twoArgRes.args)
}

function interceptRecordSingleId(
    methodName: string,
    obj: Record<string, unknown>
): { error: Record<string, unknown> } | undefined {
    if (['ids', 'entry_ids', 'entry_id', 'id'].some((k) => Array.isArray(obj[k]))) {
        return validationError(
            `${methodName} only accepts a single entry_id. To process multiple entries, use the batch equivalent.`,
            'Use a batch method (e.g. batch_delete_entries) or pass { entry_id: number }'
        )
    }
    const idVal = obj['entry_id'] ?? obj['entryId'] ?? obj['id'] ?? obj['path'] ?? obj['keep']
    if (idVal === undefined) {
        if (
            (methodName === 'get_entry_by_id' || methodName === 'getEntryById') &&
            typeof obj['uri'] === 'string' &&
            obj['uri'].trim().startsWith('memory://')
        ) {
            return undefined
        }
        return validationError(`${methodName} requires an 'entry_id' parameter.`, 'Provide { entry_id: number, ... } as the argument')
    }
    for (const k of ['path', 'keep']) {
        if (obj[k] !== undefined && obj['entry_id'] === undefined) {
            obj['entry_id'] = obj[k]
            Reflect.deleteProperty(obj, k)
        }
    }
    if (
        ['q', 'query', 'mode', 'search'].some((k) => obj[k] !== undefined) &&
        !['update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry'].includes(methodName)
    ) {
        return validationError(
            `${methodName} does not support q, query, search, or mode parameters. It operates on a single entry by entry_id.`,
            'Remove these parameters. Provide only the entry_id.'
        )
    }
    if (typeof idVal === 'string') {
        const trimmedId = idVal.trim()
        const parsedId = /^[1-9]\d*$/.test(trimmedId) ? Number(trimmedId) : Number.NaN
        if (!Number.isSafeInteger(parsedId) || String(parsedId) !== trimmedId) {
            return validationError(
                `${methodName} requires a numeric entry_id, but received a non-numeric or unsafe ID ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
                'Provide a canonical positive integer ID.'
            )
        }
    }
    return undefined
}

function interceptPrimitiveSingleId(
    methodName: string,
    raw: number | string
): { entry_id: number } | { error: Record<string, unknown> } {
    const strArg = typeof raw === 'string' ? raw.trim() : undefined
    const parsedArg =
        typeof raw === 'number'
            ? raw
            : strArg !== undefined && /^[1-9]\d*$/.test(strArg)
              ? Number(strArg)
              : Number.NaN
    if (
        Number.isSafeInteger(parsedArg) &&
        parsedArg > 0 &&
        (strArg === undefined || String(parsedArg) === strArg)
    ) {
        return { entry_id: parsedArg }
    }
    return validationError(
        `${methodName} requires a numeric entry_id, but received an invalid ID ('${String(raw)}'). Journal entries use auto-incrementing integer IDs.`,
        'Provide a canonical positive integer ID.'
    )
}

function applySingleIdInterception(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (args.length === 0) {
        return validationError(`${methodName} requires an 'entry_id' parameter.`, 'Provide { entry_id: number } as the argument')
    }
    if (args.length !== 1) return { args }

    if (Array.isArray(args[0])) {
        return validationError(
            `${methodName} only accepts a single entry. To process multiple entries, use the batch equivalent (e.g., batch_delete_entries).`,
            'Use a batch method or pass a single object like { entry_id: number }'
        )
    }
    if (isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        const recordErr = interceptRecordSingleId(methodName, obj)
        if (recordErr !== undefined) return recordErr
    } else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
        const coerced = interceptPrimitiveSingleId(methodName, args[0])
        if ('error' in coerced) return coerced
        args[0] = coerced
    }
    return { args }
}
