/**
 * Worker Namespace Shims — helper factories for callable shims, schema shims,
 * delegating tool wrappers, and `context` proxy fallbacks.
 */

import { wrapResult } from '../worker-result-proxy.js'
import { JOURNAL_TABLES, getSchemaHelp, listJournalTables } from '../api/schema-help.js'
import {
    deepFreezeContextClone,
    IMMUTABLE_PROXY_TRAPS,
    READONLY_MUTATION_TRAPS,
} from './result-proxy-aliases.js'

export const DB_TO_JOURNAL: Record<string, [string, string]> = Object.assign(
    Object.create(null) as Record<string, [string, string]>,
    {
        count: ['analytics', 'getStatistics'],
        analyze: ['analytics', 'getStatistics'],
        exists: ['core', 'getEntryById'],
        upsert: ['core', 'createEntry'],
        batchInsert: ['core', 'createEntry'],
        readQuery: ['core', 'readQuery'],
    }
)

const DB_MAINTENANCE_CALLS = new Set(['vacuum', 'integrityCheck'])
const SCHEMA_OPS_NOT_RUN = new Set(['listTables', 'describeTable'])

export function isDbMaintenanceCall(name: string): boolean {
    return SCHEMA_OPS_NOT_RUN.has(name) || DB_MAINTENANCE_CALLS.has(name)
}

/** [L3] The call name is passed explicitly; no module-global state is shared between calls. */
export function createMaintenanceUnavailableFn(name: string): () => Promise<{
    success: false
    error: string
    code: string
}> {
    if (SCHEMA_OPS_NOT_RUN.has(name)) {
        return () =>
            Promise.resolve({
                success: false,
                code: 'VALIDATION_ERROR',
                error: `Schema operation '${name}' did not run`,
            })
    }
    return () =>
        Promise.resolve({
            success: false,
            error: 'Maintenance call is not available',
            code: 'VALIDATION_ERROR',
        })
}

/**
 * Creates a callable/constructable proxy that resolves all calls and property reads to `shimMj`.
 */
export function createCallableShim(shimMj: Record<string, unknown>, fnName = 'MemoryJournal'): object {
    const callableFn = function (this: unknown, ..._args: unknown[]): unknown {
        return shimMj
    }
    return new Proxy(callableFn, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply(_t, _thisArg, _args): unknown {
            return shimMj
        },
        construct(_t, _args): object {
            return shimMj
        },
        get(_t, p): unknown {
            if (p === 'then') return undefined
            if (p === 'name') return fnName
            if (p === 'length') return 0
            if (p === 'bind' || p === 'call' || p === 'apply' || p === 'toString') {
                return Function.prototype[p].bind(callableFn)
            }
            return typeof p === 'string' ? shimMj[p] : undefined
        },
    })
}

function isTargetLike(val: unknown): val is object {
    return (typeof val === 'object' && val !== null) || typeof val === 'function'
}

function isEntryIdAndPatchArgs(args: unknown[]): boolean {
    if (args.length < 2) return false
    const first = args[0]
    const second = args[1]
    const validId =
        (typeof first === 'number' && Number.isSafeInteger(first) && first > 0) ||
        (typeof first === 'string' && /^[1-9]\d*$/.test(first.trim()))
    return validId && typeof second === 'object' && second !== null && !Array.isArray(second)
}

/**
 * Creates the `updateMemory` / `setMemory` / `updateJournal` smart router function.
 */
export function createUpdateMemoryFn(
    shimMj: Record<string, unknown>
): (...args: unknown[]) => unknown {
    const updateMemoryFn = (...args: unknown[]): unknown => {
        const arg = args[0]
        const hasObjectEntryId =
            typeof arg === 'object' &&
            arg !== null &&
            !Array.isArray(arg) &&
            ((Reflect.get(arg, 'entry_id') as unknown) ??
                (Reflect.get(arg, 'id') as unknown) ??
                (Reflect.get(arg, 'entryId') as unknown)) != null
        if (hasObjectEntryId || isEntryIdAndPatchArgs(args)) {
            const adminGroup = shimMj['admin']
            const coreGroup = shimMj['core']
            const fn =
                (isTargetLike(adminGroup)
                    ? ((Reflect.get(adminGroup, 'updateEntry') as unknown) ??
                      (Reflect.get(adminGroup, 'update_entry') as unknown))
                    : undefined) ??
                (isTargetLike(coreGroup)
                    ? (Reflect.get(coreGroup, 'updateEntry') as unknown)
                    : undefined)
            if (typeof fn === 'function') {
                return (fn as (...a: unknown[]) => unknown)(...args)
            }
        }
        const coreGroup = shimMj['core']
        if (isTargetLike(coreGroup)) {
            const createFn = Reflect.get(coreGroup, 'createEntry') as unknown
            if (typeof createFn === 'function') {
                return (createFn as (...a: unknown[]) => unknown)(...args)
            }
        }
        return undefined
    }

    Object.assign(updateMemoryFn, {
        help: (): Promise<unknown> =>
            Promise.resolve({
                name: 'updateMemory',
                group: 'core',
                description:
                    'Record or update an entry in the memory journal. Pass { title, content, tags, ... } to create an entry, or include entry_id to update an existing entry.',
            }),
        describe: (): Promise<unknown> =>
            Promise.resolve({
                name: 'updateMemory',
                group: 'core',
                description:
                    'Record or update an entry in the memory journal. Pass { title, content, tags, ... } to create an entry, or include entry_id to update an existing entry.',
            }),
        schema: (): Promise<unknown> => {
            const coreGroup = shimMj['core']
            if (isTargetLike(coreGroup)) {
                const createEntry = Reflect.get(coreGroup, 'createEntry') as unknown
                if (isTargetLike(createEntry) && 'schema' in createEntry) {
                    const schemaFn: unknown = Reflect.get(createEntry, 'schema')
                    if (typeof schemaFn === 'function') {
                        return (schemaFn as () => Promise<unknown>)()
                    }
                }
            }
            return Promise.resolve('unknown')
        },
    })

    return updateMemoryFn
}

/**
 * Wraps a top-level delegating function so `.schema()`, `.help()`, and `.describe()`
 * forward to the underlying method on `shimMj`.
 */
export function wrapDelegatingTool(
    fn: (...args: unknown[]) => unknown,
    targetFnGetter: () => unknown
): unknown {
    return new Proxy(fn, {
        ...IMMUTABLE_PROXY_TRAPS,
        get(target, prop, receiver): unknown {
            const real = targetFnGetter()
            if (
                (typeof real === 'object' && real !== null) ||
                typeof real === 'function'
            ) {
                if (prop in real) {
                    return Reflect.get(real, prop) as unknown
                }
            }
            return Reflect.get(target, prop, receiver) as unknown
        },
    })
}

const SHIM_TABLES = JOURNAL_TABLES

export const schemaHelpFn = Object.freeze((): Promise<unknown> => getSchemaHelp())

/**
 * Creates the `schema` shim proxy for `shimMj`.
 */
export function createSchemaShim(shimMj: Record<string, unknown>): object {
    const schemaCallable = function (): unknown {
        return schemaHelpFn()
    }
    return new Proxy(schemaCallable, {
        ...IMMUTABLE_PROXY_TRAPS,
        apply(): unknown {
            return schemaHelpFn()
        },
        get(_t, p: string | symbol): unknown {
            if (p === 'then') return undefined
            if (p === 'help' || p === 'describe') return schemaHelpFn
            if (p === 'listTables') return listJournalTables
            if (p === 'describeTable' || p === 'getSchema') return schemaHelpFn
            if (p === 'schema') return createSchemaShim(shimMj)
            if (p === 'tables') return SHIM_TABLES
            if (p === 'memory_journal' || p === 'entries' || p === 'journal' || p === 'memory') {
                const coreGroup = shimMj['core']
                if (isTargetLike(coreGroup)) {
                    const createEntry = Reflect.get(coreGroup, 'createEntry') as unknown
                    if (isTargetLike(createEntry) && 'schema' in createEntry) {
                        const schemaFn: unknown = Reflect.get(createEntry, 'schema')
                        if (typeof schemaFn === 'function') {
                            return (schemaFn as () => Promise<unknown>)()
                        }
                    }
                }
                return schemaHelpFn()
            }
            if (typeof p === 'string' && p in Function.prototype) {
                return Reflect.get(Function.prototype, p) as unknown
            }
            return Reflect.get(shimMj, p) as unknown
        },
    })
}

/**
 * Creates an empty iterable/array-like/map-like fallback for missing collection properties on `context`.
 */
export function createEmptyFallback(): unknown {
    const emptyIter = function* (): Generator<never, void, unknown> {
        /* empty */
    }
    const fallback: Record<string | symbol, unknown> = {
        values: () => emptyIter(),
        keys: () => emptyIter(),
        entries: () => emptyIter(),
        forEach: () => undefined,
        get: () => undefined,
        has: () => false,
        set: () => proxy,
        delete: () => false,
        clear: () => undefined,
        size: 0,
        length: 0,
        [Symbol.iterator]: emptyIter,
        map: () => [],
        filter: () => [],
        reduce: (_fn: unknown, init: unknown) => init ?? [],
        reduceRight: (_fn: unknown, init: unknown) => init ?? [],
        slice: () => [],
        find: () => undefined,
        findIndex: () => -1,
        some: () => false,
        every: () => true,
        includes: () => false,
        indexOf: () => -1,
        join: () => '',
        concat: () => [],
        at: () => undefined,
        flat: () => [],
        flatMap: () => [],
    }
    const proxy: unknown = new Proxy(fallback, {
        ...IMMUTABLE_PROXY_TRAPS,
        get(t, p): unknown {
            if (p in t) return t[p]
            if (typeof p === 'symbol') return undefined
            return undefined
        },
    })
    return proxy
}

const CONTEXT_COLLECTION_NAMES: ReadonlySet<string> = new Set([
    'entries',
    'results',
    'projects',
    'items',
    'rows',
    'tables',
    'flags',
    'groups',
    'users',
    'capabilities',
    'metrics',
    'events',
    'records',
    'logs',
    'aliases',
    'tags',
    'issues',
    'pullRequests',
    'milestones',
    'columns',
    'comments',
    'files',
    'errors',
    'backups',
    'deleted',
    'updated',
    'notFound',
    'history',
    'relationships',
    'members',
    'data',
    'map',
    'list',
])

function stringifyContextTarget(target: Record<string, unknown>): string {
    try {
        return JSON.stringify(target)
    } catch {
        return '[object Object]'
    }
}

function createContextGetFn(
    target: Record<string, unknown>
): (key?: string) => Promise<unknown> {
    return (key?: string) => {
        if (typeof key !== 'string') {
            return Promise.resolve(wrapResult(target))
        }
        const snakeKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
        if (Object.hasOwn(target, key)) return Promise.resolve(wrapResult(target[key]))
        if (snakeKey !== key && Object.hasOwn(target, snakeKey)) {
            return Promise.resolve(wrapResult(target[snakeKey]))
        }
        return Promise.resolve(
            wrapResult({
                success: false,
                error: `Context key '${key}' was not found`,
                code: 'RESOURCE_NOT_FOUND',
            })
        )
    }
}

function createPromptBlockedFn(prop: string): (_promptName?: string) => Promise<unknown> {
    return (_promptName?: string) =>
        Promise.resolve({
            success: false,
            error: `Code Mode cannot execute MCP Prompts via context.${prop}(). Code Mode is for running JavaScript with mj.* tools. Use mj.core.createEntry to save entries.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        })
}

function resolveContextProxyProp(target: Record<string, unknown>, prop: string | symbol): unknown {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Reflect.get(target, prop)
    }
    if (typeof prop === 'symbol') {
        if (prop === Symbol.toPrimitive) {
            return (hint: string) =>
                hint === 'number' ? NaN : stringifyContextTarget(target)
        }
        return undefined
    }
    if (prop === 'toString') return () => stringifyContextTarget(target)
    if (prop === 'toJSON') return () => target
    if (prop === 'get' || prop === 'getContext' || prop === 'get_context') {
        return createContextGetFn(target)
    }
    // [INVARIANT]: Outer MCP parameter normalization converts camelCase keys inside `context`
    // into snake_case; fall back transparently so `context.myKey` resolves `target.my_key`.
    const snakeProp = prop.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    if (snakeProp !== prop && Object.hasOwn(target, snakeProp)) {
        return target[snakeProp]
    }
    if (prop === 'executeSystemPrompt' || prop === 'getPrompt' || prop === 'executePrompt') {
        return createPromptBlockedFn(prop)
    }
    if (CONTEXT_COLLECTION_NAMES.has(prop)) {
        return createEmptyFallback()
    }
    return undefined
}

export function createContextProxy(contextObj?: Record<string, unknown>): Record<string, unknown> {
    const target =
        contextObj !== undefined
            ? (deepFreezeContextClone(contextObj) as Record<string, unknown>)
            : Object.freeze({})
    return new Proxy(target, {
        get: (t, prop): unknown => resolveContextProxyProp(t, prop),
        ...READONLY_MUTATION_TRAPS,
    })
}
