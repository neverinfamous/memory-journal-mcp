/**
 * Worker `shimMj` Proxy — permissive top-level proxy that wraps `mjApi` to
 * smooth out common agent hallucinations across repositories and SDK patterns.
 */

import { type SafeFsShim, pathShim, consoleShim, createPreparedStatementShim } from './node-shims.js'
import { DB_TO_JOURNAL, createCallableShim, createSchemaShim } from './namespace-shims.js'
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

/**
 * Builds the `shimMj` permissive proxy wrapping `mjApi`.
 */
export function createShimMjProxy(options: CreateShimMjOptions): Record<string, unknown> {
    const { mjApi, safeFsShim, executeCodeFnRef, getUpdateMemoryFn } = options

    const shimMj: Record<string, unknown> = new Proxy({}, {
        get(_fakeTarget: Record<string, unknown>, prop: string | symbol): unknown {
            const target = mjApi
            if (typeof prop === 'string' && SELF_REFERENTIAL_PROPS.has(prop)) return shimMj
            if (prop === 'context') return mjApi['context']
            if (prop === 'getContext' || prop === 'get_context') return mjApi['getContext']
            if (prop === 'schema') return createSchemaShim(shimMj)

            if (typeof prop === 'string' && EXECUTE_CODE_PROPS.has(prop)) {
                return (arg: unknown) => {
                    if (executeCodeFnRef.current !== undefined) return executeCodeFnRef.current(arg)
                    if ('codemode' in target) {
                        const fn = getGroupProp(target, 'codemode', 'mjExecuteCode') ?? getGroupProp(target, 'codemode', 'executeCode')
                        if (typeof fn === 'function') return (fn as (...a: unknown[]) => unknown)(arg)
                    }
                    return Promise.resolve({ success: true })
                }
            }

            if (typeof prop === 'string' && ADAPTER_PROPS.has(prop)) return createAdaptersShim(prop)
            if (typeof prop === 'string' && READ_RESOURCE_PROPS.has(prop)) return createShimReadResourceHandler()
            if (prop === 'logger') return consoleShim

            if (typeof prop === 'string' && BRIEFING_PROPS.has(prop) && 'core' in target) {
                const fn = getGroupProp(target, 'core', 'getRecentEntries') ?? getGroupProp(target, 'core', 'get_recent_entries')
                if (typeof fn === 'function') {
                    return (args?: Record<string, unknown>) =>
                        (fn as (a: unknown) => unknown)({ limit: 10, sort_by: 'importance', ...args })
                }
            }

            if ((prop === 'entries' || prop === 'entry') && 'core' in target) {
                const entriesProxy = createEntriesDomainProxy(target)
                if (entriesProxy !== undefined) return entriesProxy
            }

            if (typeof prop === 'string' && CREATE_ENTRY_HALLUCINATION_PROPS.has(prop) && 'core' in target) {
                return getGroupProp(target, 'core', 'create_entry') ?? getGroupProp(target, 'core', 'createEntry')
            }

            if (typeof prop === 'string' && UPDATE_MEMORY_PROPS.has(prop)) return getUpdateMemoryFn()

            if (prop === 'saveMemory' || prop === 'save_memory') {
                return (arg?: unknown): unknown =>
                    arg !== undefined && arg !== null ? getUpdateMemoryFn()(arg) : Promise.resolve({ success: true })
            }

            if ((prop === 'get' || prop === 'read' || prop === 'find' || prop === 'fetch') && 'core' in target && 'search' in target) {
                return createGetReadFindInterceptor(target, shimMj)
            }

            if ((prop === 'update' || prop === 'edit') && 'core' in target) {
                return getGroupProp(target, 'core', 'update_entry') ?? getGroupProp(target, 'core', 'updateEntry')
            }

            if ((prop === 'delete' || prop === 'remove') && 'core' in target) {
                return getGroupProp(target, 'core', 'delete_entry') ?? getGroupProp(target, 'core', 'deleteEntry')
            }

            if (typeof prop === 'string' && FACTORY_SHIM_PROPS.has(prop)) {
                return createCallableShim(shimMj, 'factoryFn')
            }

            if (prop === 'projects' || prop === 'project') return createShimProjectsDomain(target, shimMj)

            if (prop === 'db') {
                return 'core' in target
                    ? createDbDomainProxy(target, shimMj)
                    : createSystemDatabaseDomainProxy(target, shimMj)
            }

            if (prop === 'prepare' || prop === 'stmt' || prop === 'statement') {
                return (sql?: string) => createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
            }
            if (prop === 'query' || prop === 'raw') {
                return (sql?: string) => {
                    const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                    const allFn = stmt['all']
                    return typeof allFn === 'function' ? (allFn as () => unknown)() : undefined
                }
            }
            if (prop === 'exec') {
                return (sql?: string) => {
                    const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
                    const runFn = stmt['run']
                    return typeof runFn === 'function' ? (runFn as () => unknown)() : undefined
                }
            }

            if (typeof prop === 'string' && LIFECYCLE_PROPS.has(prop)) return () => ({ success: true })
            if (prop === 'execSync' || prop === 'spawnSync' || prop === 'execFileSync') return () => ''
            if (prop === 'spawn' || prop === 'fork' || prop === 'execFile') {
                return (_cmd?: unknown, cbOrOptions?: unknown, maybeCb?: unknown) => {
                    const cb =
                        typeof cbOrOptions === 'function'
                            ? (cbOrOptions as (...args: unknown[]) => unknown)
                            : typeof maybeCb === 'function'
                              ? (maybeCb as (...args: unknown[]) => unknown)
                              : undefined
                    if (cb !== undefined) {
                        try { cb(null, '', '') } catch { /* ignore */ }
                    }
                    const noop = (): void => { /* noop */ }
                    return { on: noop, stdout: { on: noop }, stderr: { on: noop }, kill: () => true, status: 0, output: ['', '', ''] }
                }
            }

            if (prop === 'fs' || prop === '__safeFs' || prop === 'safeFs') return safeFsShim
            if (prop === 'path' || prop === '__path') return pathShim
            if (prop === 'existsSync') return safeFsShim.existsSync
            if (prop === 'readFileSync' || prop === 'readFile') return safeFsShim.readFileSync
            if (
                prop === 'writeFileSync' || prop === 'writeFile' || prop === 'mkdirSync' ||
                prop === 'appendFileSync' || prop === 'unlinkSync'
            ) {
                return () => undefined
            }
            if (prop === 'statSync') return safeFsShim.statSync
            if (prop === 'stat') return safeFsShim.stat
            if (prop === 'readdirSync') return () => []
            if (prop === 'join' || prop === 'resolve' || prop === 'basename' || prop === 'dirname' || prop === 'extname') {
                return (...parts: unknown[]) => parts.filter((p) => typeof p === 'string').join('/')
            }
            if (prop === 'promisify') return (fn: unknown) => fn
            if (prop === 'format' || prop === 'inspect') return (...args: unknown[]) => args.map(String).join(' ')
            if (typeof prop === 'string' && DB_CONSTRUCTOR_PROPS.has(prop)) return createCallableShim(shimMj)
            if (prop === 'database' || prop === 'system') return createSystemDatabaseDomainProxy(target, shimMj)
            if (prop === 'tags' || prop === 'tag') return target['tags']

            if ((prop === 'getProjects' || prop === 'listProjects' || prop === 'searchProjects') && 'analytics' in target) {
                return (
                    getGroupProp(target, 'analytics', 'get_cross_project_insights') ??
                    getGroupProp(target, 'analytics', 'getCrossProjectInsights')
                )
            }

            if (prop === 'search' && 'search' in target) {
                const searchDomain = createSearchDomainProxy(target)
                if (searchDomain !== undefined) return searchDomain
            }

            if (prop === 'append' && 'core' in target) {
                const appendFn = createAppendInterceptor(target)
                if (appendFn !== undefined) return appendFn
            }

            if (typeof prop === 'string' && prop.includes('_')) {
                const camelProp = prop.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
                if (camelProp !== prop) {
                    const mapping = DB_TO_JOURNAL[camelProp]
                    if (mapping !== undefined) {
                        const [group, method] = mapping
                        if (group in target) return getGroupProp(target, group, method)
                    }
                    if (camelProp in target) return target[camelProp]
                }
            }

            if (typeof prop === 'string') {
                const mapping = DB_TO_JOURNAL[prop]
                if (mapping !== undefined) {
                    const [group, method] = mapping
                    if (group in target) return getGroupProp(target, group, method)
                }
            }

            return typeof prop === 'string' ? target[prop] : undefined
        },
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
