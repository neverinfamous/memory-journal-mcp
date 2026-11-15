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
} from './proxy-helpers.js'
import {
    createSchemaProxy,
    createProjectsProxy,
    createTagsProxy,
    createSystemProxy,
    createContextNamespaceProxy,
} from './proxy-namespaces.js'
import { createApiRootGetTrap } from './worker/api-proxy-trap.js'

function getPropOrSnake(obj: unknown, snake: string, camel: string): unknown {
    if ((typeof obj === 'object' && obj !== null) || typeof obj === 'function') {
        return (Reflect.get(obj, snake) as unknown) ?? (Reflect.get(obj, camel) as unknown)
    }
    return undefined
}

interface GroupProxyContext {
    group: string
    methodNames: string[]
    methods: Record<string, string[]>
    schemas: Record<string, Record<string, string>> | undefined
    api: Record<string, unknown>
    readonlyMode: boolean | undefined
    createMethodProxyFn: (
        groupName: string,
        methodName: string,
        schemaFallbackKey?: string
    ) => (...args: unknown[]) => Promise<unknown>
}

function resolveFallbackSchema(
    schemas: Record<string, Record<string, string>> | undefined,
    group: string,
    key: string,
    resolvedKey: string
): string | undefined {
    if (schemas === undefined) return undefined
    const groupSchemas = schemas[group]
    if (groupSchemas !== undefined) {
        if (groupSchemas[key] !== undefined) return groupSchemas[key]
        if (groupSchemas[resolvedKey] !== undefined) return groupSchemas[resolvedKey]
    }
    const snakeKey = /[A-Z]/.test(resolvedKey)
        ? resolvedKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        : resolvedKey
    if (groupSchemas?.[snakeKey] !== undefined) return groupSchemas[snakeKey]

    for (const [gName, gMap] of Object.entries(schemas)) {
        if (gName === '_topLevel') continue
        const found = gMap[key] ?? gMap[resolvedKey] ?? gMap[snakeKey] ?? gMap[`team_${snakeKey}`]
        if (found !== undefined) return found
    }
    return schemas['_topLevel']?.[key] ?? schemas['_topLevel']?.[resolvedKey] ?? schemas['_topLevel']?.[snakeKey]
}

function createGroupNamespaceProxy(ctx: GroupProxyContext): object {
    const { group, methodNames, methods, schemas, api, readonlyMode, createMethodProxyFn } = ctx
    const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const methodName of methodNames) {
        groupProxy[methodName] = createMethodProxyFn(group, methodName)
    }

    const helpFn = (): Promise<unknown> => Promise.resolve({ group, methods: methodNames })
    attachMethodIntrospection(
        helpFn,
        group,
        'help',
        () => '() => Promise<{ group: string, methods: string[] }>',
        `List available methods in group '${group}'.`
    )

    const groupCallable = function (): void {
        /* callable namespace target */
    }
    Object.assign(groupCallable, groupProxy)
    Object.defineProperty(groupCallable, 'help', {
        value: helpFn,
        enumerable: false,
        configurable: true,
        writable: true,
    })
    Object.defineProperty(groupCallable, 'describe', {
        value: helpFn,
        enumerable: false,
        configurable: true,
        writable: true,
    })

    return new Proxy(groupCallable, {
        apply(_target, _thisArg, _args: unknown[]): Promise<unknown> {
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
                // [M7] semantic_search / get_vector_index_stats / list_deleted_entries are `search`-group tools.
                if (resolvedKey === 'semanticSearch' || key === 'semantic_search') {
                    return getPropOrSnake(api['search'], 'semantic_search', 'semanticSearch')
                }
                if (resolvedKey === 'vectorStats' || key === 'vector_stats') {
                    return getPropOrSnake(api['search'], 'get_vector_index_stats', 'getVectorIndexStats')
                }
                if (resolvedKey === 'searchAuditLog' || key === 'search_audit_log') {
                    return getPropOrSnake(api['admin'], 'search_audit_log', 'searchAuditLog')
                }
                if (resolvedKey === 'listDeletedEntries' || key === 'list_deleted_entries') {
                    return getPropOrSnake(api['search'], 'list_deleted_entries', 'listDeletedEntries')
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
            attachMethodIntrospection(
                fallbackFn,
                group,
                key,
                () => resolveFallbackSchema(schemas, group, key, resolvedKey) ?? 'unknown',
                reason
            )
            return fallbackFn
        },
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
        setPrototypeOf: () => false,
    })
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

        api[group] = createGroupNamespaceProxy({
            group,
            methodNames,
            methods,
            schemas,
            api,
            readonlyMode,
            createMethodProxyFn,
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
        get: createApiRootGetTrap({
            api,
            methods,
            schemas,
            readonlyMode,
            createMethodProxyFn,
            resolveFallbackSchema,
        }),
    })
}
