import { isRecord, healSessionSummaryContent } from './shared-utils.js'

const CREATE_METHODS = new Set([
    'create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry',
    'add_entry', 'addEntry', 'mj_add_entry', 'mjAddEntry',
    'create_journal_entry', 'createJournalEntry', 'insert_entry', 'insertEntry',
])

const SESSION_SUMMARY_METHODS = new Set([
    'create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry',
    'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry',
])

export function batchValidationError(
    error: string,
    suggestion: string
): { error: Record<string, unknown> } {
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

function parseNumericBatchId(val: unknown): number | undefined {
    if (typeof val === 'number' && Number.isInteger(val) && val > 0) return val
    if (typeof val === 'string') {
        const trimmed = val.trim()
        if (/^#?[1-9]\d*$/.test(trimmed)) return parseInt(trimmed.replace(/^#/, ''), 10)
    }
    return undefined
}

function normalizeBatchCreateAndUpdateArgs(
    methodName: string,
    args: unknown[]
): { error: Record<string, unknown> } | undefined {
    if (
        ['batch_create_entries', 'batchCreateEntries', 'team_batch_create_entries', 'teamBatchCreateEntries'].includes(methodName) &&
        args.length === 1
    ) {
        if (Array.isArray(args[0])) args[0] = { entries: args[0] }
        else if (isRecord(args[0]) && !('entries' in args[0])) {
            if (!Array.isArray(args[0]['items'])) {
                return batchValidationError(`${methodName} requires an 'entries' array.`, 'Provide { entries: [...] } as the argument')
            }
            const obj = { ...args[0], entries: args[0]['items'] }
            Reflect.deleteProperty(obj, 'items')
            args[0] = obj
        }
    }

    if (
        ['batch_update_entries', 'batchUpdateEntries', 'team_batch_update_entries', 'teamBatchUpdateEntries'].includes(methodName) &&
        args.length === 1
    ) {
        if (Array.isArray(args[0])) args[0] = { updates: args[0] }
        else if (isRecord(args[0]) && !('updates' in args[0])) {
            const aliasKey = Array.isArray(args[0]['items'])
                ? 'items'
                : Array.isArray(args[0]['entries'])
                  ? 'entries'
                  : undefined
            if (aliasKey === undefined) {
                return batchValidationError(`${methodName} requires an 'updates' array.`, 'Provide { updates: [...] } as the argument')
            }
            const obj = { ...args[0], updates: args[0][aliasKey] }
            Reflect.deleteProperty(obj, aliasKey)
            args[0] = obj
        }
    }
    return undefined
}

function normalizeBatchDeleteArgs(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (!['batch_delete_entries', 'batchDeleteEntries', 'team_batch_delete_entries', 'teamBatchDeleteEntries'].includes(methodName)) {
        return { args }
    }
    const multiCoerced = args.length > 1 ? args.map(parseNumericBatchId) : []
    if (args.length === 1 && typeof args[0] === 'string') {
        const tokens = args[0]
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        const validIds = tokens
            .map(parseNumericBatchId)
            .filter((n): n is number => n !== undefined)
        if (tokens.length === 0 || validIds.length !== tokens.length) {
            return batchValidationError(
                `${methodName} expects positive integer entry IDs, but received invalid value ('${args[0]}').`,
                'Provide comma-separated positive integer IDs (e.g., "1, 2, 3") or { entry_ids: [1, 2, 3] }.'
            )
        }
        args[0] = { entry_ids: validIds }
    } else if (args.length === 1 && Array.isArray(args[0])) {
        const coerced = args[0].map(parseNumericBatchId)
        const validIds = coerced.filter((n): n is number => n !== undefined)
        if (validIds.length !== coerced.length) {
            return batchValidationError(
                'batch_delete_entries expects an array of numeric IDs, but received non-numeric values.',
                'Ensure all IDs in the array are numbers or numeric strings.'
            )
        }
        args[0] = { entry_ids: validIds }
    } else if (args.length > 1 && multiCoerced.every((n): n is number => n !== undefined)) {
        args = [{ entry_ids: multiCoerced }]
    } else if (args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        if (!('entry_ids' in obj)) {
            const aliasKey = (['ids', 'id', 'items', 'entries'] as const).find((k) => k in obj)
            if (aliasKey === undefined) {
                return batchValidationError(`${methodName} requires an 'entry_ids' array.`, 'Provide { entry_ids: [...] } as the argument')
            }
            const raw = obj[aliasKey]
            obj['entry_ids'] = Array.isArray(raw) ? raw : [raw]
            Reflect.deleteProperty(obj, aliasKey)
        }
        if (Array.isArray(obj['entry_ids'])) {
            obj['entry_ids'] = (obj['entry_ids'] as unknown[]).map(
                (item: unknown): unknown => parseNumericBatchId(item) ?? item
            )
        }
        args[0] = obj
    }
    return { args }
}

function normalizeUpdateAndDeleteEntryArgs(
    methodName: string,
    args: unknown[]
): { error: Record<string, unknown> } | undefined {
    if (['update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['version'] !== undefined && obj['expected_version'] === undefined) {
            obj['expected_version'] = obj['version']
            delete obj['version']
        }
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
            return batchValidationError(
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
    }
    return undefined
}

function normalizeCreateAndSummaryArgs(
    methodName: string,
    args: unknown[]
): { error: Record<string, unknown> } | undefined {
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
                    return batchValidationError(
                        `${methodName}: auto_context could not be serialized to JSON. Ensure it is a plain object (e.g. { commits: ['<sha>'] }) or a valid JSON string.`,
                        'Pass auto_context as either a JSON string (e.g. JSON.stringify({ commits: [sha] })) or a plain serializable object.'
                    )
                }
            } else if (typeof obj['auto_context'] !== 'string') {
                return batchValidationError(
                    `${methodName}: auto_context must be a JSON string or plain object (received ${typeof obj['auto_context']}).`,
                    'Pass auto_context as a JSON string, e.g. JSON.stringify({ commits: ["<sha>"] }), or as a plain object like { commits: ["<sha>"] }.'
                )
            }
        }
        if (['q', 'query', 'path', 'mode', 'keep', 'search'].some((k) => obj[k] !== undefined)) {
            return batchValidationError(
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
    return undefined
}

export function applyBatchAndMutationInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    const batchCreateUpdateErr = normalizeBatchCreateAndUpdateArgs(methodName, args)
    if (batchCreateUpdateErr !== undefined) return batchCreateUpdateErr

    const deleteResult = normalizeBatchDeleteArgs(methodName, args)
    if ('error' in deleteResult) return deleteResult
    args = deleteResult.args

    const updateDeleteErr = normalizeUpdateAndDeleteEntryArgs(methodName, args)
    if (updateDeleteErr !== undefined) return updateDeleteErr

    const createSummaryErr = normalizeCreateAndSummaryArgs(methodName, args)
    if (createSummaryErr !== undefined) return createSummaryErr

    return { args }
}
