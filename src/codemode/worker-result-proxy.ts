/**
 * Worker Result Proxy — wraps API call results with smart proxy behavior.
 *
 * - Failed results throw on property access with actionable error messages
 * - Successful results auto-forward Array methods to nested array properties
 * - Pagination cursor detection injects `hasMore` convenience boolean
 */

/**
 * Wrap an API result with smart proxy behavior for improved DX.
 */
export function wrapResult(result: unknown): unknown {
    if (
        result !== null &&
        result !== undefined &&
        typeof result === 'object'
    ) {
        const isFailed = 'success' in result && (result as Record<string, unknown>)['success'] === false

        if (isFailed) {
            const failedResult = result as Record<string | symbol, unknown>
            return new Proxy(failedResult, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop) {
                    if (prop in target) return target[prop]
                    if (
                        typeof prop === 'string' &&
                        prop !== 'then' &&
                        prop !== 'catch' &&
                        prop !== 'finally' &&
                        prop !== 'constructor' &&
                        prop !== 'prototype' &&
                        prop !== 'toJSON'
                    ) {
                        const errVal = target['error']
                        const errorMsg = typeof errVal === 'string' ? errVal : 'Unknown error'
                        throw new Error(
                            `Attempted to access missing property '${prop}' on a failed operation. API Error: ${errorMsg}`
                        )
                    }
                    return undefined
                },
            })
        }

        if (!Array.isArray(result)) {
            const successResult = result as Record<string | symbol, unknown>

            // §2.4: Inject `hasMore` convenience boolean when pagination cursor is present
            if ('next_cursor' in successResult && successResult['next_cursor'] !== null && successResult['next_cursor'] !== undefined) {
                successResult['hasMore'] = true
            } else if (
                ('entries' in successResult || 'results' in successResult || 'items' in successResult) &&
                !('hasMore' in successResult)
            ) {
                successResult['hasMore'] = false
            }
            return new Proxy(successResult, {
                ownKeys(target) { return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop) },
                get(target, prop) {
                    if (prop in target) return target[prop]
                    
                    // Helper to safely check and cast arrays
                    const isObject = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null;
                    const hasNumberId = (val: unknown): val is { id: number } => isObject(val) && typeof val['id'] === 'number';

                    // Hallucination Intercept: Agents frequently expect batchCreateEntries to return `entryIds` array
                    // instead of the actual `entries` array. Expose it gracefully as an iterable array of numbers.
                    const targetRecord = target as Record<string, unknown>
                    if (prop === 'entryIds' && 'entries' in targetRecord && Array.isArray(targetRecord['entries'])) {
                        return targetRecord['entries'].filter(hasNumberId).map((e) => e.id)
                    }
                    if (prop === 'entryIds' && 'updated' in targetRecord && Array.isArray(targetRecord['updated'])) {
                        return targetRecord['updated'].filter(hasNumberId).map((e) => e.id)
                    }
                    // Hallucination Intercept: deletedIds vs deleted
                    if (prop === 'deletedIds' && 'deleted' in targetRecord && Array.isArray(targetRecord['deleted'])) {
                        return targetRecord['deleted'] as unknown[]
                    }
                    
                    // Hallucination Intercept: deletedCount vs count
                    if (prop === 'deletedCount' && 'count' in targetRecord && typeof targetRecord['count'] === 'number') {
                        return targetRecord['count']
                    }

                    // Hallucination Intercept: revisions vs history
                    if (prop === 'revisions' && 'history' in targetRecord && Array.isArray(targetRecord['history'])) {
                        return targetRecord['history'] as unknown[]
                    }

                    // Native Iteration fallback: If an agent tries to destructure the result object directly:
                    // `const [id1] = bCreated` or `const [e1] = bCreated`, we can iterate over the primary array
                    if (prop === Symbol.iterator) {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        const targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items'].includes(k)) || arrayKeys[0]
                        if (targetKey !== undefined) {
                            return function* () {
                                yield* (targetRecord[targetKey] as unknown[])
                            }
                        }
                    }

                    if (
                        typeof prop === 'string' &&
                        ['find', 'map', 'filter', 'reduce', 'forEach', 'some', 'every', 'flatMap', 'push', 'pop', 'slice', 'splice', 'sort'].includes(prop)
                    ) {
                        const targetRecord = target as Record<string, unknown>
                        const arrayKeys = Object.keys(targetRecord).filter(k => Array.isArray(targetRecord[k]))
                        const targetKey = arrayKeys.find(k => ['entries', 'results', 'projects', 'items', 'rows', 'tables', 'flags', 'groups', 'users', 'capabilities', 'metrics', 'events', 'records', 'logs', 'aliases', 'tags'].includes(k)) || arrayKeys[0]

                        if (targetKey !== undefined) {
                            const arr = target[targetKey] as unknown[]
                            const method = (arr as unknown as Record<string, unknown>)[prop]
                            if (typeof method === 'function') {
                                return (...args: unknown[]) => {
                                    const fn = method as (...a: unknown[]) => unknown
                                    return fn.apply(arr, args)
                                }
                            }
                        }

                        const keys = Object.keys(target).join(', ') || 'none'
                        throw new TypeError(
                            `Attempted to call Array method '${prop}' on an Object. The returned result is not an Array, and no array properties could be automatically resolved. Keys available: ${keys}`
                        )
                    }
                    return undefined
                },
            })
        }
    }
    return result
}
