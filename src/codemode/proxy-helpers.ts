/**
 * Worker API Proxy Helpers — promise wrappers, introspection attachers,
 * and hallucination interceptors for `mj.*` API proxies.
 */

import { wrapResult } from './worker-result-proxy.js'

/**
 * Wraps a tool call Promise with a Proxy that gives actionable Autonomous Healing
 * errors when an agent forgets `await` and accesses properties or iterates directly.
 */
export function wrapPromise(promise: Promise<unknown>, methodName: string): Promise<unknown> {
    return new Proxy(promise, {
        get(target, prop): unknown {
            if (prop === 'then') return target.then.bind(target)
            if (prop === 'catch') return target.catch.bind(target)
            if (prop === 'finally') return target.finally.bind(target)
            if (typeof prop === 'string' && !['constructor', 'toString', 'valueOf', 'toJSON'].includes(prop)) {
                if (['prepare', 'exec', 'query', 'run'].includes(prop)) {
                    throw new Error(
                        `🛠️ AUTONOMOUS HEALING: Attempted to call database method '${prop}' on an unresolved Promise. In Code Mode, avoid direct database driver methods and use high-level mj.* API methods (e.g. mj.admin.updateEntry, mj.core.createEntry), or await the tool call.`
                    )
                }
                throw new Error(
                    `🛠️ AUTONOMOUS HEALING: Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`
                )
            }
            if (prop === Symbol.iterator) {
                throw new Error(
                    `🛠️ AUTONOMOUS HEALING: Attempted to iterate over a Promise object. Did you forget to 'await' the tool call? (e.g. const [item] = await mj.group.${methodName}(...))`
                )
            }
            return Reflect.get(target, prop) as unknown
        },
    })
}

/**
 * Attaches `.schema()`, `.help()`, and `.describe()` introspection methods to a tool function.
 */
export function attachMethodIntrospection(
    targetFn: (...args: unknown[]) => unknown,
    group: string,
    methodName: string,
    getSchema: () => string,
    customDescription?: string
): void {
    const description =
        customDescription ??
        `Code Mode tool mj.${group}.${methodName}. Use mj.${group}.${methodName}.schema() to view parameter schema.`
    const getInfo = (): Promise<unknown> =>
        Promise.resolve({ name: methodName, group, schema: getSchema(), description })
    Object.assign(targetFn, {
        schema: (): Promise<string> => Promise.resolve(getSchema()),
        help: getInfo,
        describe: getInfo,
    })
}

/**
 * Interceptor for `getConfig()` hallucination.
 */
export function createGetConfigInterceptor(): () => Promise<unknown> {
    return () =>
        wrapPromise(
            Promise.resolve(
                wrapResult({
                    success: false,
                    error: 'Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true,
                })
            ),
            'getConfig'
        )
}

/**
 * Interceptor for `getBriefing()` hallucination.
 */
export function createGetBriefingInterceptor(): () => Promise<unknown> {
    return () =>
        wrapPromise(
            Promise.resolve(
                wrapResult({
                    success: false,
                    error: 'Code Mode cannot directly read the briefing resource via getBriefing(). Use mj.core.getRecentEntries() instead, or read the memory://briefing resource via standard MCP client requests outside of Code Mode.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true,
                })
            ),
            'getBriefing'
        )
}

const RESOURCE_SUGGESTIONS: Record<string, string> = {
    'memory://recent': 'mj.core.getRecentEntries()',
    'memory://statistics': 'mj.analytics.getStatistics()',
    'memory://tags': 'mj.core.listTags()',
    'memory://flags': 'mj.team.teamListFlags({ status: "active" })',
    'memory://significant': 'mj.search.searchEntries({ sort_by: "importance" })',
    'memory://insights': 'mj.analytics.getCrossProjectInsights()',
}

/**
 * Interceptor for `readResource()` hallucination with URI-aware suggestions.
 */
export function createReadResourceInterceptor(): (uri?: string) => Promise<unknown> {
    return (uri?: string) => {
        let hint = ''
        if (typeof uri === 'string') {
            const match = Object.entries(RESOURCE_SUGGESTIONS).find(([k]) => uri.startsWith(k))
            if (match !== undefined) hint = ` Try: ${match[1]}`
        }
        return wrapPromise(
            Promise.resolve(
                wrapResult({
                    success: false,
                    error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true,
                })
            ),
            'readResource'
        )
    }
}

/**
 * Creates a factory function proxy (e.g. `mj.getInstance()`, `new mj.getClient()`) that returns `api`.
 */
export function createFactoryFnProxy(api: Record<string, unknown>): object {
    const factoryFn = function (this: unknown, ..._args: unknown[]): unknown {
        return api
    }
    return new Proxy(factoryFn, {
        apply: () => api,
        construct: () => api,
        get(_t, p): unknown {
            if (p === 'then') return undefined
            if (p === 'name') return 'factoryFn'
            if (p === 'length') return 0
            if (p === 'bind' || p === 'call' || p === 'apply' || p === 'toString') {
                return Function.prototype[p].bind(factoryFn)
            }
            return typeof p === 'string' ? api[p] : undefined
        },
    })
}

/**
 * Creates a rejection proxy when an unknown top-level group or property is accessed on `mj`.
 */
export function createUnknownGroupRejectionProxy(prop: string, reason: string): object {
    return new Proxy(() => undefined, {
        apply(): Promise<unknown> {
            return wrapPromise(
                Promise.resolve(
                    wrapResult({
                        success: false,
                        error: reason,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    })
                ),
                prop
            )
        },
        get(_t, subProp): unknown {
            if (typeof subProp === 'symbol' || subProp === 'then') return undefined
            return (..._args: unknown[]): Promise<unknown> =>
                wrapPromise(
                    Promise.resolve(
                        wrapResult({
                            success: false,
                            error: `${reason} (Attempted to access 'mj.${prop}.${subProp}')`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                        })
                    ),
                    `${prop}.${subProp}`
                )
        },
    })
}
