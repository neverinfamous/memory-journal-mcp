/**
 * Worker `shimMj` Proxy — permissive top-level proxy that wraps `mjApi` to
 * smooth out common agent hallucinations across repositories and SDK patterns.
 */

import { type SafeFsShim, pathShim, consoleShim, createPreparedStatementShim } from './node-shims.js'
import { createDisabledSpawnShim } from './sandbox-process-shims.js'
import {
    DB_TO_JOURNAL,
    createCallableShim,
    createMaintenanceUnavailableFn,
    createSchemaShim,
    isDbMaintenanceCall,
} from './namespace-shims.js'
import {
    createAdaptersShim,
    createShimReadResourceHandler,
    createEntriesDomainProxy,
    createGetReadFindInterceptor,
    createShimProjectsDomain,
    createDbDomainProxy,
    createSystemDatabaseDomainProxy,
    createSearchDomainProxy,
    createAppendInterceptor,
} from './mj-shim-domains.js'

const SELF_REFERENTIAL_PROPS = new Set<string>([
    'mj', 'journal', 'journals', 'journal_entries', 'journalEntries',
    'memory', 'memory_journal', 'memory_journal_mcp', 'sqlite', 'sqlite3',
    'm', 'env', 'agent', 'mcp', 'mcpx', 'mc', 'memoryJournal', 'MemoryJournal',
    'mjJournal', 'mjClient', 'mj_client', 'app', 'tools', 'tool', 'api',
    'client', 'sdk', 'service', 'services', 'kernel', 'node', 'default',
    'codemode', 'codeMode',
])

const EXECUTE_CODE_PROPS = new Set<string>([
    'execute', 'executeCode', 'execute_code', 'mj_execute_code', 'mjExecuteCode',
])

const ADAPTER_PROPS = new Set<string>([
    'adapters', 'list_adapters', 'listAdapters', 'get_adapters', 'getAdapters',
])

const READ_RESOURCE_PROPS = new Set<string>([
    'readResource', 'read_resource', 'memory_read_resource', 'memoryReadResource',
    'getResource', 'get_resource',
])

const BRIEFING_PROPS = new Set<string>([
    'loadBriefing', 'load_briefing', 'getBriefing', 'get_briefing',
])

const CREATE_ENTRY_HALLUCINATION_PROPS = new Set<string>([
    'addEntry', 'create_entry', 'createEntry', 'create', 'add', 'log',
    'insertEntry', 'insert_entry', 'insert', 'add_entry', 'newEntry', 'new_entry',
    'logEntry', 'log_entry', 'saveEntry', 'save_entry', 'writeEntry', 'write_entry',
    'appendEntry', 'append_entry', 'createMemory', 'create_memory',
    'addMemory', 'add_memory', 'recordMemory', 'record_memory',
])

const UPDATE_MEMORY_PROPS = new Set<string>([
    'updateMemory', 'update_memory', 'setMemory', 'set_memory', 'updateJournal', 'update_journal',
])

const FACTORY_SHIM_PROPS = new Set<string>([
    'load', 'loadJournal', 'loadMemory', 'load_memory', 'init', 'initialize',
    'connect', 'getJournal', 'get_journal', 'load_journal', 'getInstance', 'get_instance',
    'createInstance', 'create_instance', 'initInstance', 'init_instance',
    'getClient', 'get_client', 'createClient', 'create_client', 'initClient', 'init_client',
    'getService', 'get_service', 'createService', 'create_service',
    'createJournal', 'create_journal', 'open', 'start', 'getDatabase', 'get_database',
    'getDb', 'get_db', 'connectToDatabase', 'connect_to_database',
    'openDatabase', 'open_database', 'create',
])

const LIFECYCLE_PROPS = new Set<string>([
    'close', 'dispose', 'disconnect', 'end', 'destroy',
    'quit', 'exit', 'terminate', 'clear', 'reset',
])

const DB_CONSTRUCTOR_PROPS = new Set<string>([
    'Database', 'Sqlite3', 'BetterSqlite3', 'better_sqlite3', 'betterSqlite3',
])

const searchDomainCache = new WeakMap<object, unknown>()

function getGroupProp(target: Record<string, unknown>, group: string, prop: string): unknown {
    const g = target[group]
    return (typeof g === 'object' && g !== null) || typeof g === 'function'
        ? (Reflect.get(g, prop) as unknown)
        : undefined
}

export interface CreateShimMjOptions {
    mjApi: Record<string, unknown>
    safeFsShim: SafeFsShim
    executeCodeFnRef: { current?: (arg: unknown) => Promise<unknown> }
    getUpdateMemoryFn: () => (arg: unknown) => unknown
}

type ShimMatch = { matched: true; value: unknown } | { matched: false }

function resolveFsPathAndUtilShims(prop: string | symbol, safeFsShim: SafeFsShim): ShimMatch {
    if (prop === 'fs' || prop === '__safeFs' || prop === 'safeFs') return { matched: true, value: safeFsShim }
    if (prop === 'path' || prop === '__path') return { matched: true, value: pathShim }
    if (prop === 'existsSync') return { matched: true, value: safeFsShim.existsSync }
    if (prop === 'readFileSync' || prop === 'readFile') return { matched: true, value: safeFsShim.readFileSync }
    if (prop === 'writeFileSync') return { matched: true, value: safeFsShim.writeFileSync }
    if (prop === 'writeFile') return { matched: true, value: safeFsShim.writeFile }
    if (prop === 'mkdirSync') return { matched: true, value: safeFsShim.mkdirSync }
    if (prop === 'appendFileSync') return { matched: true, value: safeFsShim.appendFileSync }
    if (prop === 'unlinkSync') return { matched: true, value: safeFsShim.unlinkSync }
    if (prop === 'statSync') return { matched: true, value: safeFsShim.statSync }
    if (prop === 'stat') return { matched: true, value: safeFsShim.stat }
    if (prop === 'readdirSync') return { matched: true, value: safeFsShim.readdirSync }
    if (prop === 'join') return { matched: true, value: pathShim.join }
    if (prop === 'resolve') return { matched: true, value: pathShim.resolve }
    if (prop === 'basename') return { matched: true, value: pathShim.basename }
    if (prop === 'dirname') return { matched: true, value: pathShim.dirname }
    if (prop === 'extname') return { matched: true, value: pathShim.extname }
    if (prop === 'promisify') return { matched: true, value: (fn: unknown) => fn }
    if (prop === 'format' || prop === 'inspect') {
        return { matched: true, value: (...args: unknown[]) => args.map(String).join(' ') }
    }
    return { matched: false }
}

function resolveNodeAndSqlShims(
    prop: string | symbol,
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>,
    safeFsShim: SafeFsShim
): ShimMatch {
    if (prop === 'db') {
        return {
            matched: true,
            value:
                'core' in target
                    ? createDbDomainProxy(target, shimMj)
                    : createSystemDatabaseDomainProxy(target, shimMj),
        }
    }
    if (prop === 'prepare' || prop === 'stmt' || prop === 'statement') {
        return {
            matched: true,
            value: (sql?: string) => createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj),
        }
    }
    if (prop === 'query' || prop === 'raw') {
        return {
            matched: true,
            value: (sql?: string) => {
                const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                const allFn = stmt['all']
                return typeof allFn === 'function' ? (allFn as () => unknown)() : undefined
            },
        }
    }
    if (prop === 'exec') {
        return {
            matched: true,
            value: (sql?: string) => {
                const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                const runFn = stmt['run']
                return typeof runFn === 'function' ? (runFn as () => unknown)() : undefined
            },
        }
    }
    if (typeof prop === 'string' && LIFECYCLE_PROPS.has(prop)) {
        return {
            matched: true,
            value: () => ({ success: false, code: 'VALIDATION_ERROR', error: `${prop} is not executed in the sandbox` }),
        }
    }
    if (prop === 'execSync' || prop === 'spawnSync' || prop === 'execFileSync') {
        return {
            matched: true,
            value: () => {
                const err = new Error(
                    `VALIDATION_ERROR: child_process.${prop} is disabled inside Code Mode.`
                )
                err.name = 'VALIDATION_ERROR'
                throw err
            },
        }
    }
    if (prop === 'spawn' || prop === 'fork' || prop === 'execFile') {
        return { matched: true, value: createDisabledSpawnShim(prop) }
    }
    const fsOrPath = resolveFsPathAndUtilShims(prop, safeFsShim)
    if (fsOrPath.matched) return fsOrPath
    if (typeof prop === 'string' && DB_CONSTRUCTOR_PROPS.has(prop)) {
        return { matched: true, value: createCallableShim(shimMj) }
    }
    return { matched: false }
}

function resolveCoreAndMetaShimProp(
    prop: string | symbol,
    options: CreateShimMjOptions,
    shimMj: Record<string, unknown>
): ShimMatch {
    const { mjApi: target, executeCodeFnRef, getUpdateMemoryFn } = options
    if (typeof prop === 'string' && SELF_REFERENTIAL_PROPS.has(prop)) return { matched: true, value: shimMj }
    if (prop === 'context') return { matched: true, value: target['context'] }
    if (prop === 'getContext' || prop === 'get_context') return { matched: true, value: target['getContext'] }
    if (prop === 'schema') return { matched: true, value: createSchemaShim(shimMj) }

    if (typeof prop === 'string' && EXECUTE_CODE_PROPS.has(prop)) {
        return {
            matched: true,
            value: (arg: unknown) => {
                if (executeCodeFnRef.current !== undefined) return executeCodeFnRef.current(arg)
                return Promise.resolve({
                    success: false,
                    error: 'Code execution is not available in this sandbox',
                    code: 'CONFIGURATION_ERROR',
                })
            },
        }
    }
    if (typeof prop === 'string' && ADAPTER_PROPS.has(prop)) return { matched: true, value: createAdaptersShim(prop) }
    if (typeof prop === 'string' && READ_RESOURCE_PROPS.has(prop)) return { matched: true, value: createShimReadResourceHandler() }
    if (prop === 'logger') return { matched: true, value: consoleShim }

    if (typeof prop === 'string' && BRIEFING_PROPS.has(prop) && 'core' in target) {
        const fn = getGroupProp(target, 'core', 'getRecentEntries') ?? getGroupProp(target, 'core', 'get_recent_entries')
        if (typeof fn === 'function') {
            return {
                matched: true,
                value: (args?: Record<string, unknown>) =>
                    (fn as (a: unknown) => unknown)({ limit: 10, sort_by: 'importance', ...args }),
            }
        }
    }
    if ((prop === 'entries' || prop === 'entry') && 'core' in target) {
        const entriesProxy = createEntriesDomainProxy(target)
        if (entriesProxy !== undefined) return { matched: true, value: entriesProxy }
    }
    if (typeof prop === 'string' && CREATE_ENTRY_HALLUCINATION_PROPS.has(prop) && 'core' in target) {
        return {
            matched: true,
            value: getGroupProp(target, 'core', 'create_entry') ?? getGroupProp(target, 'core', 'createEntry'),
        }
    }
    if (typeof prop === 'string' && UPDATE_MEMORY_PROPS.has(prop)) return { matched: true, value: getUpdateMemoryFn() }
    if (prop === 'saveMemory' || prop === 'save_memory') {
        return {
            matched: true,
            value: (arg?: unknown): unknown =>
                arg !== undefined && arg !== null
                    ? getUpdateMemoryFn()(arg)
                    : Promise.resolve({ success: false, code: 'VALIDATION_ERROR', error: 'saveMemory requires a payload' }),
        }
    }
    if ((prop === 'get' || prop === 'read' || prop === 'find' || prop === 'fetch') && 'core' in target && 'search' in target) {
        return { matched: true, value: createGetReadFindInterceptor(target, shimMj) }
    }
    if ((prop === 'update' || prop === 'edit') && 'core' in target) {
        return { matched: true, value: getGroupProp(target, 'core', 'update_entry') ?? getGroupProp(target, 'core', 'updateEntry') }
    }
    if ((prop === 'delete' || prop === 'remove') && 'core' in target) {
        return { matched: true, value: getGroupProp(target, 'core', 'delete_entry') ?? getGroupProp(target, 'core', 'deleteEntry') }
    }
    if (typeof prop === 'string' && FACTORY_SHIM_PROPS.has(prop)) {
        return { matched: true, value: createCallableShim(shimMj, 'factoryFn') }
    }
    if (prop === 'projects' || prop === 'project') {
        return { matched: true, value: createShimProjectsDomain(target, shimMj) }
    }
    return { matched: false }
}

function resolveDomainAndDbMappingProp(
    prop: string | symbol,
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): unknown {
    if (prop === 'database' || prop === 'system') return createSystemDatabaseDomainProxy(target, shimMj)
    if (prop === 'tags' || prop === 'tag') return target['tags']
    if (prop === 'graph' || prop === 'rel' || prop === 'relations' || prop === 'relationship') {
        return target['relationships']
    }
    if (prop === 'getProjects' || prop === 'listProjects' || prop === 'searchProjects') {
        const listProjects =
            getGroupProp(target, 'admin', 'listProjects') ??
            getGroupProp(target, 'admin', 'list_projects') ??
            getGroupProp(target, 'core', 'listProjects') ??
            getGroupProp(target, 'core', 'list_projects') ??
            getGroupProp(target, 'analytics', 'get_cross_project_insights') ??
            getGroupProp(target, 'analytics', 'getCrossProjectInsights')
        if (listProjects !== undefined) return listProjects
    }
    if (prop === 'search' && 'search' in target) {
        if (searchDomainCache.has(target)) return searchDomainCache.get(target)
        const searchDomain = createSearchDomainProxy(target)
        if (searchDomain !== undefined) {
            searchDomainCache.set(target, searchDomain)
            return searchDomain
        }
    }
    if (prop === 'append' && 'core' in target) {
        const appendFn = createAppendInterceptor(target)
        if (appendFn !== undefined) return appendFn
    }
    if (typeof prop === 'string' && prop.includes('_')) {
        const camelProp = prop.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
        if (camelProp !== prop) {
            if (isDbMaintenanceCall(camelProp)) return createMaintenanceUnavailableFn(camelProp)
            const mapping = DB_TO_JOURNAL[camelProp]
            if (mapping !== undefined && mapping[0] in target) {
                return getGroupProp(target, mapping[0], mapping[1])
            }
            if (camelProp in target) return target[camelProp]
        }
    }
    if (typeof prop === 'string') {
        if (isDbMaintenanceCall(prop)) return createMaintenanceUnavailableFn(prop)
        const mapping = DB_TO_JOURNAL[prop]
        if (mapping !== undefined && mapping[0] in target) {
            return getGroupProp(target, mapping[0], mapping[1])
        }
        return target[prop]
    }
    return undefined
}

function resolveShimMjProp(
    prop: string | symbol,
    options: CreateShimMjOptions,
    shimMj: Record<string, unknown>
): unknown {
    const coreOrMeta = resolveCoreAndMetaShimProp(prop, options, shimMj)
    if (coreOrMeta.matched) return coreOrMeta.value
    const nodeOrSql = resolveNodeAndSqlShims(prop, options.mjApi, shimMj, options.safeFsShim)
    if (nodeOrSql.matched) return nodeOrSql.value
    return resolveDomainAndDbMappingProp(prop, options.mjApi, shimMj)
}

/**
 * Builds the `shimMj` permissive proxy wrapping `mjApi`.
 */
export function createShimMjProxy(options: CreateShimMjOptions): Record<string, unknown> {
    const { mjApi } = options

    const shimMj: Record<string, unknown> = new Proxy({}, {
        get: (_fakeTarget: Record<string, unknown>, prop: string | symbol): unknown =>
            resolveShimMjProp(prop, options, shimMj),
        has: (_fakeTarget, prop) => prop in mjApi,
        ownKeys: () => Reflect.ownKeys(mjApi),
        getOwnPropertyDescriptor(_fakeTarget, prop) {
            const desc = Reflect.getOwnPropertyDescriptor(mjApi, prop)
            return desc ? { ...desc, configurable: true } : undefined
        },
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
        setPrototypeOf: () => false,
        isExtensible: () => true,
        preventExtensions: () => false,
    })

    return shimMj
}
