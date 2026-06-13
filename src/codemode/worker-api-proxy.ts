/**
 * Worker API Proxy Builder — constructs the `mj.*` proxy API for the sandbox.
 *
 * Each tool group becomes a namespace with methods that dispatch RPC calls
 * to the main thread. Includes snake_case→camelCase fallback, readResource
 * hallucination handling, and schema() introspection on every method.
 */

import { wrapResult } from './worker-result-proxy.js'
import { METHOD_ALIASES } from './api-constants.js'

/**
 * Build the mj.* API proxy from method and schema lists.
 *
 * @param rpcCall - Function to dispatch RPC calls to main thread
 * @param methods - Map of group name → method names
 * @param schemas - Optional map of group name → method name → type string
 * @param readonlyMode - If true, blocked methods show readonly error
 */
export function buildApiProxy(
    rpcCall: (group: string, method: string, args: unknown[]) => Promise<unknown>,
    methods: Record<string, string[]>,
    schemas?: Record<string, Record<string, string>>,
    readonlyMode?: boolean
): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    function wrapPromise(promise: Promise<unknown>, methodName: string): Promise<unknown> {
        return new Proxy(promise, {
            get(target, prop) {
                if (prop === 'then') return target.then.bind(target)
                if (prop === 'catch') return target.catch.bind(target)
                if (prop === 'finally') return target.finally.bind(target)
                if (typeof prop === 'string' && prop !== 'constructor' && prop !== 'toString' && prop !== 'valueOf' && prop !== 'toJSON') {
                    throw new Error(`Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`)
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return Reflect.get(target, prop)
            }
        })
    }

    for (const [group, methodNames] of Object.entries(methods)) {
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                const proxyFn = (...args: unknown[]): Promise<unknown> => {
                    const resultPromise = rpcCall('_topLevel', methodName, args).then(wrapResult)
                    return wrapPromise(resultPromise, methodName)
                }
                Object.assign(proxyFn, {
                    schema: (): Promise<string> =>
                        Promise.resolve(schemas?.['_topLevel']?.[methodName] ?? 'unknown'),
                })
                api[methodName] = proxyFn
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const methodName of methodNames) {
            const proxyFn = (...args: unknown[]): Promise<unknown> => {
                // Hallucination intercept for _executeRawQueryUnsafe string arguments
                if (methodName === '_executeRawQueryUnsafe' && args.length === 1 && typeof args[0] === 'string') {
                    args[0] = { query: args[0] }
                }
                // Hallucination intercept for search exact_match
                if (
                    (methodName === 'search_entries' || methodName === 'searchEntries' || methodName === 'team_search' || methodName === 'teamSearch' || methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') &&
                    args.length === 1 &&
                    typeof args[0] === 'object' &&
                    args[0] !== null
                ) {
                    const obj = args[0] as Record<string, unknown>
                    if ('exact_match' in obj) {
                        const isFuzzy = obj['exact_match'] === false;
                        obj['fuzzy_match'] = isFuzzy;
                        obj['auto_correct'] = isFuzzy;
                        delete obj['exact_match']
                    } else if (obj['fuzzy_match'] === true && !('auto_correct' in obj)) {
                        obj['auto_correct'] = true;
                    }
                    
                    if (typeof obj['start_date'] === 'string' && (obj['end_date'] === undefined || obj['end_date'] === null || obj['end_date'] === '')) {
                        obj['end_date'] = new Date().toISOString().split('T')[0];
                    }
                }
                const resultPromise = rpcCall(group, methodName, args).then(wrapResult)
                return wrapPromise(resultPromise, methodName)
            }
            Object.assign(proxyFn, {
                schema: (): Promise<string> =>
                    Promise.resolve(schemas?.[group]?.[methodName] ?? 'unknown'),
            })
            groupProxy[methodName] = proxyFn
        }

        groupProxy['help'] = () =>
            Promise.resolve({
                group,
                methods: methodNames,
            })

        const groupProxyWrapped = new Proxy(groupProxy, {
            get(target, prop) {
                if (typeof prop === 'symbol') return undefined
                const key = prop
                if (key in target) return target[key]

                // Generic camelCase to snake_case fallback
                if (typeof key === 'string' && /[A-Z]/.test(key)) {
                    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    if (snakeKey in target) return target[snakeKey]
                }

                // Resolve using unified METHOD_ALIASES map
                const aliases = METHOD_ALIASES[group]
                if (aliases && typeof key === 'string' && aliases[key]) {
                    const canonicalCamel = aliases[key]
                    // Convert the canonical camelCase to the target's snake_case keys
                    const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                    if (canonicalSnake in target) return target[canonicalSnake]
                    if (canonicalCamel in target) return target[canonicalCamel]
                }

                if (key === 'getConfig') {
                    return () => Promise.reject(new Error(
                        "Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings."
                    ))
                }

                if (key === 'readResource') {
                    // §2.3: URI-aware suggestions for common readResource hallucinations
                    return (uri?: string) => {
                        const suggestions: Record<string, string> = {
                            'memory://recent': 'mj.core.getRecentEntries()',
                            'memory://statistics': 'mj.analytics.getStatistics()',
                            'memory://tags': 'mj.core.listTags()',
                            'memory://flags': 'mj.team.teamListFlags({ status: "active" })',
                            'memory://significant': 'mj.search.searchEntries({ sort_by: "importance" })',
                            'memory://insights': 'mj.analytics.getCrossProjectInsights()',
                        }
                        let hint = ''
                        if (typeof uri === 'string') {
                            const match = Object.entries(suggestions).find(([k]) => uri.startsWith(k))
                            if (match !== undefined) {
                                hint = ` Try: ${match[1]}`
                            }
                        }
                        return Promise.reject(new Error(
                            `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
                        ))
                    }
                }

                if (key === 'then') return undefined
                
                // Cross-group search: if they called the wrong group (e.g. mj.core.searchEntries instead of mj.search.searchEntries)
                if (typeof key === 'string') {
                    const snakeKey = /[A-Z]/.test(key) ? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : key;
                    const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                    if (foundGroup) {
                        return (..._args: unknown[]) => {
                            throw new Error(`Operation '${key}' is not found in the '${group}' group. However, it DOES exist in the '${foundGroup}' group! Please update your script to call: mj.${foundGroup}.${key}(...)`);
                        }
                    }
                }

                const available = methodNames.join(', ') || 'none'
                const reason = readonlyMode
                    ? `Operation '${key}' is blocked in readonly mode. Read operations only.`
                    : methodNames.length === 0
                      ? `Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                      : `Operation '${key}' is not found in group '${group}'. Available: ${available}.`
                return (..._args: unknown[]) => {
                    throw new Error(reason)
                }
            },
        })

        api[group] = groupProxyWrapped
    }

    api['help'] = () => {
        const groups = Object.keys(methods).filter(
            (g) => g !== '_topLevel' && g !== 'memory' && g !== 'entries'
        )
        let totalMethods = 0
        for (const group of groups) {
            totalMethods += methods[group]?.length ?? 0
        }
        return Promise.resolve({
            groups,
            totalMethods,
            usage: 'Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details.',
        })
    }

    return new Proxy(api, {
        get(target, prop) {
            if (typeof prop === 'symbol') return undefined
            if (prop in target) return target[prop]
            if (prop === 'then') return undefined

            const available = Object.keys(methods)
                .filter((k) => k !== '_topLevel')
                .join(', ')
            const reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            // Return a proxy that rejects any method call
            return new Proxy(
                () => {
                    // no-op function target for the proxy
                },
                {
                    apply() {
                        throw new Error(reason)
                    },
                    get(_t, subProp) {
                        if (typeof subProp === 'symbol') return undefined
                        if (subProp === 'then') return undefined
                        return (..._args: unknown[]) => {
                            throw new Error(
                                `${reason} (Attempted to access 'mj.${prop}.${subProp}')`
                            )
                        }
                    },
                }
            )
        },
    })
}
