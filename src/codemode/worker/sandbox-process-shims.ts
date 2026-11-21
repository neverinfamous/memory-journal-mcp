/**
 * Process, child_process, fetch, and factory/namespace shims for Code Mode worker globals.
 */

import type { SafeFsShim } from './node-shims.js'
import { createCallableShim, createSchemaShim, wrapDelegatingTool } from './namespace-shims.js'
import { safeFormatSandboxError } from './script-and-metadata-cache.js'

export const FACTORY_SHIM_NAMES = [
    'getInstance', 'get_instance', 'createInstance', 'create_instance',
    'getClient', 'get_client', 'createClient', 'create_client',
    'initClient', 'init_client', 'getService', 'get_service',
    'createService', 'create_service', 'getJournal', 'get_journal',
    'createJournal', 'create_journal', 'loadJournal', 'load_journal',
    'loadMemory', 'load_memory', 'load', 'init', 'initialize',
    'connect', 'open', 'start', 'create',
] as const

export const DIRECT_CREATE_ENTRY_SHIMS = [
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
] as const

export const DELEGATING_TOOL_MAPPINGS: [string[], string, string][] = [
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

export function getGroupMethod(
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

export function createProcessOperationFn(shimMj: Record<string, unknown>): (arg: unknown) => unknown {
    return (arg: unknown): unknown => {
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            const op =
                (Reflect.get(arg, 'operation') as unknown) ??
                (Reflect.get(arg, 'op') as unknown) ??
                (Reflect.get(arg, 'action') as unknown) ??
                (Reflect.get(arg, 'type') as unknown)
            if (op === 'add_entry' || op === 'create_entry' || op === 'create' || op === 'add' || op === 'insert') {
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
        return Promise.resolve({
            success: false,
            code: 'VALIDATION_ERROR',
            error: 'Unknown process operation',
            _healing_note: 'The operation was not executed.',
        })
    }
}

/**
 * Shared spawn-disabled shim factory reused across sandbox process shims
 * and mj shim proxy mocks so blocked spawn/spawnSync/fork calls log consistently.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_SEP_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g
const SHIM_NOOP = (): void => {
    /* no-op */
}

function formatSandboxCallbackError(callbackError: unknown): string {
    const msg = safeFormatSandboxError(callbackError).message
    return msg.replace(CONTROL_CHAR_SEP_RE, ' ').slice(0, 512)
}

export function createDisabledSpawnShim(
    label = 'spawn'
): (_cmd?: unknown, cbOrOptions?: unknown, maybeCb?: unknown) => Record<string, unknown> {
    return (_cmd?: unknown, cbOrOptions?: unknown, maybeCb?: unknown) => {
        const cb =
            typeof cbOrOptions === 'function'
                ? (cbOrOptions as (...args: unknown[]) => unknown)
                : typeof maybeCb === 'function'
                  ? (maybeCb as (...args: unknown[]) => unknown)
                  : undefined
        if (cb !== undefined) {
            try {
                cb(new Error(`${label} is disabled in the sandbox`), '', '')
            } catch (callbackError) {
                // Callback errors must not escape the shim; the worker has no logger, so use stderr.
                process.stderr.write(
                    `[codemode] ${label} shim callback threw: ${formatSandboxCallbackError(callbackError)}\n`
                )
            }
        }
        return {
            on: SHIM_NOOP,
            stdout: { on: SHIM_NOOP },
            stderr: { on: SHIM_NOOP },
            kill: () => false,
            status: 1,
            output: ['', '', `${label} is disabled in the sandbox`],
            error: new Error(`${label} is disabled in the sandbox`),
        }
    }
}

export function createChildProcessShims(): Record<string, unknown> {
    return {
        execSync: (..._args: unknown[]) => {
            const err = new Error('VALIDATION_ERROR: child_process.execSync is disabled inside Code Mode.')
            err.name = 'VALIDATION_ERROR'
            throw err
        },
        spawnSync: () => ({
            status: 1,
            stdout: '',
            stderr: 'spawnSync is disabled in the sandbox',
            output: ['', '', 'spawnSync is disabled in the sandbox'],
            error: new Error('spawnSync is disabled in the sandbox'),
        }),
        exec: (_cmd: unknown, cb?: unknown) => {
            if (typeof cb === 'function') {
                try {
                    ;(cb as (...args: unknown[]) => unknown)(
                        new Error('exec is disabled in the sandbox'),
                        '',
                        ''
                    )
                } catch (callbackError) {
                    // Callback errors must not escape the shim; the worker has no logger, so use stderr.
                    process.stderr.write(
                        `[codemode] exec shim callback threw: ${formatSandboxCallbackError(callbackError)}\n`
                    )
                }
            }
        },
        spawn: createDisabledSpawnShim('spawn'),
    }
}

export function createFetchShim(): (...args: unknown[]) => Promise<Record<string, unknown>> {
    return (..._args: unknown[]) => {
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
    }
}

export function createSandboxProcessObject(): Record<string, unknown> {
    return Object.freeze({
        exit: (code?: number) => ({
            success: false,
            exited: false,
            exitCode: code ?? 0,
            error: 'process.exit is disabled in the sandbox',
        }),
        env: Object.freeze({}),
    })
}

function buildDbAndModuleAliasShims(
    shimMj: Record<string, unknown>,
    safeFsShim: SafeFsShim,
    callableShim: () => object
): Record<string, unknown> {
    const schemaShim = createSchemaShim(shimMj)
    const getSchemaShim = (): object => createSchemaShim(shimMj)
    return {
        getJournal: () => Promise.resolve(shimMj),
        loadJournal: (): Promise<unknown> => Promise.resolve(shimMj),
        loadMemory: (): Promise<unknown> => Promise.resolve(shimMj),
        MJ: callableShim(),
        M: callableShim(),
        adapter: callableShim(),
        Entry: callableShim(),
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
        os: shimMj,
        util: shimMj,
        crypto: shimMj,
        buffer: shimMj,
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
        getDb: () => shimMj,
        get_db: () => shimMj,
        getDatabase: () => shimMj,
        get_database: () => shimMj,
        connectToDatabase: () => shimMj,
        openDatabase: () => shimMj,
        open_database: () => shimMj,
    }
}

function buildMemoryActionAliasShims(
    shimMj: Record<string, unknown>,
    updateMemoryFn: (...args: unknown[]) => unknown
): Record<string, unknown> {
    const processOpFn = createProcessOperationFn(shimMj)
    const saveMemoryFn = (...args: unknown[]): unknown =>
        args[0] !== undefined && args[0] !== null
            ? updateMemoryFn(...args)
            : Promise.resolve({ success: false, code: 'VALIDATION_ERROR', error: 'saveMemory requires a payload' })
    const updateConfigFn = (...args: unknown[]): unknown => {
        const adminGroup = shimMj['admin']
        const isGroupObj =
            (typeof adminGroup === 'object' && adminGroup !== null) || typeof adminGroup === 'function'
        const preferred =
            isGroupObj && 'update_configuration' in adminGroup
                ? 'update_configuration'
                : 'updateConfiguration'
        return (
            getGroupMethod(shimMj, 'admin', preferred) ??
            getGroupMethod(shimMj, 'admin', 'update_configuration')
        )?.(...args)
    }
    return {
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
        saveJournal: (): Promise<unknown> =>
            Promise.resolve({ success: false, code: 'VALIDATION_ERROR', error: 'saveJournal is not available in the sandbox' }),
        readJournal: (): Promise<unknown> =>
            Promise.resolve({
                success: false,
                code: 'VALIDATION_ERROR',
                error: 'readJournal is not available in the sandbox',
                _healing_note: 'Use mj.core.getRecentEntries or mj.search.searchEntries.',
            }),
        saveMemory: saveMemoryFn,
        save_memory: saveMemoryFn,
        update_configuration: updateConfigFn,
        updateConfiguration: updateConfigFn,
    }
}

export function buildMemoryAndFactoryShims(
    shimMj: Record<string, unknown>,
    safeFsShim: SafeFsShim,
    updateMemoryFn: (...args: unknown[]) => unknown
): Record<string, unknown> {
    const sharedCallableShim = createCallableShim(shimMj)
    const callableShim = (): object => sharedCallableShim
    const factoryShims: Record<string, unknown> = {}
    for (const name of FACTORY_SHIM_NAMES) {
        factoryShims[name] = () => shimMj
    }

    const aliases: Record<string, unknown> = {
        ...factoryShims,
        ...buildDbAndModuleAliasShims(shimMj, safeFsShim, callableShim),
        ...buildMemoryActionAliasShims(shimMj, updateMemoryFn),
    }

    for (const [mappingAliases, group, method] of DELEGATING_TOOL_MAPPINGS) {
        const delegated = wrapDelegatingTool(
            (...args: unknown[]): unknown => getGroupMethod(shimMj, group, method)?.(...args),
            () => getGroupMethod(shimMj, group, method)
        )
        for (const alias of mappingAliases) {
            aliases[alias] = delegated
        }
    }

    const directCreateFn = (...args: unknown[]): unknown =>
        getGroupMethod(shimMj, 'core', 'createEntry')?.(...args)
    for (const name of DIRECT_CREATE_ENTRY_SHIMS) {
        aliases[name] = directCreateFn
    }

    return aliases
}
