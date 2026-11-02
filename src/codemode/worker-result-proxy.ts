/**
 * Worker Result Proxy — wraps API call results with smart proxy behavior.
 *
 * - Failed results throw on property access with actionable error messages
 * - Successful results auto-forward Array methods to nested array properties
 * - Pagination cursor detection injects `hasMore` convenience boolean
 */

const RESULT_COLLECTION_KEYS: readonly string[] = [
    'entries', 'results', 'projects', 'items', 'rows', 'tables',
    'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records',
    'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns',
    'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound',
    'history', 'relationships', 'members', 'data',
]

const ITERATOR_COLLECTION_KEYS: readonly string[] = [
    'entries', 'results', 'projects', 'items', 'issues', 'pullRequests',
    'milestones', 'columns', 'comments', 'files', 'errors', 'backups',
    'deleted', 'updated', 'notFound', 'history', 'relationships', 'members',
]

const FAILED_ARRAY_METHODS: readonly string[] = [
    'find', 'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every',
    'flatMap', 'includes', 'indexOf', 'findIndex', 'findLast', 'findLastIndex', 'join',
    'at', 'concat', 'flat', 'with', 'slice',
]

const SUCCESS_ARRAY_METHODS: readonly string[] = [
    ...FAILED_ARRAY_METHODS, 'keys', 'values', 'entries',
]

const MUTATOR_ARRAY_METHODS: readonly string[] = [
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill',
]

const ARRAY_SELF_ALIASES: readonly string[] = [
    'projects', 'entries', 'results', 'items', 'data', 'rows',
    'relationships', 'members', 'tags', 'history', 'records',
]

const RESULT_LIST_ALIASES: readonly string[] = [
    'data', 'items', 'entries', 'results', 'rows', 'dataArray', 'projects', 'list', 'records',
]

const isObject = (val: unknown): val is Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)

const hasNumberId = (val: unknown): val is { id: number } =>
    isObject(val) && typeof val['id'] === 'number'

const isDictLike = (obj: Record<string, unknown>): boolean => {
    const keys = Object.keys(obj).filter((k) => typeof k === 'string' && !k.startsWith('_'))
    return keys.length > 0 && !keys.includes('error') && !keys.includes('success')
}

const dictToItems = (obj: Record<string, unknown>): unknown[] =>
    Object.entries(obj)
        .filter(([k]) => typeof k === 'string' && !k.startsWith('_'))
        .map(([key, item]) => {
            if (isObject(item)) {
                const name = typeof item['name'] === 'string' && item['name'].length > 0 ? item['name'] : key
                const desc = typeof item['description'] === 'string' ? item['description'] : ''
                const projNum = item['project_number'] ?? item['id'] ?? item['projectNumber']
                return { ...item, name, description: desc, project_number: projNum, projectNumber: projNum }
            }
            return { name: key, description: '', value: item }
        })

function findPrimaryArrayKey(
    targetRecord: Record<string, unknown>,
    keysToCheck: readonly string[] = RESULT_COLLECTION_KEYS
): string | undefined {
    const arrayKeys = Object.keys(targetRecord).filter((k) => Array.isArray(targetRecord[k]))
    const matched = arrayKeys.find((k) => keysToCheck.includes(k))
    if (matched !== undefined) return matched
    return arrayKeys.length === 1 ? arrayKeys[0] : undefined
}

function bindArrayMethod(arr: unknown[], prop: string): ((...args: unknown[]) => unknown) | undefined {
    const method: unknown = Reflect.get(arr, prop)
    if (typeof method === 'function') {
        return (...args: unknown[]) => (method as (...a: unknown[]) => unknown).apply(arr, args)
    }
    return undefined
}

/**
 * Wrap an API result with smart proxy behavior for improved DX.
 */
export function wrapResult(result: unknown): unknown {
    if (result === null || result === undefined || typeof result !== 'object') {
        return result
    }

    if ('success' in result && Reflect.get(result, 'success') === false) {
        return new Proxy(result, {
            ownKeys: (target) => Reflect.ownKeys(target),
            getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
            get(target, prop): unknown {
                const errVal: unknown = Reflect.get(target, 'error')
                const codeVal: unknown = Reflect.get(target, 'code')
                if (prop === 'error' && typeof errVal === 'string' && typeof codeVal === 'string') {
                    return `[${codeVal}] ${errVal}`
                }
                if (prop in target) return Reflect.get(target, prop) as unknown
                if (prop === 'length') return 0
                if (typeof prop === 'string' && /^\d+$/.test(prop)) return undefined
                if (prop === Symbol.iterator) return function* () { yield* [] }
                if (typeof prop === 'string' && RESULT_COLLECTION_KEYS.includes(prop)) return []
                if (typeof prop === 'string' && FAILED_ARRAY_METHODS.includes(prop)) return () => []
                return undefined
            },
        })
    }

    if (Array.isArray(result)) {
        const arr: unknown[] = result
        return new Proxy(arr, {
            ownKeys: (target) => Reflect.ownKeys(target),
            getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
            get(target, prop, receiver): unknown {
                if (prop in target) {
                    const val: unknown = Reflect.get(target, prop, receiver)
                    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(target) : val
                }
                if (prop === 'success') return true
                if (typeof prop === 'string' && ARRAY_SELF_ALIASES.includes(prop)) return receiver as unknown
                return undefined
            },
        })
    }

    return new Proxy(result, {
        ownKeys: (target) => Reflect.ownKeys(target),
        getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
        get(target, prop, receiver): unknown {
            if (prop in target) {
                const val: unknown = Reflect.get(target, prop)
                return val !== null && typeof val === 'object' && !Array.isArray(val) ? wrapResult(val) : val
            }

            if (!isObject(target)) return undefined
            const targetRecord = target

            if (prop === 'hasMore') {
                if (
                    'next_cursor' in targetRecord &&
                    targetRecord['next_cursor'] !== null &&
                    targetRecord['next_cursor'] !== undefined &&
                    targetRecord['next_cursor'] !== ''
                ) {
                    return true
                }
                if ('entries' in targetRecord || 'results' in targetRecord || 'items' in targetRecord) {
                    return false
                }
            }

            if (
                (prop === 'statistics' || prop === 'stats') &&
                !('statistics' in targetRecord) &&
                !('stats' in targetRecord) &&
                ('totalEntries' in targetRecord || 'entriesByType' in targetRecord)
            ) {
                return receiver as unknown
            }

            if (prop === 'total' || prop === 'totalCount' || prop === 'total_entries' || prop === 'totalEntries') {
                if ('count' in targetRecord && typeof targetRecord['count'] === 'number') return targetRecord['count']
                if ('totalEntries' in targetRecord && typeof targetRecord['totalEntries'] === 'number') {
                    return targetRecord['totalEntries']
                }
                if ('total' in targetRecord && typeof targetRecord['total'] === 'number') return targetRecord['total']
                const targetKey = findPrimaryArrayKey(targetRecord, [
                    'entries', 'results', 'projects', 'items', 'rows', 'records',
                ])
                if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
                    return targetRecord[targetKey].length
                }
            }

            const entryObj = targetRecord['entry']
            if ((prop === 'id' || prop === 'entryId') && isObject(entryObj) && 'id' in entryObj) {
                return entryObj['id']
            }

            const projObj = targetRecord['project']
            if (isObject(projObj)) {
                if (prop === 'project_number' && ('project_number' in projObj || 'id' in projObj)) {
                    return projObj['project_number'] ?? projObj['id']
                }
                if ((prop === 'name' || prop === 'project_name') && 'name' in projObj) return projObj['name']
                if (typeof prop === 'string' && prop in projObj) return projObj[prop]
            }

            if (prop === 'entryIds' && 'entries' in targetRecord && Array.isArray(targetRecord['entries'])) {
                return targetRecord['entries'].filter(hasNumberId).map((e) => e.id)
            }
            if (prop === 'entryIds' && 'updated' in targetRecord && Array.isArray(targetRecord['updated'])) {
                return targetRecord['updated'].filter(hasNumberId).map((e) => e.id)
            }
            if (prop === 'deletedIds' && 'deleted' in targetRecord && Array.isArray(targetRecord['deleted'])) {
                return targetRecord['deleted']
            }
            if (prop === 'deletedCount' && 'count' in targetRecord && typeof targetRecord['count'] === 'number') {
                return targetRecord['count']
            }

            if (prop === 'revisions' && 'history' in targetRecord && Array.isArray(targetRecord['history'])) {
                return targetRecord['history'].filter(isObject).map(
                    (h) =>
                        new Proxy(h, {
                            get(t: Record<string, unknown>, p: string | symbol): unknown {
                                if (p === 'revisionNumber') return t['revisionId']
                                if (p === 'contentSnapshot') return t['content']
                                return typeof p === 'string' ? t[p] : undefined
                            },
                        })
                )
            }

            if (prop === Symbol.iterator) {
                const targetKey = findPrimaryArrayKey(targetRecord, ITERATOR_COLLECTION_KEYS)
                if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
                    const arrToYield: unknown[] = targetRecord[targetKey]
                    return function* () { yield* arrToYield }
                }
                if ('project' in targetRecord && isObject(targetRecord['project'])) {
                    const proj = targetRecord['project']
                    return function* () { yield proj }
                }
                if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
                    const items = dictToItems(targetRecord['projects'])
                    return function* () { yield* items }
                }
                if (isDictLike(targetRecord)) {
                    const items = dictToItems(targetRecord)
                    return function* () { yield* items }
                }
            }

            if (typeof prop === 'string' && RESULT_LIST_ALIASES.includes(prop)) {
                const targetKey = findPrimaryArrayKey(targetRecord)
                if (targetKey !== undefined) return targetRecord[targetKey]
                if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
                    return wrapResult(dictToItems(targetRecord['projects']))
                }
                if (isDictLike(targetRecord)) return wrapResult(dictToItems(targetRecord))
                if ('project' in targetRecord && isObject(targetRecord['project'])) {
                    return wrapResult([targetRecord['project']])
                }
                if ('entry' in targetRecord && isObject(targetRecord['entry'])) {
                    return wrapResult([targetRecord['entry']])
                }
            }

            if (prop === 'result') return receiver as unknown

            if (prop === 'length') {
                const targetKey = findPrimaryArrayKey(targetRecord)
                if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
                    return targetRecord[targetKey].length
                }
                if ('project' in targetRecord && isObject(targetRecord['project'])) return 1
                if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
                    return Object.keys(targetRecord['projects']).length
                }
                if (isDictLike(targetRecord)) return Object.keys(targetRecord).length
            }

            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                const idx = parseInt(prop, 10)
                if ('project' in targetRecord && isObject(targetRecord['project']) && idx === 0) {
                    return targetRecord['project']
                }
                const targetKey = findPrimaryArrayKey(targetRecord)
                if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
                    return targetRecord[targetKey][idx]
                }
                if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
                    return dictToItems(targetRecord['projects'])[idx]
                }
                if (isDictLike(targetRecord)) return dictToItems(targetRecord)[idx]
            }

            if (typeof prop === 'string' && SUCCESS_ARRAY_METHODS.includes(prop)) {
                const targetKey = findPrimaryArrayKey(targetRecord)
                if (targetKey !== undefined && Array.isArray(targetRecord[targetKey])) {
                    const bound = bindArrayMethod(targetRecord[targetKey], prop)
                    if (bound !== undefined) return bound
                }
                if ('project' in targetRecord && isObject(targetRecord['project'])) {
                    const bound = bindArrayMethod([targetRecord['project']], prop)
                    if (bound !== undefined) return bound
                }
                if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
                    const bound = bindArrayMethod(dictToItems(targetRecord['projects']), prop)
                    if (bound !== undefined) return bound
                }
                if (isDictLike(targetRecord)) {
                    const bound = bindArrayMethod(dictToItems(targetRecord), prop)
                    if (bound !== undefined) return bound
                }
                const keys = Object.keys(target).join(', ') || 'none'
                throw new TypeError(
                    `🛠️ AUTONOMOUS HEALING: CodeMode Non-Array Proxy Error: Attempted to call Array method '${prop}' on an Object. The returned result is not an Array, and no array properties could be automatically resolved. Check the available keys and access the correct array property. Keys available: ${keys}`
                )
            }

            if (typeof prop === 'string' && MUTATOR_ARRAY_METHODS.includes(prop)) {
                throw new Error(
                    `🛠️ AUTONOMOUS HEALING: [VALIDATION_ERROR] CodeMode Proxy Error: Array mutator method '${prop}' is not allowed on API results. Modifying local arrays does not update the server state. You MUST use the appropriate API tool (e.g., mj.core.updateEntry, mj.admin.batchUpdateEntries) to persist changes.`
                )
            }
            return undefined
        },
    })
}
