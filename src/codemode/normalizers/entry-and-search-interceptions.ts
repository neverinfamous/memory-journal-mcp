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

export function applyEntryAndSearchInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (SEARCH_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        healIncludeArchivedField(obj)

        const isDateRange = ['search_by_date_range', 'searchByDateRange', 'team_search_by_date_range', 'teamSearchByDateRange'].includes(methodName)
        if (isDateRange && ['q', 'query', 'text', 'message', 'description', 'keep', 'path'].some((k) => obj[k] !== undefined)) {
            return validationError(
                `${methodName} does not support search queries. It only searches by date.`,
                'Use team_search (or search_entries) if you want to search by text, or remove the text/query parameters.'
            )
        }

        for (const alias of ['q', 'text', 'message', 'description', 'path', 'keep']) {
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
            const parsed = parseInt(obj['limit'], 10)
            if (!isNaN(parsed)) obj['limit'] = parsed
        }
        if (!['search_entries', 'searchEntries', 'team_search', 'teamSearch'].includes(methodName) && obj['mode'] !== undefined) {
            return validationError(
                `${methodName} does not support the 'mode' parameter.`,
                'Remove the mode parameter or use search_entries instead.'
            )
        }
    }

    if (EXACT_MATCH_SEARCH_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
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
    }

    if (SINGLE_ID_METHODS.has(methodName)) {
        const singleRes = applySingleIdInterception(methodName, args)
        if ('error' in singleRes) return singleRes
        args = singleRes.args
    }

    if (
        (methodName === 'update_entry' || methodName === 'updateEntry') &&
        args.length === 2 &&
        (typeof args[0] === 'number' || typeof args[0] === 'string') &&
        isRecord(args[1])
    ) {
        const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0]
        if (!isNaN(asNum)) args = [{ entry_id: asNum, ...args[1] }]
    }

    return applyBatchAndMutationInterceptions(methodName, args)
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
                return { args }
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
        if (typeof idVal === 'string' && !/^\d+$/.test(idVal.trim())) {
            return validationError(
                `${methodName} requires a numeric entry_id, but received a non-numeric string ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
                'Provide a numeric ID.'
            )
        }
    } else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
        const strArg = typeof args[0] === 'string' ? args[0].trim() : undefined
        const asNum =
            typeof args[0] === 'number'
                ? args[0]
                : strArg !== undefined && /^\d+$/.test(strArg)
                  ? Number(strArg)
                  : NaN
        if (!isNaN(asNum)) {
            args[0] = { entry_id: asNum }
        } else {
            return validationError(
                `${methodName} requires a numeric entry_id, but received a non-numeric string ('${args[0]}'). Journal entries use auto-incrementing integer IDs.`,
                'Provide a numeric ID.'
            )
        }
    }
    return { args }
}
