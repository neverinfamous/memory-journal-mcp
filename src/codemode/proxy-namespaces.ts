/**
 * Worker API Proxy Namespaces — virtual namespace builders (`schema`, `projects`,
 * `tags`, `system`, `context`) attached to `mj.*`.
 */

import { wrapResult } from './worker-result-proxy.js'
import { wrapPromise } from './proxy-helpers.js'
import { VERSION } from '../version.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES } from '../handlers/tools/schemas/constants-and-primitives.js'

export type InvokeRpcFn = (group: string, method: string, args: unknown[]) => Promise<unknown>
export type SafeRpcCallFn = (group: string, method: string, args: unknown[]) => Promise<unknown>

const TABLES = [
    'memory_journal',
    'tags',
    'entry_tags',
    'relationships',
    'entry_anchors',
    'entry_revisions',
    'vec_embeddings',
    'team_flags',
]

/**
 * Builds the `mj.schema` virtual namespace proxy.
 */
export function createSchemaProxy(safeRpcCall: SafeRpcCallFn): object {
    const schemaHelp = (): Promise<unknown> =>
        Promise.resolve({
            group: 'schema',
            description:
                'Memory Journal Schema: Embedded SQLite database storing journal entries, tags, relationships, code anchors, revisions, vector embeddings, and team flags.',
            tables: TABLES,
            entrySchema: {
                id: 'number (auto-increment primary key)',
                content: 'string (required, markdown body)',
                entry_type: ENTRY_TYPES.map((t) => `'${t}'`).join(' | '),
                timestamp: 'string (ISO 8601 timestamp)',
                is_personal: 'boolean (default: true)',
                significance_type: `optional (${SIGNIFICANCE_TYPES.map((t) => `'${t}'`).join(' | ')})`,
                tags: 'string[] (optional array of kebab-case tags)',
                workspace_id: 'string (required repository/workspace identifier)',
                project_number: 'number (optional GitHub project number)',
                impact_score: 'number (0.0-1.0 blast radius score)',
                trust_score: 'number (0.0-1.0 confidence score)',
                validation_status: "'passed' | 'none' | 'failed'",
                auto_context: 'string (optional JSON metadata string, e.g. { "commits": ["<sha>"] })',
                session_id: 'string (optional session tracking id)',
                relationships: 'Array<{ targetId: number, relationType?: string }> (optional entry links)',
                anchors: 'Array<{ anchor_path: string, anchor_type: string, status?: string }> (optional code anchors)',
            },
            methods: ['help', 'describe', 'listTables', 'describeTable', 'getSchema'],
            usage: 'Use mj.core.createEntry.schema() for entry parameter details, or mj.analytics.getStatistics() for database statistics.',
        })

    const schemaCallable = (..._args: unknown[]): Promise<unknown> =>
        safeRpcCall('analytics', 'get_statistics', []).then(wrapResult)

    return new Proxy(schemaCallable, {
        apply: (_t, _thisArg, args) => safeRpcCall('analytics', 'get_statistics', args).then(wrapResult),
        get(_t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p === 'help' || p === 'describe' || p === 'describeTable' || p === 'getSchema') return schemaHelp
            if (p === 'listTables') return () => Promise.resolve({ success: true, tables: TABLES })
            if (p === 'tables') return TABLES
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
        : methods['analytics']?.includes('get_cross_project_insights')
          ? (...args: unknown[]): Promise<unknown> => invokeRpc('analytics', 'get_cross_project_insights', args)
          : (): Promise<unknown> =>
                wrapPromise(Promise.resolve(wrapResult({ success: true, projects: {}, items: [], data: [] })), 'list_projects')

    const adminGetProject = methods['admin']?.includes('get_project')
        ? (nameOrParams: unknown): Promise<unknown> => {
              const params =
                  typeof nameOrParams === 'string' || typeof nameOrParams === 'number'
                      ? [{ name: String(nameOrParams) }]
                      : [nameOrParams ?? {}]
              return invokeRpc('admin', 'get_project', params)
          }
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'get_project')

    const adminRegisterProject = methods['admin']?.includes('register_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'register_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'register_project')

    const adminUpdateProject = methods['admin']?.includes('update_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'update_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'update_project')

    const adminDeleteProject = methods['admin']?.includes('delete_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'delete_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'delete_project')

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
        apply: (_t, _thisArg, args: unknown[]) => adminListProjects(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string') {
                const low = p.toLowerCase()
                if (low.includes('list') || low.includes('all') || (low.includes('get') && low.endsWith('s'))) {
                    return adminListProjects
                }
                if (low.includes('get') || low.includes('find')) return adminGetProject
                if (low.includes('create') || low.includes('register') || low.includes('add')) return adminRegisterProject
                if (low.includes('update') || low.includes('edit')) return adminUpdateProject
                if (low.includes('delete') || low.includes('remove')) return adminDeleteProject
            }
            return adminListProjects
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
              wrapPromise(Promise.resolve(wrapResult({ success: true, tags: [], count: 0 })), 'list_tags')

    const adminMergeTags = methods['admin']?.includes('merge_tags')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'merge_tags', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'merge_tags')

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
        apply: (_t, _thisArg, args: unknown[]) => coreListTags(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string' && p.toLowerCase().includes('merge')) return adminMergeTags
            return coreListTags
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
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'get_statistics')

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
            wrapPromise(Promise.resolve(wrapResult({ success: true, version: VERSION, name: 'memory-journal-mcp' })), 'version'),
    }
    for (const k of statsKeys) systemObj[k] = getStats
    Object.assign(systemCallable, systemObj)
    return new Proxy(systemCallable, {
        apply: (_t, _thisArg, args: unknown[]) => getStats(...args),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            return getStats
        },
    })
}

/**
 * Builds the `mj.context` virtual namespace proxy and `getContext` RPC helper.
 */
export function createContextNamespaceProxy(contextObj?: Record<string, unknown>): {
    contextProxy: object
    getContextRpc: (keyOrObj?: unknown) => Promise<unknown>
} {
    const projNum = contextObj?.['project_number'] ?? contextObj?.['projectNumber'] ?? 1
    const sessId = contextObj?.['session_id'] ?? contextObj?.['sessionId'] ?? 'session-default'
    const wsId = contextObj?.['workspace_id'] ?? contextObj?.['workspaceId'] ?? 'default'
    const projId = contextObj?.['project_id'] ?? contextObj?.['projectId'] ?? projNum
    const contextData: Record<string, unknown> = {
        success: true,
        project_number: projNum,
        projectNumber: projNum,
        session_id: sessId,
        sessionId: sessId,
        workspace_id: wsId,
        workspaceId: wsId,
        project_id: projId,
        projectId: projId,
        ...(contextObj ?? {}),
    }

    const getContextRpc = (keyOrObj?: unknown): Promise<unknown> => {
        if (typeof keyOrObj === 'string' && keyOrObj in contextData) {
            return wrapPromise(Promise.resolve(wrapResult(contextData[keyOrObj])), 'get_context')
        }
        return wrapPromise(Promise.resolve(wrapResult(contextData)), 'get_context')
    }

    const contextCallable = (...args: unknown[]): Promise<unknown> => getContextRpc(args[0])
    Object.assign(contextCallable, {
        get: getContextRpc,
        getContext: getContextRpc,
        get_context: getContextRpc,
        find: getContextRpc,
        list: getContextRpc,
        ...contextData,
    })

    const contextProxy = new Proxy(contextCallable, {
        apply: (_t, _thisArg, args: unknown[]) => getContextRpc(args[0]),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            if (typeof p === 'string') {
                if (['get', 'getContext', 'get_context', 'find', 'list'].includes(p)) return getContextRpc
                if (p in contextData) return contextData[p]
            }
            return Reflect.get(t, p) as unknown
        },
    })

    return { contextProxy, getContextRpc }
}
