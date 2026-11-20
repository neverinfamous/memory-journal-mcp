/**
 * Worker Result Proxy — wraps API call results with smart proxy behavior.
 *
 * - Failed results throw on property access with actionable error messages
 * - Successful results auto-forward Array methods to nested array properties
 * - Pagination cursor detection injects `hasMore` convenience boolean
 */

import {
    resolvePaginationAndStatsProp,
    resolveWrappedAliasProp,
} from './worker/result-proxy-aliases.js'

const RESULT_COLLECTION_KEYS: ReadonlySet<string> = new Set([
    'entries', 'results', 'projects', 'items', 'rows', 'tables',
    'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records',
    'logs', 'aliases', 'tags', 'issues', 'pullRequests', 'milestones', 'columns',
    'comments', 'files', 'errors', 'backups', 'deleted', 'updated', 'notFound',
    'history', 'relationships', 'members', 'data', 'nodes', 'edges', 'commits',
    'changelog', 'revisions', 'entryIds', 'deletedIds', 'list', 'dataArray',
])

const ITERATOR_COLLECTION_KEYS: ReadonlySet<string> = new Set([
    'entries', 'results', 'projects', 'items', 'issues', 'pullRequests',
    'milestones', 'columns', 'comments', 'files', 'errors', 'backups',
    'deleted', 'updated', 'notFound', 'history', 'relationships', 'members',
    'nodes', 'edges', 'commits',
])

const FAILED_ARRAY_METHODS: ReadonlySet<string> = new Set([
    'find', 'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every',
    'flatMap', 'includes', 'indexOf', 'findIndex', 'findLast', 'findLastIndex', 'join',
    'at', 'concat', 'flat', 'with', 'slice',
])

const SUCCESS_ARRAY_METHODS: ReadonlySet<string> = new Set([
    ...FAILED_ARRAY_METHODS, 'keys', 'values', 'entries',
])

const MUTATOR_ARRAY_METHODS: ReadonlySet<string> = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill',
])

const ARRAY_SELF_ALIASES: ReadonlySet<string> = new Set([
    'projects', 'entries', 'results', 'items', 'data', 'rows',
    'relationships', 'members', 'tags', 'history', 'records', 'commits',
])

const RESULT_LIST_ALIASES: ReadonlySet<string> = new Set([
    'data', 'items', 'entries', 'results', 'rows', 'dataArray', 'projects', 'list', 'records',
])

const DIGITS_RE = /^\d+$/

const isObject = (val: unknown): val is Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)

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
                const projNum = item['project_number'] ?? item['projectNumber']
                const mapped: Record<string, unknown> = { ...item, name, description: desc }
                if (projNum !== undefined) {
                    mapped['project_number'] = projNum
                    mapped['projectNumber'] = projNum
                }
                return mapped
            }
            return { name: key, description: '', value: item }
        })

function findPrimaryArrayKey(
    targetRecord: Record<string, unknown>,
    keysToCheck: ReadonlySet<string> = RESULT_COLLECTION_KEYS
): string | undefined {
    const arrayKeys = Object.keys(targetRecord).filter((k) => Array.isArray(targetRecord[k]))
    const matched = arrayKeys.find((k) => keysToCheck.has(k))
    if (matched !== undefined) return matched
    return arrayKeys.length === 1 ? arrayKeys[0] : undefined
}

function bindArrayMethod(arr: unknown[], prop: string): ((...args: unknown[]) => unknown) | undefined {
    const method: unknown = Reflect.get(arr, prop)
    if (typeof method === 'function') {
        return (method as (...a: unknown[]) => unknown).bind(arr)
    }
    return undefined
}

function failedResultMessage(target: object): string {
    const errVal: unknown = Reflect.get(target, 'error')
    const baseMsg = typeof errVal === 'string' ? errVal : 'Operation failed'
    const suggestionVal: unknown = Reflect.get(target, 'suggestion')
    if (
        typeof suggestionVal === 'string' &&
        suggestionVal.trim().length > 0 &&
        !baseMsg.includes(suggestionVal)
    ) {
        return `${baseMsg} (${suggestionVal})`
    }
    return baseMsg
}

function createFailedResultProxy(result: object): unknown {
    return new Proxy(result, {
        ownKeys: (target) => Reflect.ownKeys(target),
        getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
        isExtensible: () => true,
        preventExtensions: () => false,
        defineProperty: () => false,
        set: () => false,
        deleteProperty: () => false,
        setPrototypeOf: () => false,
        get(target, prop): unknown {
            const errVal: unknown = Reflect.get(target, 'error')
            const codeVal: unknown = Reflect.get(target, 'code')
            if (prop === 'error' && typeof errVal === 'string' && typeof codeVal === 'string') {
                return `[${codeVal}] ${errVal}`
            }
            // [H7] Collection properties on failed results must throw before `prop in target`
            // so `{ success: false, entries: [] }` cannot read as an empty success.
            if (
                prop === Symbol.iterator ||
                prop === 'length' ||
                (typeof prop === 'string' && RESULT_COLLECTION_KEYS.has(prop))
            ) {
                throw new Error(failedResultMessage(target))
            }
            if (prop in target) return Reflect.get(target, prop) as unknown
            if (typeof prop === 'string' && DIGITS_RE.test(prop)) return undefined
            if (typeof prop === 'string' && FAILED_ARRAY_METHODS.has(prop)) {
                const message = failedResultMessage(target)
                return () => {
                    throw new Error(message)
                }
            }
            return undefined
        },
    })
}

function createArrayResultProxy(arr: unknown[]): unknown {
    return new Proxy(arr, {
        ownKeys: (target) => Reflect.ownKeys(target),
        getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
        get(target, prop, receiver): unknown {
            if (prop in target) {
                const val: unknown = Reflect.get(target, prop, receiver)
                return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(target) : val
            }
            if (prop === 'success') return true
            if (typeof prop === 'string' && ARRAY_SELF_ALIASES.has(prop)) return receiver as unknown
            return undefined
        },
    })
}

type ArrayForwardMatch = { matched: true; value: unknown } | { matched: false }

function findPrimaryArray(
    targetRecord: Record<string, unknown>,
    keysToCheck: ReadonlySet<string> = RESULT_COLLECTION_KEYS
): unknown[] | undefined {
    const targetKey = findPrimaryArrayKey(targetRecord, keysToCheck)
    const candidate = targetKey !== undefined ? targetRecord[targetKey] : undefined
    if (Array.isArray(candidate)) {
        const arr: unknown[] = candidate
        return arr
    }
    const changelogObj = targetRecord['changelog']
    if (isObject(changelogObj) && Array.isArray(changelogObj['commits'])) {
        const commits: unknown[] = changelogObj['commits']
        return commits
    }
    return undefined
}

function resolveIteratorOrListAlias(
    targetRecord: Record<string, unknown>,
    prop: string | symbol
): ArrayForwardMatch {
    if (prop === Symbol.iterator) {
        const arrToYield = findPrimaryArray(targetRecord, ITERATOR_COLLECTION_KEYS)
        if (arrToYield !== undefined) {
            return { matched: true, value: function* () { yield* arrToYield } }
        }
        if ('project' in targetRecord && isObject(targetRecord['project'])) {
            const proj = targetRecord['project']
            return { matched: true, value: function* () { yield proj } }
        }
        if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
            const items = dictToItems(targetRecord['projects'])
            return { matched: true, value: function* () { yield* items } }
        }
        if (isDictLike(targetRecord)) {
            const items = dictToItems(targetRecord)
            return { matched: true, value: function* () { yield* items } }
        }
    }

    if (typeof prop === 'string' && RESULT_LIST_ALIASES.has(prop)) {
        const primaryArr = findPrimaryArray(targetRecord)
        if (primaryArr !== undefined) return { matched: true, value: primaryArr }
        if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
            return { matched: true, value: wrapResult(dictToItems(targetRecord['projects'])) }
        }
        if (isDictLike(targetRecord)) return { matched: true, value: wrapResult(dictToItems(targetRecord)) }
        if ('project' in targetRecord && isObject(targetRecord['project'])) {
            return { matched: true, value: wrapResult([targetRecord['project']]) }
        }
        if ('entry' in targetRecord && isObject(targetRecord['entry'])) {
            return { matched: true, value: wrapResult([targetRecord['entry']]) }
        }
    }
    return { matched: false }
}

function resolveLengthOrIndexAccess(
    targetRecord: Record<string, unknown>,
    prop: string | symbol
): ArrayForwardMatch {
    if (prop === 'length') {
        const primaryArr = findPrimaryArray(targetRecord)
        if (primaryArr !== undefined) {
            return { matched: true, value: primaryArr.length }
        }
        if ('project' in targetRecord && isObject(targetRecord['project'])) return { matched: true, value: 1 }
        if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
            return { matched: true, value: Object.keys(targetRecord['projects']).length }
        }
        if (isDictLike(targetRecord)) return { matched: true, value: Object.keys(targetRecord).length }
    }

    if (typeof prop === 'string' && DIGITS_RE.test(prop)) {
        const idx = parseInt(prop, 10)
        if ('project' in targetRecord && isObject(targetRecord['project']) && idx === 0) {
            return { matched: true, value: targetRecord['project'] }
        }
        const primaryArr = findPrimaryArray(targetRecord)
        if (primaryArr !== undefined) {
            return { matched: true, value: primaryArr[idx] }
        }
        if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
            return { matched: true, value: dictToItems(targetRecord['projects'])[idx] }
        }
        if (isDictLike(targetRecord)) return { matched: true, value: dictToItems(targetRecord)[idx] }
    }
    return { matched: false }
}

function resolveArrayMethodForwarding(
    targetRecord: Record<string, unknown>,
    prop: string | symbol
): ArrayForwardMatch {
    if (typeof prop === 'string' && SUCCESS_ARRAY_METHODS.has(prop)) {
        const primaryArr = findPrimaryArray(targetRecord)
        if (primaryArr !== undefined) {
            const bound = bindArrayMethod(primaryArr, prop)
            if (bound !== undefined) return { matched: true, value: bound }
        }
        if ('project' in targetRecord && isObject(targetRecord['project'])) {
            const bound = bindArrayMethod([targetRecord['project']], prop)
            if (bound !== undefined) return { matched: true, value: bound }
        }
        if ('projects' in targetRecord && isObject(targetRecord['projects'])) {
            const bound = bindArrayMethod(dictToItems(targetRecord['projects']), prop)
            if (bound !== undefined) return { matched: true, value: bound }
        }
        if (isDictLike(targetRecord)) {
            const bound = bindArrayMethod(dictToItems(targetRecord), prop)
            if (bound !== undefined) return { matched: true, value: bound }
        }
        const keys = Object.keys(targetRecord).join(', ') || 'none'
        throw new TypeError(
            `🛠️ AUTONOMOUS HEALING: CodeMode Non-Array Proxy Error: Attempted to call Array method '${prop}' on an Object. The returned result is not an Array, and no array properties could be automatically resolved. Check the available keys and access the correct array property. Keys available: ${keys}`
        )
    }

    if (typeof prop === 'string' && MUTATOR_ARRAY_METHODS.has(prop)) {
        throw new Error(
            `🛠️ AUTONOMOUS HEALING: [VALIDATION_ERROR] CodeMode Proxy Error: Array mutator method '${prop}' is not allowed on API results. Modifying local arrays does not update the server state. You MUST use the appropriate API tool (e.g., mj.core.updateEntry, mj.admin.batchUpdateEntries) to persist changes.`
        )
    }
    return { matched: false }
}

function resolveArrayForwarding(
    targetRecord: Record<string, unknown>,
    prop: string | symbol
): ArrayForwardMatch {
    const iterOrList = resolveIteratorOrListAlias(targetRecord, prop)
    if (iterOrList.matched) return iterOrList
    const lenOrIdx = resolveLengthOrIndexAccess(targetRecord, prop)
    if (lenOrIdx.matched) return lenOrIdx
    return resolveArrayMethodForwarding(targetRecord, prop)
}

function resolveWrappedObjectProp(target: object, prop: string | symbol, receiver: unknown): unknown {
    if (prop in target) {
        const val: unknown = Reflect.get(target, prop)
        return val !== null && typeof val === 'object' && !Array.isArray(val) ? wrapResult(val) : val
    }
    if (!isObject(target)) return undefined

    const paginationOrStats = resolvePaginationAndStatsProp(
        target,
        prop,
        receiver,
        findPrimaryArrayKey
    )
    if (paginationOrStats.matched) return paginationOrStats.value

    const aliasProp = resolveWrappedAliasProp(target, prop, wrapResult)
    if (aliasProp.matched) return aliasProp.value

    if (prop === 'result') return receiver

    const arrayForwarded = resolveArrayForwarding(target, prop)
    return arrayForwarded.matched ? arrayForwarded.value : undefined
}

const WRAPPED_RESULT_CACHE = new WeakMap<object, unknown>()
const RAW_TARGET_BY_PROXY = new WeakMap<object, object>()

function cacheProxyPair(target: object, proxy: object): object {
    WRAPPED_RESULT_CACHE.set(target, proxy)
    RAW_TARGET_BY_PROXY.set(proxy, target)
    return proxy
}

/** Unwrap a result Proxy created by `wrapResult` back to its plain target object. */
export function unwrapResultProxy(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        return RAW_TARGET_BY_PROXY.get(val) ?? val
    }
    return val
}

/**
 * Wrap an API result with smart proxy behavior for improved DX.
 */
export function wrapResult(result: unknown): unknown {
    if (result === null || result === undefined || typeof result !== 'object') {
        return result
    }
    if (RAW_TARGET_BY_PROXY.has(result)) {
        return result
    }
    const cached = WRAPPED_RESULT_CACHE.get(result)
    if (cached !== undefined) {
        return cached
    }

    const targetObj: object = Object.isFrozen(result)
        ? Array.isArray(result)
            ? [...(result as unknown[])]
            : { ...(result as Record<string, unknown>) }
        : result

    if ('success' in targetObj && Reflect.get(targetObj, 'success') === false) {
        return cacheProxyPair(result, createFailedResultProxy(targetObj) as object)
    }

    if (Array.isArray(targetObj)) {
        return cacheProxyPair(result, createArrayResultProxy(targetObj) as object)
    }

    return cacheProxyPair(
        result,
        new Proxy(targetObj, {
            ownKeys: (target) => Reflect.ownKeys(target),
            getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
            get: (target, prop, receiver): unknown => resolveWrappedObjectProp(target, prop, receiver),
        })
    )
}
