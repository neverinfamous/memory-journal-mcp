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
                get(target, prop) {
                    if (prop in target) return target[prop]
                    if (
                        typeof prop === 'string' &&
                        ['find', 'map', 'filter', 'reduce', 'forEach', 'some', 'every', 'flatMap', 'push', 'pop', 'slice', 'splice', 'sort'].includes(prop)
                    ) {
                        const arrayKeys = Object.keys(target).filter(k => Array.isArray(target[k]))
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
