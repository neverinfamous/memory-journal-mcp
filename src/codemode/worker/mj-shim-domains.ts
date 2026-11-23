/**
 * Worker `shimMj` Domain Builders — specialized sub-proxies and interceptors
 * (`adapters`, `entries`, `projects`, `db`, `system`, `search`, `append`, etc.)
 * used by `createShimMjProxy`.
 */

import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { wrapResult } from '../worker-result-proxy.js'
import { wrapPromise } from '../proxy-helpers.js'
import { IMMUTABLE_PROXY_TRAPS } from './result-proxy-aliases.js'
import { createCallableShim } from './namespace-shims.js'
export {
    createAdaptersShim,
    createShimReadResourceHandler,
    createDbDomainProxy,
    createSystemDatabaseDomainProxy,
} from './mj-shim-db-domains.js'

function getGroupProp(target: Record<string, unknown>, group: string, prop: string): unknown {
    const g = target[group]
    return (typeof g === 'object' && g !== null) || typeof g === 'function'
        ? (Reflect.get(g, prop) as unknown)
        : undefined
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
        ...IMMUTABLE_PROXY_TRAPS,
    })
}

export function createGetReadFindInterceptor(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): (...args: unknown[]) => unknown {
    const getFn = getGroupProp(target, 'core', 'get_entry_by_id') ?? getGroupProp(target, 'core', 'getEntryById')
    const searchFn = getGroupProp(target, 'search', 'search_entries') ?? getGroupProp(target, 'search', 'searchEntries')
    return (...args: unknown[]): unknown => {
        const [arg, ...rest] = args
        if (arg === undefined) return Promise.resolve(shimMj)
        if (typeof arg === 'number' || typeof arg === 'string') {
            const parsedId = parsePositiveProjectNumber(arg)
            if (parsedId !== undefined) {
                return typeof getFn === 'function'
                    ? (getFn as (...a: unknown[]) => unknown)({ entry_id: parsedId }, ...rest)
                    : undefined
            }
            if (typeof arg === 'string') {
                return typeof searchFn === 'function'
                    ? (searchFn as (...a: unknown[]) => unknown)({ query: arg }, ...rest)
                    : Promise.resolve({
                          success: false,
                          code: 'VALIDATION_ERROR',
                          error: 'Search function unavailable',
                      })
            }
        }
        if (arg !== null && typeof arg === 'object') {
            if ('entry_id' in arg || 'id' in arg) {
                return typeof getFn === 'function' ? (getFn as (...a: unknown[]) => unknown)(...args) : undefined
            }
            if ('query' in arg || 'tags' in arg || 'search' in arg || 'text' in arg || 'q' in arg) {
                return typeof searchFn === 'function' ? (searchFn as (...a: unknown[]) => unknown)(...args) : undefined
            }
        }
        return typeof getFn === 'function' ? (getFn as (...a: unknown[]) => unknown)(...args) : undefined
    }
}

const disabledProjectTool = (tool: string) => (): Promise<unknown> =>
    wrapPromise(
        Promise.resolve(
            wrapResult({
                success: false,
                error: `Tool '${tool}' is not available in this sandbox.`,
                code: 'TOOL_DISABLED',
                _healing_note: `🛠️ AUTONOMOUS HEALING: 'mj.projects.${tool}()' requires '${tool}' to be enabled in the active tool filter.`,
            })
        ),
        tool
    )

const PROJECT_LIST_PROPS = new Set([
    'list', 'listProjects', 'list_projects', 'getAll', 'all', 'getProjects', 'get_projects',
])

const DISABLED_PROJECT_PROP_MAP: Record<string, string> = Object.assign(
    Object.create(null) as Record<string, string>,
    {
        get: 'get_project',
        getProject: 'get_project',
        get_project: 'get_project',
        find: 'get_project',
        register: 'register_project',
        registerProject: 'register_project',
        register_project: 'register_project',
        update: 'update_project',
        updateProject: 'update_project',
        update_project: 'update_project',
        delete: 'delete_project',
        deleteProject: 'delete_project',
        delete_project: 'delete_project',
        remove: 'delete_project',
    }
)

function resolveProjectDomainProp(
    p: string | symbol,
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>,
    projectsFn: () => unknown
): unknown {
    if (typeof p === 'symbol' || p === 'then') return undefined
    const createFn =
        getGroupProp(target, 'core', 'create_entry') ?? getGroupProp(target, 'core', 'createEntry')
    if (p === 'entries') return Object.freeze({ create: createFn, add: createFn })
    const listProjectsFn =
        getGroupProp(target, 'admin', 'listProjects') ??
        getGroupProp(target, 'admin', 'list_projects') ??
        getGroupProp(target, 'core', 'listProjects') ??
        getGroupProp(target, 'core', 'list_projects')
    if (PROJECT_LIST_PROPS.has(p)) {
        return typeof listProjectsFn === 'function' ? listProjectsFn : projectsFn
    }
    const insightsFn =
        getGroupProp(target, 'analytics', 'get_cross_project_insights') ??
        getGroupProp(target, 'analytics', 'getCrossProjectInsights')
    if (p === 'insights' && typeof insightsFn === 'function') {
        return insightsFn
    }
    const baseProjectsProxy = target['projects']
    if (
        typeof baseProjectsProxy === 'function' ||
        (typeof baseProjectsProxy === 'object' && baseProjectsProxy !== null)
    ) {
        return Reflect.get(baseProjectsProxy, p) as unknown
    }
    const disabledName = DISABLED_PROJECT_PROP_MAP[p]
    return disabledName !== undefined ? disabledProjectTool(disabledName) : createCallableShim(shimMj)
}

export function createShimProjectsDomain(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): object {
    const projectsFn = function (this: unknown, ...args: unknown[]): unknown {
        const baseProjectsProxy = target['projects']
        if (typeof baseProjectsProxy === 'function') {
            return (baseProjectsProxy as (...a: unknown[]) => unknown).apply(this, args)
        }
        const listProjectsFn =
            getGroupProp(target, 'admin', 'listProjects') ??
            getGroupProp(target, 'admin', 'list_projects') ??
            getGroupProp(target, 'core', 'listProjects') ??
            getGroupProp(target, 'core', 'list_projects')
        if (typeof listProjectsFn === 'function') {
            return (listProjectsFn as (...a: unknown[]) => unknown).apply(this, args)
        }
        return disabledProjectTool('list_projects')()
    }

    return new Proxy(projectsFn, {
        apply(_t, thisArg, args: unknown[]): unknown {
            return projectsFn.apply(thisArg, args)
        },
        get(_t, p): unknown {
            return resolveProjectDomainProp(p, target, shimMj, projectsFn)
        },
        ...IMMUTABLE_PROXY_TRAPS,
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
        Object.assign(callableSearch, {
            search: searchFunc,
            query: searchFunc,
            queryEntries: searchFunc,
            query_entries: searchFunc,
            searchEntries: searchFunc,
            search_entries: searchFunc,
            find: searchFunc,
            findEntries: searchFunc,
            find_entries: searchFunc,
        })
        return new Proxy(callableSearch, {
            has: (targetFn, p): boolean => p in targetFn || p in searchGroup,
            ownKeys: (targetFn) =>
                Array.from(
                    new Set<string | symbol>([
                        ...Reflect.ownKeys(targetFn),
                        ...Reflect.ownKeys(searchGroup),
                    ])
                ),
            getOwnPropertyDescriptor(targetFn, p): PropertyDescriptor | undefined {
                const ownDesc = Reflect.getOwnPropertyDescriptor(targetFn, p)
                if (ownDesc !== undefined) return ownDesc
                const groupDesc = Reflect.getOwnPropertyDescriptor(searchGroup, p)
                return groupDesc !== undefined ? { ...groupDesc, configurable: true } : undefined
            },
            get(targetFn, p, receiver): unknown {
                if (p in targetFn) return Reflect.get(targetFn, p, receiver) as unknown
                return Reflect.get(searchGroup, p, receiver) as unknown
            },
            isExtensible: () => true,
            preventExtensions: () => false,
            set: () => false,
            defineProperty: () => false,
            deleteProperty: () => false,
            setPrototypeOf: () => false,
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

const APPEND_META_FIELDS = [
    'entry_type',
    'entryType',
    'title',
    'session_id',
    'sessionId',
    'significance_type',
    'significanceType',
    'impact_score',
    'impactScore',
    'trust_score',
    'trustScore',
    'validation_status',
    'validationStatus',
    'auto_context',
    'autoContext',
    'is_personal',
    'isPersonal',
    'project_name',
    'projectName',
    'anchors',
    'relationships',
] as const

export function createAppendInterceptor(
    target: Record<string, unknown>
): ((arg1: unknown, arg2?: unknown, arg3?: unknown) => unknown) | undefined {
    const createEntry = getGroupProp(target, 'core', 'createEntry')
    if (typeof createEntry !== 'function') return undefined
    const callCreate = createEntry as (args: unknown) => unknown
    return (arg1: unknown, arg2?: unknown, arg3?: unknown): unknown => {
        if (readAppendMetadata(arg1) !== undefined) return callCreate(arg1)
        if (typeof arg1 === 'string' && arg2 === undefined && arg3 === undefined) return callCreate(arg1)
        if (typeof arg1 === 'string' && arg3 === undefined) {
            const twoArgMeta = readAppendMetadata(arg2)
            if (twoArgMeta !== undefined) return callCreate({ ...twoArgMeta, content: arg1 })
        }

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
            for (const field of APPEND_META_FIELDS) {
                if (metadata[field] !== undefined && payload[field] === undefined) {
                    payload[field] = metadata[field]
                }
            }
        }

        return callCreate(payload)
    }
}
