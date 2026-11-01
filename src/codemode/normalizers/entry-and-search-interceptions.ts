import { isRecord, healSessionSummaryContent } from './shared-utils.js'

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

const CREATE_METHODS = new Set([
    'create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry',
    'add_entry', 'addEntry', 'mj_add_entry', 'mjAddEntry',
    'create_journal_entry', 'createJournalEntry', 'insert_entry', 'insertEntry',
])

const SESSION_SUMMARY_METHODS = new Set([
    'create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry',
    'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry',
])

function validationError(error: string, suggestion: string): { error: Record<string, unknown> } {
    return {
        error: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion,
            recoverable: true,
        },
    }
}

export function applyEntryAndSearchInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (SEARCH_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj

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
                const label = methodName.includes('date') ? 'Cross-project team date range searches' : 'Cross-project team searches'
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
        if (typeof idVal === 'string' && isNaN(parseInt(idVal, 10))) {
            return validationError(
                `${methodName} requires a numeric entry_id, but received a non-numeric string ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
                'Provide a numeric ID.'
            )
        }
    } else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
        const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0]
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

function applyBatchAndMutationInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (['batch_create_entries', 'batchCreateEntries', 'team_batch_create_entries', 'teamBatchCreateEntries'].includes(methodName) && args.length === 1) {
        if (Array.isArray(args[0])) args[0] = { entries: args[0] }
        else if (isRecord(args[0]) && !('entries' in args[0])) {
            return validationError(`${methodName} requires an 'entries' array.`, 'Provide { entries: [...] } as the argument')
        }
    }

    if (['batch_update_entries', 'batchUpdateEntries', 'team_batch_update_entries', 'teamBatchUpdateEntries'].includes(methodName) && args.length === 1) {
        if (Array.isArray(args[0])) args[0] = { updates: args[0] }
        else if (isRecord(args[0]) && !('updates' in args[0])) {
            return validationError(`${methodName} requires an 'updates' array.`, 'Provide { updates: [...] } as the argument')
        }
    }

    if (['batch_delete_entries', 'batchDeleteEntries', 'team_batch_delete_entries', 'teamBatchDeleteEntries'].includes(methodName)) {
        if (args.length === 1 && typeof args[0] === 'string') {
            args[0] = { entry_ids: args[0].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)) }
        } else if (args.length === 1 && Array.isArray(args[0])) {
            if (args[0].some((id) => typeof id === 'string')) {
                return validationError(
                    'batch_delete_entries expects an array of numeric IDs, but received an array containing strings.',
                    'Ensure all IDs in the array are numbers. Use parseInt() if necessary.'
                )
            }
            args[0] = { entry_ids: args[0] }
        } else if (args.length > 1 && args.every((a) => typeof a === 'number')) {
            args = [{ entry_ids: args }]
        } else if (args.length === 1 && isRecord(args[0]) && !('entry_ids' in args[0])) {
            return validationError(`${methodName} requires an 'entry_ids' array.`, 'Provide { entry_ids: [...] } as the argument')
        }
    }

    if (['update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['keep'] !== undefined && obj['is_archived'] === undefined) {
            obj['is_archived'] = obj['keep'] === false || obj['keep'] === 0 || obj['keep'] === ''
            delete obj['keep']
        }
        for (const alias of ['text', 'message', 'description']) {
            if (obj[alias] !== undefined && obj['content'] === undefined) {
                obj['content'] = obj[alias]
                Reflect.deleteProperty(obj, alias)
            }
        }
        if (['q', 'query', 'path', 'mode', 'search'].some((k) => obj[k] !== undefined)) {
            return validationError(
                `${methodName} does not support q, query, search, path, or mode parameters.`,
                'Remove these parameters. Use entry_id and content to update the entry.'
            )
        }
    }

    if (['delete_entry', 'deleteEntry', 'team_delete_entry', 'teamDeleteEntry'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['version'] !== undefined && obj['expected_version'] === undefined) {
            obj['expected_version'] = obj['version']
            delete obj['version']
        }
        if ((methodName === 'delete_entry' || methodName === 'deleteEntry') && obj['project_number'] !== undefined) {
            delete obj['project_number']
        }
    }

    if (CREATE_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (isRecord(obj['entry'])) {
            const nested = obj['entry']
            delete obj['entry']
            for (const [k, v] of Object.entries(nested)) {
                if (obj[k] === undefined && v !== undefined) obj[k] = v
            }
        }
        for (const aliasKey of [
            'entry', 'text', 'message', 'description', 'body', 'instructions', 'details',
            'notes', 'summary', 'markdown', 'post', 'journal_entry', 'journalEntry', 'entry_text', 'entryText',
        ]) {
            if (obj[aliasKey] !== undefined) {
                if (obj['content'] === undefined && typeof obj[aliasKey] === 'string') obj['content'] = obj[aliasKey]
                Reflect.deleteProperty(obj, aliasKey)
            }
        }
        if (obj['auto_context'] !== undefined) {
            if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
                try {
                    obj['auto_context'] = JSON.stringify(obj['auto_context'])
                } catch {
                    return validationError(
                        `${methodName}: auto_context could not be serialized to JSON. Ensure it is a plain object (e.g. { commits: ['<sha>'] }) or a valid JSON string.`,
                        'Pass auto_context as either a JSON string (e.g. JSON.stringify({ commits: [sha] })) or a plain serializable object.'
                    )
                }
            } else if (typeof obj['auto_context'] !== 'string') {
                return validationError(
                    `${methodName}: auto_context must be a JSON string or plain object (received ${typeof obj['auto_context']}).`,
                    'Pass auto_context as a JSON string, e.g. JSON.stringify({ commits: ["<sha>"] }), or as a plain object like { commits: ["<sha>"] }.'
                )
            }
        }
        if (['q', 'query', 'path', 'mode', 'keep', 'search'].some((k) => obj[k] !== undefined)) {
            return validationError(
                `${methodName} does not support q, query, search, path, mode, or keep parameters. It creates a new journal entry.`,
                'Remove these parameters. Ensure you are providing the "content" of the entry.'
            )
        }
    }

    if (SESSION_SUMMARY_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        const tags = Array.isArray(obj['tags']) ? obj['tags'] : undefined
        const entryType = typeof obj['entry_type'] === 'string' ? obj['entry_type'] : undefined
        if (typeof obj['content'] === 'string' && (tags?.includes('session-summary') || entryType === 'retrospective')) {
            obj['content'] = healSessionSummaryContent(obj['content'], { normalizeSynonyms: true, usePeriodOnNone: false })
        }
    }

    return { args }
}
