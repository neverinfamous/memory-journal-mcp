/**
 * Worker API Proxy Namespaces — virtual namespace builders (`schema`, `projects`,
 * `tags`, `system`, `context`) attached to `mj.*`.
 */

import { wrapResult } from './worker-result-proxy.js'
import { wrapPromise } from './proxy-helpers.js'
import { deepFreezeContextClone, IMMUTABLE_PROXY_TRAPS } from './worker/result-proxy-aliases.js'
import { createNullProtoRecord } from '../utils/type-guards.js'
import { PACKAGE_VERSION } from './package-version.js'
import { JOURNAL_TABLES, getSchemaHelp, listJournalTables } from './api/schema-help.js'

export type InvokeRpcFn = (group: string, method: string, args: unknown[]) => Promise<unknown>
export type SafeRpcCallFn = (group: string, method: string, args: unknown[]) => Promise<unknown>

function unavailableTool(tool: string): Promise<unknown> {
    return wrapPromise(
        Promise.resolve(
            wrapResult({
                success: false,
                error: `Tool '${tool}' is not available in this sandbox.`,
                code: 'TOOL_DISABLED',
                _healing_note: `🛠️ AUTONOMOUS HEALING: 'mj.projects' requires '${tool}' to be enabled in the active tool filter.`,
            })
        ),
        tool
    )
}

function compactMethodName(name: string): string {
    return name.toLowerCase().replace(/[_-]/g, '')
}

const PROJECT_LIST_METHODS = new Set([
    'list',
    'listprojects',
    'listproject',
    'getprojects',
    'all',
    'getall',
    'projects',
])
const PROJECT_GET_METHODS = new Set(['get', 'getproject', 'find', 'findproject'])
const PROJECT_UPDATE_METHODS = new Set(['update', 'updateproject', 'edit', 'editproject'])
const PROJECT_CREATE_METHODS = new Set(['create', 'createproject', 'register', 'registerproject', 'add', 'addproject'])
const PROJECT_DELETE_METHODS = new Set([
    'delete',
    'deleteproject',
    'deleteall',
    'remove',
    'removeproject',
    'removeall',
])
const TAG_LIST_METHODS = new Set([
    'list',
    'listtags',
    'get',
    'gettags',
    'all',
    'search',
    'find',
    'tags',
    'tag',
])
const TAG_MERGE_METHODS = new Set(['merge', 'mergetags'])
const SYSTEM_STATS_METHODS = new Set([
    'stats',
    'status',
    'health',
    'info',
    'check',
    'sys',
    'system',
    'diagnostics',
    'adapters',
    'getstatistics',
    'statistics',
])

/**
 * Builds the `mj.schema` virtual namespace proxy.
 */
export function createSchemaProxy(_safeRpcCall: SafeRpcCallFn): object {
    const usage =
        'Use mj.core.createEntry.schema() for entry parameter details, or mj.analytics.getStatistics() for database statistics.'
    const schemaHelp = (): Promise<unknown> => getSchemaHelp(usage)

    const schemaCallable = (..._args: unknown[]): Promise<unknown> => schemaHelp()

    return new Proxy(schemaCallable, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply: () => schemaHelp(),
        get(_t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p === 'help' || p === 'describe' || p === 'describeTable' || p === 'getSchema') return schemaHelp
            if (p === 'listTables') return listJournalTables
            if (p === 'tables') return JOURNAL_TABLES
            if (p in Function.prototype) return Reflect.get(Function.prototype, p) as unknown
            return undefined
        },
    })
}

/**
 * Builds the `mj.projects` / `mj.project` virtual namespace proxy.
 */
export function createProjectsProxy(
    methods: Record<string, string[]>,
    invokeRpc: InvokeRpcFn
): object {
    const adminListProjects = methods['admin']?.includes('list_projects')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'list_projects', args)
        : (): Promise<unknown> => unavailableTool('list_projects')

    const adminGetProject = methods['admin']?.includes('get_project')
        ? (nameOrParams: unknown): Promise<unknown> => {
              const params =
                  typeof nameOrParams === 'string' || typeof nameOrParams === 'number'
                      ? [{ name: String(nameOrParams) }]
                      : [nameOrParams ?? {}]
              return invokeRpc('admin', 'get_project', params)
          }
        : (): Promise<unknown> => unavailableTool('get_project')

    const adminRegisterProject = methods['admin']?.includes('register_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'register_project', args)
        : (): Promise<unknown> => unavailableTool('register_project')

    const adminUpdateProject = methods['admin']?.includes('update_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'update_project', args)
        : (): Promise<unknown> => unavailableTool('update_project')

    const adminDeleteProject = methods['admin']?.includes('delete_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'delete_project', args)
        : (): Promise<unknown> => unavailableTool('delete_project')

    const projectsCallable = (...args: unknown[]): Promise<unknown> => adminListProjects(...args)
    Object.assign(projectsCallable, {
        list: adminListProjects,
        listProjects: adminListProjects,
        list_projects: adminListProjects,
        getProjects: adminListProjects,
        get_projects: adminListProjects,
        getAll: adminListProjects,
        all: adminListProjects,
        get: adminGetProject,
        getProject: adminGetProject,
        get_project: adminGetProject,
        find: adminGetProject,
        findProject: adminGetProject,
        find_project: adminGetProject,
        register: adminRegisterProject,
        registerProject: adminRegisterProject,
        register_project: adminRegisterProject,
        create: adminRegisterProject,
        createProject: adminRegisterProject,
        update: adminUpdateProject,
        updateProject: adminUpdateProject,
        update_project: adminUpdateProject,
        delete: adminDeleteProject,
        deleteProject: adminDeleteProject,
        delete_project: adminDeleteProject,
        remove: adminDeleteProject,
        removeProject: adminDeleteProject,
    })
    return new Proxy(projectsCallable, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply: (_t, _thisArg, args: unknown[]) => adminListProjects(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string') {
                const compact = compactMethodName(p)
                if (PROJECT_DELETE_METHODS.has(compact)) return adminDeleteProject
                if (PROJECT_LIST_METHODS.has(compact)) return adminListProjects
                if (PROJECT_GET_METHODS.has(compact)) return adminGetProject
                if (PROJECT_UPDATE_METHODS.has(compact)) return adminUpdateProject
                if (PROJECT_CREATE_METHODS.has(compact)) return adminRegisterProject
            }
            return Reflect.get(t, p) as unknown
        },
    })
}

/**
 * Builds the `mj.tags` / `mj.tag` virtual namespace proxy.
 */
export function createTagsProxy(
    methods: Record<string, string[]>,
    invokeRpc: InvokeRpcFn
): object {
    const coreListTags = methods['core']?.includes('list_tags')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('core', 'list_tags', args)
        : (): Promise<unknown> =>
              wrapPromise(
                  Promise.resolve(wrapResult({ success: false, code: 'CONFIGURATION_ERROR', error: 'list_tags is not enabled' })),
                  'list_tags'
              )

    const adminMergeTags = methods['admin']?.includes('merge_tags')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'merge_tags', args)
        : (): Promise<unknown> =>
              wrapPromise(
                  Promise.resolve(wrapResult({ success: false, code: 'CONFIGURATION_ERROR', error: 'merge_tags is not enabled' })),
                  'merge_tags'
              )

    const tagsCallable = (...args: unknown[]): Promise<unknown> => coreListTags(...args)
    Object.assign(tagsCallable, {
        list: coreListTags,
        listTags: coreListTags,
        list_tags: coreListTags,
        get: coreListTags,
        getTags: coreListTags,
        get_tags: coreListTags,
        getAll: coreListTags,
        all: coreListTags,
        merge: adminMergeTags,
        mergeTags: adminMergeTags,
        merge_tags: adminMergeTags,
    })
    return new Proxy(tagsCallable, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply: (_t, _thisArg, args: unknown[]) => coreListTags(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string') {
                const compact = compactMethodName(p)
                if (TAG_MERGE_METHODS.has(compact)) return adminMergeTags
                if (TAG_LIST_METHODS.has(compact)) return coreListTags
            }
            return Reflect.get(t, p) as unknown
        },
    })
}

/**
 * Builds the `mj.system` / `mj.adapters` virtual namespace proxy.
 */
export function createSystemProxy(
    methods: Record<string, string[]>,
    invokeRpc: InvokeRpcFn
): object {
    const getStats = methods['analytics']?.includes('get_statistics')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('analytics', 'get_statistics', args)
        : (): Promise<unknown> =>
              wrapPromise(
                  Promise.resolve(wrapResult({ success: false, code: 'CONFIGURATION_ERROR', error: 'get_statistics is not enabled' })),
                  'get_statistics'
              )

    const systemCallable = (...args: unknown[]): Promise<unknown> => getStats(...args)
    const statsKeys = [
        'getStatistics', 'getStats', 'stats', 'serverInfo', 'server_info', 'serverHealth',
        'server_health', 'serverStatus', 'server_status', 'healthCheck', 'health_check',
        'diagnostics', 'getDiagnostics', 'systemInfo', 'system_info', 'info', 'getInfo',
        'health', 'getHealth', 'status', 'getStatus', 'adapters', 'listAdapters',
        'list_adapters', 'getAdapters', 'get_adapters',
    ]
    const systemObj: Record<string, unknown> = {
        ping: (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true, status: 'pong' })), 'ping'),
        version: (): Promise<unknown> =>
            wrapPromise(Promise.resolve(wrapResult({ success: true, version: PACKAGE_VERSION, name: 'memory-journal-mcp' })), 'version'),
    }
    for (const k of statsKeys) systemObj[k] = getStats
    Object.assign(systemCallable, systemObj)
    return new Proxy(systemCallable, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply: (_t, _thisArg, args: unknown[]) => getStats(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string') {
                if (SYSTEM_STATS_METHODS.has(compactMethodName(p))) return getStats
            }
            return Reflect.get(t, p) as unknown
        },
    })
}

const CONTEXT_METHOD_KEYS = new Set(['get', 'getContext', 'get_context', 'find', 'list'])

function buildContextProxyHandler(
    contextData: Record<string, unknown>,
    getContextRpc: (keyOrObj?: unknown) => Promise<unknown>
): ProxyHandler<(...args: unknown[]) => Promise<unknown>> {
    const resolveContextProp = (t: (...args: unknown[]) => Promise<unknown>, p: string): unknown => {
        if (p === 'length' || p === 'name') return Reflect.get(t, p) as unknown
        if (CONTEXT_METHOD_KEYS.has(p)) return getContextRpc
        if (Object.hasOwn(contextData, p)) return contextData[p]
        return Reflect.get(t, p) as unknown
    }
    return {
        ...IMMUTABLE_PROXY_TRAPS,
        apply: (_t, _thisArg, args: unknown[]) => getContextRpc(args[0]),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            return resolveContextProp(t, p)
        },
        has(t, p): boolean {
            if (typeof p === 'string' && (CONTEXT_METHOD_KEYS.has(p) || Object.hasOwn(contextData, p))) {
                return true
            }
            return Reflect.has(t, p)
        },
        ownKeys(t): (string | symbol)[] {
            return Array.from(
                new Set<string | symbol>([
                    ...Reflect.ownKeys(t),
                    ...CONTEXT_METHOD_KEYS,
                    ...Object.keys(contextData),
                ])
            )
        },
        getOwnPropertyDescriptor(t, p): PropertyDescriptor | undefined {
            if (p === 'length' || p === 'name' || Object.hasOwn(t, p)) {
                return Reflect.getOwnPropertyDescriptor(t, p)
            }
            if (typeof p === 'string' && (CONTEXT_METHOD_KEYS.has(p) || Object.hasOwn(contextData, p))) {
                return {
                    enumerable: true,
                    configurable: true,
                    writable: false,
                    value: CONTEXT_METHOD_KEYS.has(p) ? getContextRpc : contextData[p],
                }
            }
            return undefined
        },
    }
}

/**
 * Builds the `mj.context` virtual namespace proxy and `getContext` RPC helper.
 */
export function createContextNamespaceProxy(
    contextObj?: Record<string, unknown>,
    isAlreadyDeepFrozen = false
): {
    contextProxy: object
    getContextRpc: (keyOrObj?: unknown) => Promise<unknown>
} {
    const projNum = contextObj?.['project_number'] ?? contextObj?.['projectNumber']
    const sessId = contextObj?.['session_id'] ?? contextObj?.['sessionId'] ?? 'session-default'
    const wsId = contextObj?.['workspace_id'] ?? contextObj?.['workspaceId']
    const rawContextData: Record<string, unknown> = Object.assign(
        createNullProtoRecord(),
        {
            success: true,
            ...(projNum !== undefined
                ? { project_number: projNum, projectNumber: projNum, project_id: projNum, projectId: projNum }
                : {}),
            session_id: sessId,
            sessionId: sessId,
            ...(wsId !== undefined ? { workspace_id: wsId, workspaceId: wsId } : {}),
        },
        contextObj ?? {}
    )
    const contextData = isAlreadyDeepFrozen
        ? Object.freeze(rawContextData)
        : deepFreezeContextClone(rawContextData)

    const getContextRpc = (keyOrObj?: unknown): Promise<unknown> => {
        if (typeof keyOrObj === 'string') {
            if (Object.hasOwn(contextData, keyOrObj)) {
                return wrapPromise(Promise.resolve(wrapResult(contextData[keyOrObj])), 'get_context')
            }
            const snakeKey = /[A-Z]/.test(keyOrObj)
                ? keyOrObj.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                : undefined
            if (snakeKey !== undefined && Object.hasOwn(contextData, snakeKey)) {
                return wrapPromise(Promise.resolve(wrapResult(contextData[snakeKey])), 'get_context')
            }
            return wrapPromise(
                Promise.resolve(
                    wrapResult({
                        success: false,
                        error: `Context key '${keyOrObj}' was not found`,
                        code: 'RESOURCE_NOT_FOUND',
                        category: 'resource',
                        recoverable: true,
                    })
                ),
                'get_context'
            )
        }
        return wrapPromise(Promise.resolve(wrapResult(contextData)), 'get_context')
    }

    const contextCallable = (...args: unknown[]): Promise<unknown> => getContextRpc(args[0])
    return { contextProxy: new Proxy(contextCallable, buildContextProxyHandler(contextData, getContextRpc)), getContextRpc }
}
