/**
 * Worker Sandbox Globals — builds the frozen `sandbox` object exposed to
 * `vm.createContext` with all top-level aliases, delegating wrappers, and shims.
 */

import { type SafeFsShim, pathShim, consoleShim, createPreparedStatementShim } from './node-shims.js'
import {
    createCallableShim,
    wrapDelegatingTool,
    createSchemaShim,
} from './namespace-shims.js'

export interface BuildSandboxGlobalsOptions {
    mjApi: Record<string, unknown>
    shimMj: Record<string, unknown>
    safeFsShim: SafeFsShim
    frozenContext: Record<string, unknown>
    executeCodeFn: (arg: unknown) => Promise<unknown>
    updateMemoryFn: (arg: unknown) => unknown
}

function getGroupMethod(
    shimMj: Record<string, unknown>,
    group: string,
    method: string
): ((...args: unknown[]) => unknown) | undefined {
    const g = shimMj[group]
    if ((typeof g === 'object' && g !== null) || typeof g === 'function') {
        const fn = Reflect.get(g, method) as unknown
        if (typeof fn === 'function') {
            return fn as (...args: unknown[]) => unknown
        }
    }
    return undefined
}

function makeDelegatingTool(
    shimMj: Record<string, unknown>,
    group: string,
    method: string
): unknown {
    return wrapDelegatingTool(
        (arg: unknown): unknown => getGroupMethod(shimMj, group, method)?.(arg),
        () => getGroupMethod(shimMj, group, method)
    )
}

function createProcessOperationFn(shimMj: Record<string, unknown>): (arg: unknown) => unknown {
    return (arg: unknown): unknown => {
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            const op =
                (Reflect.get(arg, 'operation') as unknown) ??
                (Reflect.get(arg, 'op') as unknown) ??
                (Reflect.get(arg, 'action') as unknown) ??
                (Reflect.get(arg, 'type') as unknown)
            if (
                op === 'add_entry' ||
                op === 'create_entry' ||
                op === 'create' ||
                op === 'add' ||
                op === 'insert'
            ) {
                return getGroupMethod(shimMj, 'core', 'createEntry')?.(arg)
            }
            if (op === 'update_entry' || op === 'update' || op === 'edit') {
                return getGroupMethod(shimMj, 'admin', 'updateEntry')?.(arg)
            }
            if (op === 'delete_entry' || op === 'delete' || op === 'remove') {
                return getGroupMethod(shimMj, 'admin', 'deleteEntry')?.(arg)
            }
            if (op === 'search_entries' || op === 'search' || op === 'find') {
                return getGroupMethod(shimMj, 'search', 'searchEntries')?.(arg)
            }
        }
        return getGroupMethod(shimMj, 'core', 'createEntry')?.(arg)
    }
}

const DELEGATING_TOOL_MAPPINGS: [string[], string, string][] = [
    [
        [
            'search_entries',
            'searchEntries',
            'query_entries',
            'queryEntries',
            'mj_search_entries',
            'mjSearchEntries',
        ],
        'search',
        'searchEntries',
    ],
    [
        ['get_recent_entries', 'getRecentEntries', 'mj_get_recent_entries', 'mjGetRecentEntries'],
        'core',
        'getRecentEntries',
    ],
    [
        ['get_entry_by_id', 'getEntryById', 'mj_get_entry_by_id', 'mjGetEntryById'],
        'core',
        'getEntryById',
    ],
    [
        ['list_projects', 'listProjects', 'mj_list_projects', 'mjListProjects'],
        'admin',
        'listProjects',
    ],
    [['get_project', 'getProject', 'mj_get_project', 'mjGetProject'], 'admin', 'getProject'],
    [['list_tags', 'listTags', 'mj_list_tags', 'mjListTags'], 'core', 'listTags'],
    [
        [
            'sqlite_journal_add_entry',
            'mj_create_entry',
            'mjCreateEntry',
            'create_entry',
            'createEntry',
            'insert_entry',
            'insertEntry',
            'add_entry',
            'addEntry',
            'new_entry',
            'newEntry',
            'log_entry',
            'logEntry',
            'save_entry',
            'saveEntry',
            'write_entry',
            'writeEntry',
        ],
        'core',
        'createEntry',
    ],
    [
        ['mj_update_entry', 'mjUpdateEntry', 'update_entry', 'updateEntry'],
        'admin',
        'updateEntry',
    ],
    [
        ['mj_delete_entry', 'mjDeleteEntry', 'delete_entry', 'deleteEntry'],
        'admin',
        'deleteEntry',
    ],
]

const DIRECT_CREATE_ENTRY_SHIMS = [
    'append',
    'append_entry',
    'appendEntry',
    'logJournal',
    'log_journal',
    'insertJournal',
    'insert_journal',
    'addJournal',
    'add_journal',
    'recordJournal',
    'record_journal',
    'appendJournal',
    'append_journal',
    'saveJournalEntry',
    'save_journal_entry',
    'addJournalEntry',
    'add_journal_entry',
    'createJournalEntry',
    'writeJournal',
]

/**
 * Builds and freezes the sandbox global object for `vm.createContext`.
 */
export function buildSandboxGlobals(
    options: BuildSandboxGlobalsOptions
): Record<string, unknown> {
    const { mjApi, shimMj, safeFsShim, frozenContext, executeCodeFn, updateMemoryFn } = options

    const servicesProxy = new Proxy({}, { get: (): unknown => shimMj })
    const kernelProxy = new Proxy({}, { get: (): unknown => shimMj })
    const callableShim = (): object => createCallableShim(shimMj)
    const schemaShim = createSchemaShim(shimMj)
    const getSchemaShim = (): object => createSchemaShim(shimMj)
    const processOpFn = createProcessOperationFn(shimMj)
    const directCreateFn = (arg: unknown): unknown =>
        getGroupMethod(shimMj, 'core', 'createEntry')?.(arg)
    const updateConfigFn = (arg: unknown): unknown =>
        (getGroupMethod(shimMj, 'admin', 'update_configuration') ??
            getGroupMethod(shimMj, 'admin', 'updateConfiguration'))?.(arg)
    const saveMemoryFn = (arg?: unknown): unknown =>
        arg !== undefined && arg !== null ? updateMemoryFn(arg) : Promise.resolve({ success: true })

    const sandbox: Record<string, unknown> = {
        mj: shimMj,
        mcp: shimMj,
        __mcp: shimMj,
        __mcp_server: shimMj,
        __mcp_client: shimMj,
        execute: executeCodeFn,
        mj_execute_code: executeCodeFn,
        execute_code: executeCodeFn,
        executeCode: executeCodeFn,
        mjExecuteCode: executeCodeFn,
        core: shimMj,
        journal: shimMj,
        _journal: shimMj,
        MJ: callableShim(),
        M: callableShim(),
        adapter: callableShim(),
        Entry: callableShim(),
        getJournal: () => Promise.resolve(shimMj),
        services: servicesProxy,
        kernel: kernelProxy,
        sqlite: shimMj,
        sqlite3: callableShim(),
        Database: callableShim(),
        better_sqlite3: callableShim(),
        betterSqlite3: callableShim(),
        BetterSqlite3: callableShim(),
        Sqlite3: callableShim(),
        cp: shimMj,
        child_process: shimMj,
        fs: safeFsShim,
        __safeFs: safeFsShim,
        safeFs: safeFsShim,
        path: pathShim,
        __path: pathShim,
        os: shimMj,
        util: shimMj,
        crypto: shimMj,
        buffer: shimMj,
        execSync: (..._args: unknown[]) => '',
        spawnSync: () => ({ status: 0, stdout: '', stderr: '', output: ['', '', ''] }),
        exec: (_cmd: unknown, cb?: unknown) => {
            if (typeof cb === 'function') {
                try {
                    ;(cb as (...args: unknown[]) => unknown)(null, '', '')
                } catch {
                    // Ignore callback error
                }
            }
        },
        spawn: () => {
            const noop = (): void => {
                // Dummy event listener
            }
            return { on: noop, stdout: { on: noop }, stderr: { on: noop } }
        },
        postgres: shimMj,
        mysql: shimMj,
        db: shimMj,
        api: shimMj,
        memory: shimMj,
        mcpx: shimMj,
        memoryJournal: callableShim(),
        MemoryJournal: callableShim(),
        memory_journal: callableShim(),
        memory_journal_mcp: callableShim(),
        m: shimMj,
        env: shimMj,
        agent: shimMj,
        tools: shimMj,
        sdk: shimMj,
        client: shimMj,
        system: shimMj,
        projects: shimMj['projects'],
        tags: shimMj['tags'],
        utils: shimMj,
        sql: shimMj,
        schema: schemaShim,
        Schema: callableShim(),
        getSchema: getSchemaShim,
        get_schema: getSchemaShim,
        tables: schemaShim,
        Tables: callableShim(),
        getTables: getSchemaShim,
        get_tables: getSchemaShim,
        getInstance: () => shimMj,
        get_instance: () => shimMj,
        getClient: () => shimMj,
        get_client: () => shimMj,
        createClient: () => shimMj,
        create_client: () => shimMj,
        createInstance: () => shimMj,
        create_instance: () => shimMj,
        initClient: () => shimMj,
        init_client: () => shimMj,
        getDb: () => shimMj,
        get_db: () => shimMj,
        getDatabase: () => shimMj,
        get_database: () => shimMj,
        connectToDatabase: () => shimMj,
        openDatabase: () => shimMj,
        open_database: () => shimMj,
        prepare: (sql?: string) =>
            createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj),
        process_operation: processOpFn,
        processOperation: processOpFn,
        updateMemory: updateMemoryFn,
        update_memory: updateMemoryFn,
        setMemory: updateMemoryFn,
        set_memory: updateMemoryFn,
        updateJournal: updateMemoryFn,
        update_journal: updateMemoryFn,
        addMemory: updateMemoryFn,
        add_memory: updateMemoryFn,
        recordMemory: updateMemoryFn,
        record_memory: updateMemoryFn,
        createMemory: updateMemoryFn,
        create_memory: updateMemoryFn,
        loadJournal: (): Promise<unknown> => Promise.resolve(shimMj),
        saveJournal: (): Promise<unknown> => Promise.resolve({ success: true }),
        readJournal: (): unknown =>
            getGroupMethod(shimMj, 'core', 'getRecentEntries')?.({ limit: 50 }),
        loadMemory: (): Promise<unknown> => Promise.resolve(shimMj),
        saveMemory: saveMemoryFn,
        save_memory: saveMemoryFn,
        update_configuration: updateConfigFn,
        updateConfiguration: updateConfigFn,
        context: frozenContext,
        console: consoleShim,
        fetch: (..._args: unknown[]) => {
            const errObj = {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Direct HTTP 'fetch()' is disabled in sandboxed Code Mode. To query metrics or system state, use mj.analytics.* or mj.admin.* tools (e.g. mj.analytics.getStatistics()).`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            }
            return Promise.resolve({
                ...errObj,
                json: () => Promise.resolve(errObj),
                text: () => Promise.resolve(JSON.stringify(errObj)),
                ok: false,
                status: 403,
            })
        },
        sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        setTimeout: (cb: (...args: unknown[]) => void, ms: number, ...args: unknown[]) =>
            setTimeout(cb, ms, ...args),
        setInterval: undefined,
        setImmediate: undefined,
        getConfig: () => Promise.resolve({ dbPath: 'memory-journal.db' }),
        process: Object.freeze({
            exit: (code?: number) => ({
                success: (code ?? 0) === 0,
                exited: true,
                exitCode: code ?? 0,
            }),
            env: Object.freeze({}),
        }),
        require: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        globalThis: shimMj,
        Proxy: undefined,
    }

    for (const [aliases, group, method] of DELEGATING_TOOL_MAPPINGS) {
        const delegated = makeDelegatingTool(shimMj, group, method)
        for (const alias of aliases) {
            sandbox[alias] = delegated
        }
    }

    for (const name of DIRECT_CREATE_ENTRY_SHIMS) {
        sandbox[name] = directCreateFn
    }

    // Spread all callable methods from all groups into the sandbox as standalone globals
    for (const key of Object.keys(mjApi)) {
        const val = shimMj[key]
        if ((val !== null && typeof val === 'object') || typeof val === 'function') {
            for (const groupMethod of Object.keys(val)) {
                if (groupMethod in sandbox) continue
                const fn = Reflect.get(val, groupMethod) as unknown
                if (typeof fn === 'function') {
                    sandbox[groupMethod] = fn
                }
            }
            if (typeof val === 'function' && !(key in sandbox)) {
                sandbox[key] = val
            }
        }
    }

    return Object.freeze(sandbox)
}
