/**
 * Worker `shimMj` Domain Builders — specialized sub-proxies and interceptors
 * (`adapters`, `entries`, `projects`, `db`, `system`, `search`, `append`, etc.)
 * used by `createShimMjProxy`.
 */

import { VERSION } from '../../version.js'
import { createPreparedStatementShim } from './node-shims.js'
import { createCallableShim, createSchemaShim } from './namespace-shims.js'

function getGroupProp(target: Record<string, unknown>, group: string, prop: string): unknown {
    const g = target[group]
    return (typeof g === 'object' && g !== null) || typeof g === 'function'
        ? (Reflect.get(g, prop) as unknown)
        : undefined
}

const ADAPTER_ITEMS = [
    { name: 'sqlite', type: 'database', driver: 'better-sqlite3', status: 'connected', primary: true, description: 'Primary SQLite storage engine for journal entries, tags, and relationships' },
    { name: 'sqlite-vec', type: 'vector', driver: 'sqlite-vec', status: 'connected', description: 'Native vector embeddings and semantic search engine' },
    { name: 'team', type: 'database', driver: 'better-sqlite3', status: 'connected', description: 'Collaborative team journal database adapter' },
    { name: 'github', type: 'integration', driver: 'octokit / gh', status: 'connected', description: 'GitHub synchronization and issue tracking adapter' },
]

export function createAdaptersShim(prop: string): object {
    const returnAdapters = (): Promise<unknown> =>
        Promise.resolve({
            success: true,
            adapters: ADAPTER_ITEMS,
            default_adapter: 'sqlite',
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${prop}' was called. Returned registered database and service adapters successfully.`,
        })
    const callable = (): Promise<unknown> => returnAdapters()
    Object.assign(callable, {
        list: returnAdapters,
        listAdapters: returnAdapters,
        list_adapters: returnAdapters,
        get: returnAdapters,
    })
    return new Proxy(callable, {
        apply: () => returnAdapters(),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            return returnAdapters
        },
    })
}

const RESOURCE_SUGGESTIONS: Record<string, string> = {
    'memory://agent-id': 'mj.core.getStatistics() or mj.core.listProjects()',
    'memory://recent': 'mj.core.getRecentEntries()',
    'memory://statistics': 'mj.analytics.getStatistics()',
    'memory://tags': 'mj.core.listTags()',
    'memory://flags': 'mj.team.teamListFlags({ status: "active" })',
    'memory://significant': 'mj.search.searchEntries({ sort_by: "importance" })',
    'memory://insights': 'mj.analytics.getCrossProjectInsights()',
}

export function createShimReadResourceHandler(): (uri?: string) => Promise<unknown> {
    return (uri?: string) => {
        let hint = ''
        if (typeof uri === 'string') {
            const match = Object.entries(RESOURCE_SUGGESTIONS).find(
                ([k]) =>
                    uri === k ||
                    uri.startsWith(k + '/') ||
                    uri.startsWith(k + '?') ||
                    uri.startsWith(k + '#')
            )
            if (match !== undefined) hint = ` Try: ${match[1]}`
        }
        return Promise.resolve({
            success: false,
            error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        })
    }
}

const ENTRY_SEARCH_ALIASES = new Set([
    'find', 'query', 'queryEntries', 'query_entries', 'findEntries', 'find_entries', 'findByQuery',
])
const ENTRY_CREATE_ALIASES = new Set([
    'insert', 'append', 'newEntry', 'addEntry', 'add_entry', 'insertNew', 'write', 'save',
])
const ENTRY_GET_ALIASES = new Set([
    'fetch', 'read', 'getEntry', 'get_entry', 'fetchById', 'findById', 'getById',
])
const ENTRY_UPDATE_ALIASES = new Set([
    'edit', 'patch', 'modify', 'patchEntry', 'editEntry',
])
const ENTRY_DELETE_ALIASES = new Set([
    'remove', 'removeEntry', 'removeItem', 'deleteItem',
])
const ENTRY_LIST_ALIASES = new Set([
    'recent', 'all', 'getAll', 'listAll', 'fetchEntries',
])

export function createEntriesDomainProxy(target: Record<string, unknown>): unknown {
    const listFunc = getGroupProp(target, 'core', 'get_recent_entries') ?? getGroupProp(target, 'core', 'getRecentEntries')
    if (typeof listFunc !== 'function') return undefined

    const callableEntries = function (this: unknown, ...args: unknown[]): unknown {
        return (listFunc as (...a: unknown[]) => unknown).apply(this, args)
    }

    const createFn = getGroupProp(target, 'core', 'create_entry') ?? getGroupProp(target, 'core', 'createEntry')
    const getFn = getGroupProp(target, 'core', 'get_entry_by_id') ?? getGroupProp(target, 'core', 'getEntryById')
    const updateFn =
        getGroupProp(target, 'admin', 'update_entry') ??
        getGroupProp(target, 'admin', 'updateEntry') ??
        getGroupProp(target, 'core', 'update_entry') ??
        getGroupProp(target, 'core', 'updateEntry')
    const deleteFn =
        getGroupProp(target, 'admin', 'delete_entry') ??
        getGroupProp(target, 'admin', 'deleteEntry') ??
        getGroupProp(target, 'core', 'delete_entry') ??
        getGroupProp(target, 'core', 'deleteEntry')
    const searchFn =
        getGroupProp(target, 'search', 'search_entries') ??
        getGroupProp(target, 'search', 'searchEntries') ??
        getGroupProp(target, 'core', 'search_entries') ??
        getGroupProp(target, 'core', 'searchEntries')

    Object.assign(callableEntries, {
        create: createFn, createEntry: createFn, create_entry: createFn, add: createFn, push: createFn,
        get: getFn, getEntryById: getFn, get_entry_by_id: getFn,
        update: updateFn, updateEntry: updateFn, update_entry: updateFn,
        delete: deleteFn, deleteEntry: deleteFn, delete_entry: deleteFn,
        search: searchFn, searchEntries: searchFn, search_entries: searchFn,
        list: listFunc, listEntries: listFunc, list_entries: listFunc,
        getRecent: listFunc, getRecentEntries: listFunc, get_recent_entries: listFunc,
    })

    return new Proxy(callableEntries, {
        get(targetFn, p, receiver): unknown {
            if (p in targetFn) return Reflect.get(targetFn, p, receiver) as unknown
            if (typeof p === 'string') {
                // [M7] Exact aliases are checked before the fuzzy group-namespace fallback.
                if (ENTRY_SEARCH_ALIASES.has(p) && typeof searchFn === 'function') return searchFn
                if (ENTRY_CREATE_ALIASES.has(p) && typeof createFn === 'function') return createFn
                if (ENTRY_GET_ALIASES.has(p) && typeof getFn === 'function') return getFn
                if (ENTRY_UPDATE_ALIASES.has(p) && typeof updateFn === 'function') return updateFn
                if (ENTRY_DELETE_ALIASES.has(p) && typeof deleteFn === 'function') return deleteFn
                if (ENTRY_LIST_ALIASES.has(p)) return listFunc
                if (p === 'listDeletedEntries' || p === 'list_deleted_entries') {
                    const listDeleted =
                        getGroupProp(target, 'search', 'list_deleted_entries') ??
                        getGroupProp(target, 'search', 'listDeletedEntries')
                    if (typeof listDeleted === 'function') return listDeleted
                    return () =>
                        Promise.resolve({
                            success: false,
                            error: 'listDeletedEntries is not available',
                            code: 'VALIDATION_ERROR',
                        })
                }
                const methodOnCore = getGroupProp(target, 'core', p) ?? getGroupProp(target, 'search', p) ?? getGroupProp(target, 'admin', p)
                if (typeof methodOnCore === 'function') return methodOnCore
            }
            return Reflect.get(targetFn, p, receiver) as unknown
        },
    })
}

export function createGetReadFindInterceptor(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): (arg?: unknown) => unknown {
    const getFn = getGroupProp(target, 'core', 'get_entry_by_id') ?? getGroupProp(target, 'core', 'getEntryById')
    const searchFn = getGroupProp(target, 'search', 'search_entries') ?? getGroupProp(target, 'search', 'searchEntries')
    return (arg?: unknown): unknown => {
        if (arg === undefined) return Promise.resolve(shimMj)
        if (typeof arg === 'number' || typeof arg === 'string') {
            const parsedId = Number(arg)
            if (!Number.isNaN(parsedId)) {
                return typeof getFn === 'function' ? (getFn as (a: unknown) => unknown)({ entry_id: parsedId }) : undefined
            }
            if (typeof arg === 'string') {
                return typeof searchFn === 'function'
                    ? (searchFn as (a: unknown) => unknown)({ query: arg })
                    : Promise.resolve({
                          success: false,
                          code: 'VALIDATION_ERROR',
                          error: 'Search function unavailable',
                      })
            }
        }
        if (arg !== null && typeof arg === 'object') {
            if ('entry_id' in arg || 'id' in arg) {
                return typeof getFn === 'function' ? (getFn as (a: unknown) => unknown)(arg) : undefined
            }
            if ('query' in arg || 'tags' in arg || 'search' in arg || 'text' in arg || 'q' in arg) {
                return typeof searchFn === 'function' ? (searchFn as (a: unknown) => unknown)(arg) : undefined
            }
        }
        return typeof getFn === 'function' ? (getFn as (a: unknown) => unknown)(arg) : undefined
    }
}

export function createShimProjectsDomain(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): object {
    const baseProjectsProxy = target['projects']
    const listProjectsFn =
        getGroupProp(target, 'admin', 'listProjects') ??
        getGroupProp(target, 'admin', 'list_projects') ??
        getGroupProp(target, 'core', 'listProjects') ??
        getGroupProp(target, 'core', 'list_projects')
    const createFn = getGroupProp(target, 'core', 'create_entry') ?? getGroupProp(target, 'core', 'createEntry')
    const insightsFn =
        getGroupProp(target, 'analytics', 'get_cross_project_insights') ??
        getGroupProp(target, 'analytics', 'getCrossProjectInsights')

    const projectsFn = function (this: unknown, ...args: unknown[]): unknown {
        if (typeof baseProjectsProxy === 'function') {
            return (baseProjectsProxy as (...a: unknown[]) => unknown).apply(this, args)
        }
        if (typeof listProjectsFn === 'function') {
            return (listProjectsFn as (...a: unknown[]) => unknown).apply(this, args)
        }
        return Promise.resolve({
            success: true,
            projects: {},
            items: [],
            data: [],
            _healing_note:
                "🛠️ AUTONOMOUS HEALING: 'mj.projects()' was called without 'list_projects' bound in the current tool filter; returned empty project collection.",
        })
    }

    return new Proxy(projectsFn, {
        apply(_t, thisArg, args: unknown[]): unknown {
            return projectsFn.apply(thisArg, args)
        },
        get(_t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p === 'entries') return { create: createFn, add: createFn }
            if ((p === 'list' || p === 'listProjects' || p === 'list_projects' || p === 'getAll') && typeof listProjectsFn === 'function') {
                return listProjectsFn
            }
            if (p === 'insights' && typeof insightsFn === 'function') {
                return (...args: unknown[]): unknown => (insightsFn as (...a: unknown[]) => unknown)(...args)
            }
            if (typeof baseProjectsProxy === 'function' || (typeof baseProjectsProxy === 'object' && baseProjectsProxy !== null)) {
                return Reflect.get(baseProjectsProxy, p) as unknown
            }
            return createCallableShim(shimMj)
        },
    })
}

const STATS_METHOD_KEYS = new Set([
    'getStatistics', 'getStats', 'stats', 'info', 'getInfo', 'getDatabaseInfo', 'databaseInfo',
    'getHealth', 'health', 'status', 'getStatus', 'serverInfo', 'server_info', 'serverHealth',
    'server_health', 'serverStatus', 'server_status', 'healthCheck', 'health_check',
    'diagnostics', 'getDiagnostics', 'systemInfo', 'system_info', 'adapters', 'listAdapters',
    'list_adapters', 'getAdapters', 'get_adapters',
])

export function createDbDomainProxy(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): object {
    const getStatsFn = getGroupProp(target, 'analytics', 'getStatistics') ?? getGroupProp(target, 'analytics', 'get_statistics')

    return new Proxy({}, {
        get(_t, dbProp): unknown {
            if (typeof dbProp === 'symbol' || dbProp === 'then') return undefined
            if (dbProp === 'schema') return createSchemaShim(shimMj)
            if (dbProp === 'help' || dbProp === 'describe') {
                const helpFn = target['help']
                return () => (typeof helpFn === 'function' ? (helpFn as () => unknown)() : undefined)
            }
            if (dbProp === 'prepare' || dbProp === 'stmt' || dbProp === 'statement') {
                return (sql?: string) => createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
            }
            if (dbProp === 'exec') {
                return (sql?: string) => {
                    const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                    const runFn = stmt['run']
                    return typeof runFn === 'function' ? (runFn as () => unknown)() : undefined
                }
            }
            if (dbProp === 'query' || dbProp === 'raw') {
                return (sql?: string) => {
                    const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                    const allFn = stmt['all']
                    return typeof allFn === 'function' ? (allFn as () => unknown)() : undefined
                }
            }
            if (dbProp === 'close' || dbProp === 'dispose' || dbProp === 'disconnect') {
                return () => ({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error: `${dbProp} is not executed in the sandbox`,
                })
            }
            if (dbProp === 'getDatabase' || dbProp === 'getDb' || dbProp === 'get_database' || dbProp === 'get_db') {
                return () => shimMj
            }
            if (dbProp === 'ping') return () => Promise.resolve({ success: true, status: 'pong' })
            if (dbProp === 'version') {
                return () => Promise.resolve({ success: true, version: VERSION, name: 'memory-journal-mcp' })
            }
            if (STATS_METHOD_KEYS.has(dbProp) && typeof getStatsFn === 'function') return getStatsFn
            return (..._args: unknown[]) =>
                Promise.resolve({
                    success: false,
                    error: `Direct SQLite database access 'mj.db.${dbProp}()' is not available in Code Mode sandbox. Use high-level API methods instead: mj.core.createEntry({ ... }), mj.core.getRecentEntries({ ... }), or mj.search.searchEntries({ ... }).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Use mj.core or mj.search methods.',
                    recoverable: true,
                })
        },
    })
}

export function createSystemDatabaseDomainProxy(
    target: Record<string, unknown>,
    _shimMj: Record<string, unknown>
): object {
    if (typeof target['system'] === 'function' || (typeof target['system'] === 'object' && target['system'] !== null)) {
        return target['system']
    }
    const getStatsFn = getGroupProp(target, 'analytics', 'getStatistics') ?? getGroupProp(target, 'analytics', 'get_statistics')
    const dbShim: Record<string, unknown> = {
        ping: () => Promise.resolve({ success: true, status: 'pong' }),
        version: () => Promise.resolve({ success: true, version: VERSION, name: 'memory-journal-mcp' }),
    }
    for (const k of STATS_METHOD_KEYS) dbShim[k] = getStatsFn
    return new Proxy(dbShim, {
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (typeof p === 'string' && p in t) return t[p]
            return (..._args: unknown[]) =>
                Promise.resolve({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    error: `Unknown database/system operation '${p}'`,
                    recoverable: true,
                })
        },
    })
}

export function createSearchDomainProxy(target: Record<string, unknown>): unknown {
    const searchGroup = target['search']
    if ((typeof searchGroup !== 'object' || searchGroup === null) && typeof searchGroup !== 'function') {
        return undefined
    }
    const searchFunc = (Reflect.get(searchGroup, 'search_entries') as unknown) ?? (Reflect.get(searchGroup, 'searchEntries') as unknown)
    if (typeof searchFunc === 'function') {
        const callableSearch = function (this: unknown, ...args: unknown[]): unknown {
            return (searchFunc as (...a: unknown[]) => unknown).apply(this, args)
        }
        Object.assign(callableSearch, searchGroup, {
            search: searchFunc, query: searchFunc, queryEntries: searchFunc, query_entries: searchFunc,
            searchEntries: searchFunc, search_entries: searchFunc, find: searchFunc,
            findEntries: searchFunc, find_entries: searchFunc,
        })
        return new Proxy(callableSearch, {
            get(targetFn, p, receiver): unknown {
                if (p in targetFn) return Reflect.get(targetFn, p, receiver) as unknown
                return Reflect.get(searchGroup, p, receiver) as unknown
            },
        })
    }
    return searchGroup
}

function readAppendMetadata(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
        record[key] = entry
    }
    return record
}

export function createAppendInterceptor(
    target: Record<string, unknown>
): ((arg1: unknown, arg2: unknown, arg3: unknown) => unknown) | undefined {
    const createEntry = getGroupProp(target, 'core', 'createEntry')
    if (typeof createEntry !== 'function') return undefined
    return (arg1: unknown, arg2: unknown, arg3: unknown): unknown => {
        const tags = Array.isArray(arg1) ? arg1 : [typeof arg1 === 'string' ? arg1 : 'test']
        const content = typeof arg2 === 'string' ? arg2 : arg2 !== null && arg2 !== undefined ? JSON.stringify(arg2) : ''
        const metadata = readAppendMetadata(arg3)

        const typeVal = metadata?.['type']
        const type = typeof typeVal === 'string' && typeVal !== '' ? typeVal : 'test_entry'
        const payload: Record<string, unknown> = { type, tags, content }
        if (metadata !== undefined) {
            const wsId = metadata['workspace_id'] ?? metadata['workspaceId']
            if (typeof wsId === 'string' && wsId.trim() !== '') payload['workspace_id'] = wsId
            const projNum = metadata['project_number'] ?? metadata['projectNumber'] ?? metadata['project']
            if (
                (typeof projNum === 'number' && !Number.isNaN(projNum)) ||
                (typeof projNum === 'string' && projNum.trim() !== '')
            ) {
                payload['project_number'] = projNum
            }
        }

        return (createEntry as (args: unknown) => unknown)(payload)
    }
}
