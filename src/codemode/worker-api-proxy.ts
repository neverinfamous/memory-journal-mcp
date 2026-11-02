/**
 * Worker API Proxy Builder — constructs the `mj.*` proxy API for the sandbox.
 *
 * Each tool group becomes a namespace with methods that dispatch RPC calls
 * to the main thread. Includes snake_case->camelCase fallback, readResource
 * hallucination handling, and schema() introspection on every method.
 */

import { wrapResult } from './worker-result-proxy.js'
import { METHOD_ALIASES } from './api-constants.js'
import { applyArgInterceptions } from './param-normalizer.js'
import {
    wrapPromise,
    attachMethodIntrospection,
    createGetConfigInterceptor,
    createGetBriefingInterceptor,
    createReadResourceInterceptor,
    createFactoryFnProxy,
    createUnknownGroupRejectionProxy,
} from './proxy-helpers.js'
import {
    createSchemaProxy,
    createProjectsProxy,
    createTagsProxy,
    createSystemProxy,
    createContextNamespaceProxy,
} from './proxy-namespaces.js'

const FACTORY_METHOD_NAMES = new Set([
    'getInstance', 'get_instance', 'createInstance', 'create_instance',
    'getClient', 'get_client', 'createClient', 'create_client',
    'initClient', 'init_client', 'initInstance', 'init_instance',
    'getJournal', 'get_journal', 'loadJournal', 'load_journal',
    'loadMemory', 'load_memory', 'getDatabase', 'get_database',
    'getDb', 'get_db', 'connectToDatabase', 'connect_to_database',
    'openDatabase', 'open_database', 'init', 'initialize',
    'connect', 'open', 'default',
])

const KNOWN_PROMPTS = [
    'session-summary', 'plan-draft', 'adversarial-review',
    'copilot-validation', 'plan-refinement', 'team-session-summary',
]

function getPropOrSnake(obj: unknown, snake: string, camel: string): unknown {
    if ((typeof obj === 'object' && obj !== null) || typeof obj === 'function') {
        return (Reflect.get(obj, snake) as unknown) ?? (Reflect.get(obj, camel) as unknown)
    }
    return undefined
}

/**
 * Build the mj.* API proxy from method and schema lists.
 */
export function buildApiProxy(
    rpcCall: (group: string, method: string, args: unknown[]) => Promise<unknown>,
    methods: Record<string, string[]>,
    schemas?: Record<string, Record<string, string>>,
    readonlyMode?: boolean,
    contextObj?: Record<string, unknown>
): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    const safeRpcCall = (group: string, method: string, args: unknown[]): Promise<unknown> =>
        rpcCall(group, method, args).catch((err: unknown) => ({
            success: false,
            error: err instanceof Error ? err.message : String(err),
            code: 'EXECUTION_ERROR',
            category: 'execution',
            recoverable: true,
        }))

    const invokeRpc = (g: string, m: string, args: unknown[]): Promise<unknown> => {
        const intercept = applyArgInterceptions(m, args)
        if ('error' in intercept) {
            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), m)
        }
        return wrapPromise(safeRpcCall(g, m, intercept.args).then(wrapResult), m)
    }

    const createMethodProxyFn = (
        groupName: string,
        methodName: string,
        schemaFallbackKey?: string
    ): ((...args: unknown[]) => Promise<unknown>) => {
        const fn = (...args: unknown[]): Promise<unknown> => invokeRpc(groupName, methodName, args)
        attachMethodIntrospection(
            fn,
            groupName,
            methodName,
            () =>
                schemas?.[groupName]?.[methodName] ??
                (schemaFallbackKey !== undefined ? schemas?.[groupName]?.[schemaFallbackKey] : undefined) ??
                'unknown'
        )
        return fn
    }

    for (const [group, methodNames] of Object.entries(methods)) {
        if (!Array.isArray(methodNames)) continue
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                api[methodName] = createMethodProxyFn('_topLevel', methodName)
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
        for (const methodName of methodNames) {
            groupProxy[methodName] = createMethodProxyFn(group, methodName)
        }

        groupProxy['help'] = () => Promise.resolve({ group, methods: methodNames })
        groupProxy['describe'] = groupProxy['help']

        const groupCallable = function (): void { /* callable namespace target */ }
        Object.assign(groupCallable, groupProxy)

        api[group] = new Proxy(groupCallable, {
            apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
                const primaryMethod = methodNames.find((m) => !m.endsWith('_help') && m !== 'help')
                const fn = primaryMethod !== undefined ? groupProxy[primaryMethod] : undefined
                if (fn !== undefined) return fn(...args)
                return wrapPromise(
                    Promise.resolve(
                        wrapResult({
                            success: false,
                            error: `Group '${group}' is a tool namespace, not a function. Available methods in '${group}': ${methodNames.join(', ')}.`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                        })
                    ),
                    group
                )
            },
            get(target: object, prop: string | symbol): unknown {
                if (typeof prop === 'symbol') return undefined
                const key = prop
                if (key in target) return Reflect.get(target, key) as unknown

                if (/[A-Z]/.test(key)) {
                    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    if (snakeKey in target) return Reflect.get(target, snakeKey) as unknown
                }

                const aliases = METHOD_ALIASES[group]
                let resolvedKey = key
                if (aliases?.[key] !== undefined) {
                    const canonicalCamel = aliases[key]
                    const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                    if (canonicalSnake in target) return Reflect.get(target, canonicalSnake) as unknown
                    if (canonicalCamel in target) return Reflect.get(target, canonicalCamel) as unknown
                    resolvedKey = canonicalCamel
                }

                if (group === 'core') {
                    if (resolvedKey === 'projects' || resolvedKey === 'project' || key === 'projects' || key === 'project') {
                        return api['projects']
                    }
                    if (resolvedKey === 'semanticSearch' || key === 'semantic_search') {
                        return getPropOrSnake(api['semantic'], 'semantic_search', 'semanticSearch')
                    }
                    if (resolvedKey === 'vectorStats' || key === 'vector_stats') {
                        return getPropOrSnake(api['semantic'], 'vector_stats', 'vectorStats')
                    }
                    if (resolvedKey === 'searchAuditLog' || key === 'search_audit_log') {
                        return getPropOrSnake(api['admin'], 'search_audit_log', 'searchAuditLog')
                    }
                    if (resolvedKey === 'listDeletedEntries' || key === 'list_deleted_entries') {
                        return getPropOrSnake(api['admin'], 'list_deleted_entries', 'listDeletedEntries')
                    }
                }

                if (resolvedKey === 'getConfig') return createGetConfigInterceptor()
                if (resolvedKey === 'getBriefing') return createGetBriefingInterceptor()
                if (resolvedKey === 'readResource') return createReadResourceInterceptor()
                if (resolvedKey === 'then') return undefined

                if (typeof resolvedKey === 'string') {
                    const snakeKey = /[A-Z]/.test(resolvedKey)
                        ? resolvedKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                        : resolvedKey

                    const teamSnakeKey = `team_${snakeKey}`
                    const teamGroup = Object.keys(methods).find((g) => methods[g]?.includes(teamSnakeKey))
                    if (teamGroup !== undefined && !Object.keys(methods).some((g) => methods[g]?.includes(snakeKey))) {
                        return createMethodProxyFn(teamGroup, teamSnakeKey)
                    }

                    const foundGroup = Object.keys(methods).find((g) => methods[g]?.includes(snakeKey))
                    if (foundGroup !== undefined) {
                        return createMethodProxyFn(foundGroup, snakeKey, resolvedKey)
                    }
                }

                const available = methodNames.join(', ') || 'none'
                const reason =
                    readonlyMode === true
                        ? `🛠️ AUTONOMOUS HEALING: Operation '${key}' is blocked in readonly mode. Read operations only.`
                        : methodNames.length === 0
                          ? `🛠️ AUTONOMOUS HEALING: Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                          : `🛠️ AUTONOMOUS HEALING: Operation '${key}' is not found in group '${group}'. Available: ${available}.`
                const fallbackFn = (..._args: unknown[]): Promise<unknown> =>
                    wrapPromise(
                        Promise.resolve(
                            wrapResult({
                                success: false,
                                error: reason,
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                recoverable: true,
                            })
                        ),
                        key
                    )
                attachMethodIntrospection(fallbackFn, group, key, () => 'unknown', reason)
                return fallbackFn
            },
            set: () => false,
            defineProperty: () => false,
            deleteProperty: () => false,
            setPrototypeOf: () => false,
        })
    }

    api['schema'] = createSchemaProxy(safeRpcCall)
    api['help'] = () => {
        const groups = Object.keys(methods).filter((g) => g !== '_topLevel' && g !== 'memory' && g !== 'entries')
        let totalMethods = 0
        for (const group of groups) totalMethods += methods[group]?.length ?? 0
        return Promise.resolve({
            groups,
            totalMethods,
            usage: 'Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details.',
        })
    }
    api['describe'] = api['help']

    const projectsProxy = createProjectsProxy(methods, invokeRpc)
    api['projects'] = projectsProxy
    api['project'] = projectsProxy

    const tagsProxy = createTagsProxy(methods, invokeRpc)
    api['tags'] = tagsProxy
    api['tag'] = tagsProxy

    const systemProxy = createSystemProxy(methods, invokeRpc)
    api['system'] = systemProxy
    api['adapters'] = systemProxy

    const { contextProxy, getContextRpc } = createContextNamespaceProxy(contextObj)
    api['context'] = contextProxy
    api['getContext'] = getContextRpc
    api['get_context'] = getContextRpc
    api['getDatabase'] = () => api
    api['get_database'] = () => api
    api['getDb'] = () => api
    api['get_db'] = () => api
    api['connectToDatabase'] = () => api
    api['openDatabase'] = () => api

    return new Proxy(api, {
        get(target, prop): unknown {
            if (typeof prop === 'symbol') return undefined
            if (prop in target) return target[prop]
            if (prop === 'gitApi') return target['git']
            if (prop === 'journal' || prop === 'memory' || prop === 'entries' || prop === 'entry')
                return target['core'] ?? target
            if (prop === 'schema') return target['schema']
            if (prop === 'projects' || prop === 'project') return target['projects']
            if (prop === 'tags' || prop === 'tag') return target['tags']
            if (prop === 'system') return target['system']
            if (prop === 'context') return target['context']
            if (prop === 'getContext' || prop === 'get_context') return target['getContext']
            if (prop === 'sqlite' || prop === 'sqlite3' || prop === 'db') return target
            if (prop === 'then') return undefined

            if (FACTORY_METHOD_NAMES.has(prop)) return createFactoryFnProxy(api)

            if (typeof prop === 'string') {
                const snakeKey = /[A-Z]/.test(prop)
                    ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    : prop

                for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
                    if (groupAliases?.[prop] !== undefined) {
                        const canonicalCamel = groupAliases[prop]
                        const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                        if (methods[g]?.includes(canonicalSnake)) {
                            return createMethodProxyFn(g, canonicalSnake)
                        }
                    }
                }

                const teamSnakeKey = `team_${snakeKey}`
                const teamGroup = Object.keys(methods).find((g) => methods[g]?.includes(teamSnakeKey))
                if (teamGroup !== undefined && !Object.keys(methods).some((g) => methods[g]?.includes(snakeKey))) {
                    return createMethodProxyFn(teamGroup, teamSnakeKey)
                }

                const foundGroup = Object.keys(methods).find((g) => methods[g]?.includes(snakeKey))
                if (foundGroup !== undefined) {
                    return createMethodProxyFn(foundGroup, snakeKey)
                }
            }

            const available = Object.keys(methods).filter((k) => k !== '_topLevel').join(', ')
            let reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            if (typeof prop === 'string') {
                const normalized = prop.replace(/^mj_/, '').replace(/_/g, '-')
                const isPrompt =
                    KNOWN_PROMPTS.includes(normalized) ||
                    KNOWN_PROMPTS.includes(prop) ||
                    KNOWN_PROMPTS.includes(prop.replace(/^mj_/, ''))

                if (isPrompt) {
                    reason = `'${prop}' is an MCP Prompt, not an MCP Tool. Code Mode cannot invoke MCP Prompts directly. Please use the 'get_prompt' tool (or your native MCP Prompts integration) outside of Code Mode to evaluate it, then use 'mj.core.createEntry' to save the result.`
                } else if (prop.startsWith('mj_')) {
                    reason = `'${prop}' is not a valid root tool in Code Mode. Code Mode uses namespaced groups (e.g., 'mj.core.searchEntries'). Use 'mj.help()' to see available namespaces.`
                }
            }

            return createUnknownGroupRejectionProxy(prop, reason)
        },
    })
}
