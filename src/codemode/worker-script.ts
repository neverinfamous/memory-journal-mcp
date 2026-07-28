/**
 * memory-journal-mcp - Worker Script (Worker Thread Entry Point)
 *
 * Runs inside `node:worker_threads`. Receives serialized API bindings,
 * builds an async Proxy API object (`mj.*`), and executes user code
 * within a secondary `vm.createContext` boundary.
 */

import { parentPort } from 'node:worker_threads'
import * as vm from 'node:vm'
import type { MessagePort } from 'node:worker_threads'
import type { RpcRequest, RpcResponse, SandboxResult, ExecutionMetrics } from './types.js'
import { transformAutoReturn } from './auto-return.js'
import { buildApiProxy } from './worker-api-proxy.js'

// =============================================================================
// Execution State
// =============================================================================

let rpcPort: MessagePort | null = null
let rpcIdCounter = 0
const pendingRpcRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>()

/**
 * Send an RPC request to the main thread and await the response.
 */
function rpcCall(group: string, method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        if (!rpcPort) {
            reject(new Error('RPC port not initialized'))
            return
        }

        const id = ++rpcIdCounter
        pendingRpcRequests.set(id, { resolve, reject })

        const request: RpcRequest = { id, group, method, args }
        rpcPort.postMessage(request)
    })
}

// =============================================================================
// Execution
// =============================================================================

async function executeCode(
    code: string,
    methodList: Record<string, string[]>,
    schemaList: Record<string, Record<string, string>> | undefined,
    timeoutMs: number,
    contextObj?: Record<string, unknown>,
    readonlyMode?: boolean
): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    try {
        const mjApi = buildApiProxy(rpcCall, methodList, schemaList, readonlyMode)

        // Freeze each group namespace in the API to prevent prototype pollution
        for (const key of Object.keys(mjApi)) {
            const val = mjApi[key]
            if (typeof val === 'object' && val !== null) {
                Object.freeze(val)
            }
        }
        Object.freeze(mjApi)

        const DB_TO_JOURNAL: Record<string, [string, string]> = {
            listTables: ['analytics', 'getStatistics'],
            describeTable: ['analytics', 'getStatistics'],
            count: ['analytics', 'getStatistics'],
            analyze: ['analytics', 'getStatistics'],
            vacuum: ['analytics', 'getStatistics'],
            integrityCheck: ['analytics', 'getStatistics'],
            exists: ['core', 'getEntryById'],
            upsert: ['core', 'createEntry'],
            batchInsert: ['core', 'createEntry'],
            readQuery: ['core', 'readQuery'],
        }

        // Permissive shim to smooth out common agent hallucinations across different repos
        const shimMj: Record<string, unknown> = new Proxy({}, {
            get(_fakeTarget: Record<string, unknown>, prop: string | symbol): unknown {
                const target = mjApi
                // Handle infinite chaining
                if (
                    prop === 'mj' ||
                    prop === 'journal' ||
                    prop === 'memory' ||
                    prop === 'memory_journal' ||
                    prop === 'memory_journal_mcp' ||
                    prop === 'm' ||
                    prop === 'env' ||
                    prop === 'agent' ||
                    prop === 'mcp' ||
                    prop === 'mcpx' ||
                    prop === 'memoryJournal' ||
                    prop === 'MemoryJournal'
                ) return shimMj
                // Handle `sqlite.mj.executeCode` (from db-mcp parity)
                if (prop === 'executeCode') {
                    if ('codemode' in target) {
                        const codemodeGroup = target['codemode'] as Record<string, unknown>
                        return codemodeGroup['mjExecuteCode'] ?? codemodeGroup['executeCode']
                    }
                    return () =>
                        Promise.resolve({
                            success: false,
                            error: 'You are already inside Code Mode execution. You do not need to call executeCode again. Just write your logic directly (e.g., return await mj.core.createEntry(...)).',
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true
                        })
                }
                if (prop === 'readResource') {
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
                        return Promise.resolve({
                            success: false,
                            error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true
                        })
                    }
                }
                if (prop === 'logger') {
                    return consoleShim
                }
                if (prop === 'loadBriefing' || prop === 'load_briefing' || prop === 'getBriefing' || prop === 'get_briefing') {
                    if ('core' in target) {
                        const coreGroup = target['core'] as Record<string, unknown>
                        const fn = coreGroup['getRecentEntries'] ?? coreGroup['get_recent_entries']
                        if (typeof fn === 'function') {
                            return (args?: Record<string, unknown>) => (fn as (a: unknown) => unknown)({ limit: 10, sort_by: 'importance', ...args })
                        }
                    }
                }
                // Handle `mj.entries.create` or `mj.entries(...)` or `mj.entry(...)` hallucination
                if ((prop === 'entries' || prop === 'entry') && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    const listFunc = coreGroup['get_recent_entries'] ?? coreGroup['getRecentEntries']
                    if (typeof listFunc === 'function') {
                        const callableEntries = function(this: unknown, ...args: unknown[]): unknown {
                            return (listFunc as (...args: unknown[]) => unknown).apply(this, args)
                        }
                        const adminGroup = target['admin'] as Record<string, unknown> | undefined
                        const searchGroup = target['search'] as Record<string, unknown> | undefined
                        Object.assign(callableEntries, {
                            create: coreGroup['create_entry'] ?? coreGroup['createEntry'],
                            createEntry: coreGroup['create_entry'] ?? coreGroup['createEntry'],
                            create_entry: coreGroup['create_entry'] ?? coreGroup['createEntry'],
                            add: coreGroup['create_entry'] ?? coreGroup['createEntry'],
                            get: coreGroup['get_entry_by_id'] ?? coreGroup['getEntryById'],
                            getEntryById: coreGroup['get_entry_by_id'] ?? coreGroup['getEntryById'],
                            get_entry_by_id: coreGroup['get_entry_by_id'] ?? coreGroup['getEntryById'],
                            update: adminGroup?.['update_entry'] ?? adminGroup?.['updateEntry'] ?? coreGroup['update_entry'] ?? coreGroup['updateEntry'],
                            updateEntry: adminGroup?.['update_entry'] ?? adminGroup?.['updateEntry'] ?? coreGroup['update_entry'] ?? coreGroup['updateEntry'],
                            update_entry: adminGroup?.['update_entry'] ?? adminGroup?.['updateEntry'] ?? coreGroup['update_entry'] ?? coreGroup['updateEntry'],
                            delete: adminGroup?.['delete_entry'] ?? adminGroup?.['deleteEntry'] ?? coreGroup['delete_entry'] ?? coreGroup['deleteEntry'],
                            deleteEntry: adminGroup?.['delete_entry'] ?? adminGroup?.['deleteEntry'] ?? coreGroup['delete_entry'] ?? coreGroup['deleteEntry'],
                            delete_entry: adminGroup?.['delete_entry'] ?? adminGroup?.['deleteEntry'] ?? coreGroup['delete_entry'] ?? coreGroup['deleteEntry'],
                            search: searchGroup?.['search_entries'] ?? searchGroup?.['searchEntries'] ?? coreGroup['search_entries'] ?? coreGroup['searchEntries'],
                            searchEntries: searchGroup?.['search_entries'] ?? searchGroup?.['searchEntries'] ?? coreGroup['search_entries'] ?? coreGroup['searchEntries'],
                            search_entries: searchGroup?.['search_entries'] ?? searchGroup?.['searchEntries'] ?? coreGroup['search_entries'] ?? coreGroup['searchEntries'],
                            list: listFunc,
                            listEntries: listFunc,
                            list_entries: listFunc,
                            getRecent: listFunc,
                            getRecentEntries: listFunc,
                            get_recent_entries: listFunc,
                        })
                        return new Proxy(callableEntries, {
                            get(targetFn, p, receiver) {
                                if (p in targetFn) return (targetFn as unknown as Record<string | symbol, unknown>)[p]
                                if (typeof p === 'string') {
                                    const pLower = p.toLowerCase().replace(/_/g, '')
                                    if (pLower.includes('search') || pLower.includes('query') || pLower.includes('find')) {
                                        const searchFn = searchGroup?.['search_entries'] ?? searchGroup?.['searchEntries'] ?? coreGroup['search_entries'] ?? coreGroup['searchEntries']
                                        if (typeof searchFn === 'function') return searchFn
                                    }
                                    if (pLower.includes('create') || pLower.includes('add') || pLower.includes('insert') || pLower.includes('append')) {
                                        const createFn = coreGroup['create_entry'] ?? coreGroup['createEntry']
                                        if (typeof createFn === 'function') return createFn
                                    }
                                    if (pLower.includes('get') || pLower.includes('fetch') || pLower.includes('read') || pLower.includes('byid')) {
                                        const getFn = coreGroup['get_entry_by_id'] ?? coreGroup['getEntryById']
                                        if (typeof getFn === 'function') return getFn
                                    }
                                    if (pLower.includes('update') || pLower.includes('edit') || pLower.includes('patch')) {
                                        const updateFn = adminGroup?.['update_entry'] ?? adminGroup?.['updateEntry'] ?? coreGroup['update_entry'] ?? coreGroup['updateEntry']
                                        if (typeof updateFn === 'function') return updateFn
                                    }
                                    if (pLower.includes('delete') || pLower.includes('remove')) {
                                        const deleteFn = adminGroup?.['delete_entry'] ?? adminGroup?.['deleteEntry'] ?? coreGroup['delete_entry'] ?? coreGroup['deleteEntry']
                                        if (typeof deleteFn === 'function') return deleteFn
                                    }
                                    if (pLower.includes('recent') || pLower.includes('list') || pLower.includes('all')) {
                                        return listFunc
                                    }
                                    const methodOnCore = coreGroup[p] ?? searchGroup?.[p] ?? adminGroup?.[p]
                                    if (typeof methodOnCore === 'function') return methodOnCore
                                }
                                return Reflect.get(targetFn, p, receiver) as unknown
                            }
                        })
                    }
                }
                // Handle `memory.journal.addEntry` or `Entry.create` / `mj.add` / `mj.log` natural hallucination
                if ((prop === 'addEntry' || prop === 'create_entry' || prop === 'createEntry' || prop === 'create' || prop === 'add' || prop === 'log') && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    return coreGroup['create_entry'] ?? coreGroup['createEntry']
                }
                if ((prop === 'get' || prop === 'read' || prop === 'find' || prop === 'fetch') && 'core' in target && 'search' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    const searchGroup = target['search'] as Record<string, unknown>
                    const getFn = coreGroup['get_entry_by_id'] ?? coreGroup['getEntryById']
                    const searchFn = searchGroup['search_entries'] ?? searchGroup['searchEntries']
                    return (arg: unknown) => {
                        if (typeof arg === 'number' || typeof arg === 'string') {
                            const parsedId = Number(arg)
                            if (!Number.isNaN(parsedId)) {
                                return (getFn as (a: unknown) => unknown)({ entry_id: parsedId })
                            }
                        }
                        if (arg !== null && typeof arg === 'object') {
                            const obj = arg as Record<string, unknown>
                            if ('entry_id' in obj || 'id' in obj) {
                                return (getFn as (a: unknown) => unknown)(obj)
                            }
                            if ('query' in obj || 'tags' in obj || 'search' in obj || 'text' in obj || 'q' in obj) {
                                return (searchFn as (a: unknown) => unknown)(obj)
                            }
                        }
                        return (getFn as (a: unknown) => unknown)(arg)
                    }
                }
                if ((prop === 'update' || prop === 'edit') && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    return coreGroup['update_entry'] ?? coreGroup['updateEntry']
                }
                if ((prop === 'delete' || prop === 'remove') && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    return coreGroup['delete_entry'] ?? coreGroup['deleteEntry']
                }
                // Handle load/init/connect/getJournal shim
                if (prop === 'load' || prop === 'loadJournal' || prop === 'loadMemory' || prop === 'init' || prop === 'connect' || prop === 'getJournal' || prop === 'get_journal' || prop === 'load_journal') {
                    return () => Promise.resolve(shimMj)
                }
                // Handle sdk.projects hallucination
                if (prop === 'projects') {
                    const coreGroup = target['core'] as Record<string, unknown> | undefined
                    const analyticsGroup = target['analytics'] as Record<string, unknown> | undefined
                    const adminGroup = target['admin'] as Record<string, unknown> | undefined
                    const createFn = coreGroup?.['create_entry'] ?? coreGroup?.['createEntry']
                    const listFn = analyticsGroup?.['get_cross_project_insights'] ?? analyticsGroup?.['getCrossProjectInsights'] ?? adminGroup?.['list_projects'] ?? adminGroup?.['listProjects']
                    
                    const projectsFn = function(this: unknown, ...args: unknown[]): Promise<unknown> {
                        if (typeof listFn === 'function') {
                            return (listFn as (...a: unknown[]) => Promise<unknown>).apply(this, args)
                        }
                        return Promise.resolve({ success: true, projects: [] })
                    }
                    Object.assign(projectsFn, {
                        list: () => (listFn as ((...args: unknown[]) => unknown) | undefined)?.(),
                        get: (name: unknown) => (adminGroup?.['get_project'] as ((...args: unknown[]) => unknown) | undefined)?.(typeof name === 'string' || typeof name === 'number' ? { name: String(name) } : name),
                        entries: {
                            create: createFn,
                            add: createFn
                        }
                    })
                    return projectsFn
                }
                // Handle direct SQL execution shim (e.g. db.execute)
                if (prop === 'db' && 'core' in target) {
                    return new Proxy({}, {
                        get(_t, dbProp) {
                            return (..._args: unknown[]) => Promise.resolve({
                                success: false,
                                error: `Direct SQLite database access 'mj.db.${String(dbProp)}()' is not available in Code Mode sandbox. Use high-level API methods instead: mj.core.createEntry({ ... }), mj.core.getRecentEntries({ ... }), or mj.search.searchEntries({ ... }).`,
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                suggestion: 'Use mj.core or mj.search methods.',
                                recoverable: true
                            })
                        }
                    })
                }
                if (prop === 'execute' || prop === 'query' || prop === 'raw' || prop === 'exec') {
                    return (..._args: unknown[]) => Promise.resolve({
                        success: false,
                        error: `Direct database execution '${typeof prop === 'string' ? prop : String(prop)}()' is disabled in Code Mode. Use mj.core.createEntry({ ... }), mj.search.searchEntries({ ... }), or mj.core.getRecentEntries() instead.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true
                    })
                }
                // Handle get/list/searchProjects hallucination via proxy intercept
                if (prop === 'getProjects' || prop === 'listProjects' || prop === 'searchProjects') {
                    if ('analytics' in target) {
                        const analyticsGroup = target['analytics'] as Record<string, unknown>
                        return analyticsGroup['get_cross_project_insights'] ?? analyticsGroup['getCrossProjectInsights']
                    }
                }
                // Handle journal.search hallucination without breaking mj.search namespace
                if (prop === 'search' && 'search' in target) {
                    const searchGroup = target['search'] as Record<string, unknown>
                    const searchFunc = searchGroup['search_entries'] ?? searchGroup['searchEntries']
                    if (typeof searchFunc === 'function') {
                        const callableSearch = function(this: unknown, ...args: unknown[]): unknown {
                            return (searchFunc as (...args: unknown[]) => unknown).apply(this, args)
                        }
                        Object.assign(callableSearch, searchGroup, {
                            search: searchFunc,
                            query: searchFunc,
                            searchEntries: searchFunc,
                            search_entries: searchFunc,
                        })
                        return callableSearch
                    }
                    return searchGroup
                }
                // Handle `memory.append(tags, content, metadata)` natural hallucination
                if (prop === 'append' && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    const createEntry = coreGroup['createEntry'] as (args: unknown) => unknown
                    return (arg1: unknown, arg2: unknown, arg3: unknown) => {
                        const tags = Array.isArray(arg1)
                            ? arg1
                            : [typeof arg1 === 'string' ? arg1 : 'test']
                        const content =
                            typeof arg2 === 'string'
                                ? arg2
                                : arg2 != null
                                  ? JSON.stringify(arg2)
                                  : ''
                        const metadata =
                            typeof arg3 === 'object' && arg3 !== null
                                ? { ...(arg3 as Record<string, unknown>) }
                                : undefined

                        const typeVal = metadata?.['type']
                        const type =
                            typeof typeVal === 'string' && typeVal !== '' ? typeVal : 'test_entry'
                        if (metadata && 'type' in metadata) delete metadata['type']

                        return createEntry({ type, tags, content, metadata })
                    }
                }
                // Generic snake_case to camelCase fallback for top-level operations
                if (typeof prop === 'string' && prop.includes('_')) {
                    const camelProp = prop.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
                    if (camelProp !== prop) {
                        // Check if the camelProp is mapped in DB_TO_JOURNAL
                        const mapping = DB_TO_JOURNAL[camelProp]
                        if (mapping !== undefined) {
                            const [group, method] = mapping
                            if (group in target) return (target[group] as Record<string, unknown>)[method]
                        }
                        if (camelProp in target) return Reflect.get(target, camelProp)
                    }
                }

                // db-mcp bleedover: silently route database-specific methods to closest journal equivalents
                if (typeof prop === 'string') {
                    const mapping = DB_TO_JOURNAL[prop]
                    if (mapping !== undefined) {
                        const [group, method] = mapping
                        if (group in target) {
                            return (target[group] as Record<string, unknown>)[method]
                        }
                    }
                }
                // Fall back to the strict `mjApi` proxy which provides exact error messages
                return Reflect.get(target, prop) as unknown
            },
            has(_fakeTarget, prop) {
                return prop in mjApi
            },
            ownKeys(_fakeTarget) {
                return Reflect.ownKeys(mjApi)
            },
            getOwnPropertyDescriptor(_fakeTarget, prop) {
                const desc = Reflect.getOwnPropertyDescriptor(mjApi, prop)
                if (desc) {
                    return { ...desc, configurable: true }
                }
                return undefined
            },
            set() { return false },
            defineProperty() { return false },
            deleteProperty() { return false },
            setPrototypeOf() { return false },
            isExtensible() { return true },
            preventExtensions() { return false }
        })

        const contextProxy = new Proxy(contextObj ?? {}, {
            get(target, prop) {
                if (typeof prop === 'symbol') return undefined
                if (prop in target) return target[prop]
                if (prop === 'executeSystemPrompt' || prop === 'getPrompt' || prop === 'executePrompt') {
                    return (_promptName?: string) => Promise.resolve({
                        success: false,
                        error: `Code Mode cannot execute MCP Prompts via context.${prop}(). Code Mode is for running JavaScript with mj.* tools. Use mj.core.createEntry to save entries.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true
                    })
                }
                return target[prop]
            }
        })
        const frozenContext = Object.freeze(contextProxy)

        const consoleShim = {
            log: (...args: unknown[]) => args,
            warn: (...args: unknown[]) => args,
            error: (...args: unknown[]) => args,
            info: (...args: unknown[]) => args,
            debug: (...args: unknown[]) => args,
        }
        Object.freeze(consoleShim)

        const servicesProxy = new Proxy({}, { get: () => shimMj })
        const kernelProxy = new Proxy({}, { get: () => shimMj })

        const sandbox: Record<string, unknown> = {
            mj: shimMj,
            core: shimMj,
            journal: shimMj,
            _journal: shimMj,
            MJ: shimMj,
            adapter: shimMj,
            Entry: shimMj,
            getJournal: () => Promise.resolve(shimMj),
            services: servicesProxy,
            kernel: kernelProxy,
            sqlite: shimMj,
            postgres: shimMj,
            mysql: shimMj,
            db: shimMj,
            api: shimMj,
            memory: shimMj, // Unified with shimMj to catch memory.append and memory.journal
            mcp: shimMj,
            mcpx: shimMj,
            memoryJournal: shimMj,
            MemoryJournal: shimMj,
            memory_journal: shimMj,
            memory_journal_mcp: shimMj,
            m: shimMj,
            env: shimMj,
            agent: shimMj,
            tools: shimMj,
            sdk: shimMj,
            client: shimMj,
            system: shimMj,
            utils: shimMj,
            sql: shimMj,
            connectToDatabase: () => shimMj,
            sqlite_journal_add_entry: (shimMj['core'] as Record<string, unknown>)?.['createEntry'] ?? (shimMj['core'] as Record<string, unknown>)?.['create_entry'],
            create_entry: (shimMj['core'] as Record<string, unknown>)?.['createEntry'] ?? (shimMj['core'] as Record<string, unknown>)?.['create_entry'],
            createEntry: (shimMj['core'] as Record<string, unknown>)?.['createEntry'] ?? (shimMj['core'] as Record<string, unknown>)?.['create_entry'],
            createMemory: (arg: unknown): unknown => (shimMj['core'] as Record<string, ((...args: unknown[]) => unknown)>)?.['createEntry']?.(arg),
            appendEntry: (arg: unknown): unknown => (shimMj['core'] as Record<string, ((...args: unknown[]) => unknown)>)?.['createEntry']?.(arg),
            createJournalEntry: (arg: unknown): unknown => (shimMj['core'] as Record<string, ((...args: unknown[]) => unknown)>)?.['createEntry']?.(arg),
            loadJournal: (): Promise<unknown> => Promise.resolve(shimMj),
            saveJournal: (): Promise<unknown> => Promise.resolve({ success: true }),
            readJournal: (): unknown => (shimMj['core'] as Record<string, ((...args: unknown[]) => unknown)>)?.['getRecentEntries']?.({ limit: 50 }),
            writeJournal: (arg: unknown): unknown => (shimMj['core'] as Record<string, ((...args: unknown[]) => unknown)>)?.['createEntry']?.(arg),
            loadMemory: (): Promise<unknown> => Promise.resolve(shimMj),
            saveMemory: (): Promise<unknown> => Promise.resolve({ success: true }),
            update_configuration: (arg: unknown): unknown => {
                const adminGroup = shimMj['admin'] as Record<string, ((...args: unknown[]) => unknown)> | undefined
                const fn = adminGroup?.['update_configuration'] ?? adminGroup?.['updateConfiguration']
                return fn?.(arg)
            },
            updateConfiguration: (arg: unknown): unknown => {
                const adminGroup = shimMj['admin'] as Record<string, ((...args: unknown[]) => unknown)> | undefined
                const fn = adminGroup?.['update_configuration'] ?? adminGroup?.['updateConfiguration']
                return fn?.(arg)
            },
            context: frozenContext,
            console: consoleShim,
            fetch: undefined,
            sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
            setTimeout: (cb: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => setTimeout(cb, ms, ...args),
            setInterval: undefined,
            setImmediate: undefined,
            getConfig: () => Promise.resolve({ dbPath: 'memory-journal.db' }),
            process: { exit: (code?: number) => process.exit(200 + (code ?? 0)) },
            require: undefined,
            __dirname: undefined,
            __filename: undefined,
            global: undefined,
            globalThis: undefined,
            Proxy: undefined,
        }

        // Spread all callable methods from all groups into the sandbox as standalone globals
        for (const key of Object.keys(mjApi)) {
            const val = shimMj[key]
            if (typeof val === 'function' && !(key in sandbox)) {
                sandbox[key] = val
            } else if (val !== null && typeof val === 'object') {
                for (const groupMethod of Object.keys(val)) {
                    if (groupMethod in sandbox) continue
                    const fn = (val as Record<string, unknown>)[groupMethod]
                    if (typeof fn === 'function') {
                        sandbox[groupMethod] = fn
                    }
                }
            }
        }

        // Freeze the sandbox object itself before passing to vm.createContext.
        // Note: shimMj is a Proxy and cannot be frozen — the underlying mjApi
        // target is already frozen above, which is sufficient.
        Object.freeze(sandbox)

        const context = vm.createContext(sandbox, {
            name: 'codemode-worker-sandbox',
            codeGeneration: {
                strings: false,
                wasm: false,
            },
        })

        // Freeze built-in prototypes inside the sandbox to prevent dynamic
        // constructor chain escapes like:
        //   const c = 'con'+'structor'; Error()[c][c]('return process')()
        // By freezing prototypes, the `constructor` property becomes
        // non-configurable and returns a frozen function that cannot be
        // used to reach the real Function constructor.
        vm.runInContext(
            `(function() {
                "use strict";
                const builtins = [
                    Object, Function, Array, String, Number, Boolean, RegExp,
                    Error, TypeError, RangeError, ReferenceError, SyntaxError,
                    URIError, EvalError, Map, Set, WeakMap, WeakSet,
                    Promise, Date, ArrayBuffer, DataView,
                    Int8Array, Uint8Array, Uint8ClampedArray,
                    Int16Array, Uint16Array, Int32Array, Uint32Array,
                    Float32Array, Float64Array, BigInt64Array, BigUint64Array,
                    JSON, Math,
                ];
                for (const B of builtins) {
                    if (B && typeof B === "function" && B.prototype) {
                        try { Object.freeze(B.prototype); } catch(e) {}
                    }
                    try { Object.freeze(B); } catch(e) {}
                }
                try { Object.freeze(Object.prototype); } catch(e) {}
                try { Object.freeze(Function.prototype); } catch(e) {}
            })()`,
            context
        )

        const wrappedCode = `(async () => { ${transformAutoReturn(code)} })()`
        const script = new vm.Script(wrappedCode, {
            filename: 'codemode-execution.js',
        })

        const resultPromise = script.runInContext(context, {
            timeout: timeoutMs,
        }) as Promise<unknown>

        const result = await resultPromise

        const endTime = performance.now()
        const endCpu = process.cpuUsage(startCpu)
        const metrics: ExecutionMetrics = {
            wallTimeMs: Math.round(endTime - startTime),
            cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1000),
            memoryUsedMb: 0,
        }

        return { success: true, result, metrics }
    } catch (err) {
        const endTime = performance.now()
        const endCpu = process.cpuUsage(startCpu)
        const error = err instanceof Error ? err : new Error(String(err))

        const errString = String(err)
        // Add tip for syntax or tagged template errors caused by unescaped backticks
        // Checking error string directly because VM sandbox errors fail cross-realm `instanceof` checks
        if (
            errString.includes('missing ) after argument list') ||
            errString.includes('is not a function') ||
            errString.includes('Invalid or unexpected token')
        ) {
            error.message +=
                '\n\n💡 Tip: When passing long multi-line strings or markdown with embedded quotes/backticks, NEVER use template literals (backticks `) in the code string as they will prematurely evaluate and cause SyntaxErrors or Tagged Template TypeErrors. ALWAYS pass them safely via the `context` parameter and reference them as `context.myParam`.'
        }

        return {
            success: false,
            error: error.message,
            metrics: {
                wallTimeMs: Math.round(endTime - startTime),
                cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1000),
                memoryUsedMb: 0,
            },
        }
    }
}

// =============================================================================
// Master Listener
// =============================================================================

parentPort?.on('message', (msg: unknown) => {
    void (async () => {
        if (
            msg !== null &&
            msg !== undefined &&
            typeof msg === 'object' &&
            'type' in msg &&
            (msg as { type: string }).type === 'EXECUTE'
        ) {
            const executeMsg = msg as unknown as {
                id: number
                code: string
                methodList: Record<string, string[]>
                schemaList?: Record<string, Record<string, string>>
                timeoutMs?: number
                maxResultSize?: number
                rpcPort: MessagePort
                contextObj?: Record<string, unknown>
                readonlyMode?: boolean
            }
            const {
                id,
                code,
                methodList,
                schemaList,
                timeoutMs,
                maxResultSize,
                rpcPort: newRpcPort,
                contextObj,
                readonlyMode,
            } = executeMsg

            rpcPort = newRpcPort
            rpcIdCounter = 0
            pendingRpcRequests.clear()

            rpcPort?.on('message', (response: RpcResponse) => {
                const pending = pendingRpcRequests.get(response.id)
                if (pending) {
                    pendingRpcRequests.delete(response.id)
                    if (response.error !== undefined) {
                        pending.reject(new Error(response.error))
                    } else {
                        pending.resolve(response.result)
                    }
                }
            })

            const result = await executeCode(
                code,
                methodList,
                schemaList,
                timeoutMs ?? 30000,
                contextObj,
                readonlyMode
            )

            if (result.success) {
                try {
                    // Enforce egress boundary dynamically during serialization to prevent OOM
                    const egressLimit = maxResultSize ?? 100 * 1024
                    let bytes = 0
                    const cache = new Set()

                    const resultJson = JSON.stringify(
                        result.result,
                        (_key: string, value: unknown) => {
                            if (typeof value === 'object' && value !== null) {
                                if (cache.has(value)) return '[Circular]'
                                cache.add(value)
                            }
                            if (typeof value === 'string') {
                                bytes += Buffer.byteLength(value, 'utf8') + 2 // include quotes
                            } else if (typeof value === 'number' || typeof value === 'boolean') {
                                bytes += Buffer.byteLength(String(value), 'utf8')
                            } else if (typeof value === 'bigint') {
                                bytes += Buffer.byteLength(value.toString(), 'utf8') + 2 // Treat as string
                                return value.toString()
                            } else {
                                bytes += 5 // brackets/keys/null overhead
                            }

                            if (bytes > egressLimit) {
                                throw new Error(`EgressLimitExceeded:${bytes}`)
                            }
                            return value
                        }
                    )

                    if (resultJson !== undefined) {
                        const byteLength = Buffer.byteLength(resultJson, 'utf8')
                        if (byteLength > egressLimit) {
                            throw new Error(`EgressLimitExceeded:${byteLength}`)
                        }
                        result.result = JSON.parse(resultJson)
                    } else {
                        result.result = undefined
                    }
                } catch (err) {
                    result.success = false
                    const egressLimit = maxResultSize ?? 100 * 1024
                    if (err instanceof Error && err.message.startsWith('EgressLimitExceeded:')) {
                        const actualBytesStr = err.message.split(':')[1]
                        const actualBytes =
                            actualBytesStr !== undefined ? Number(actualBytesStr) : egressLimit + 1
                        const actualKb = (actualBytes / 1024).toFixed(1)
                        result.error = `Output limit exceeded: Result serialization exceeded the ${Math.round(egressLimit / 1024)}KB boundary (Actual size: >${actualKb}KB). Please aggregate or filter your results to reduce the payload size.`
                    } else {
                        result.error = `Result could not be serialized or exceeded memory limits: ${err instanceof Error ? err.message : String(err)}`
                    }
                    result.result = undefined
                }
            }

            rpcPort?.close()
            rpcPort = null

            parentPort?.postMessage({ type: 'RESULT', id, result })
        }
    })()
})
