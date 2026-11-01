/**
 * Worker Namespace Shims — helper factories for callable shims, schema shims,
 * delegating tool wrappers, and `context` proxy fallbacks.
 */

import { wrapResult } from '../worker-result-proxy.js'

export const DB_TO_JOURNAL: Record<string, [string, string]> = {
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

/**
 * Creates a callable/constructable proxy that resolves all calls and property reads to `shimMj`.
 */
export function createCallableShim(shimMj: Record<string, unknown>, fnName = 'MemoryJournal'): object {
    const callableFn = function (this: unknown, ..._args: unknown[]): unknown {
        return shimMj
    }
    return new Proxy(callableFn, {
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

/**
 * Creates the `updateMemory` / `setMemory` / `updateJournal` smart router function.
 */
export function createUpdateMemoryFn(
    shimMj: Record<string, unknown>
): (arg: unknown) => unknown {
    const updateMemoryFn = (arg: unknown): unknown => {
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            const entryId =
                (Reflect.get(arg, 'entry_id') as unknown) ??
                (Reflect.get(arg, 'id') as unknown) ??
                (Reflect.get(arg, 'entryId') as unknown)
            if (entryId !== undefined && entryId !== null) {
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
                    return (fn as (a: unknown) => unknown)(arg)
                }
            }
        }
        const coreGroup = shimMj['core']
        if (isTargetLike(coreGroup)) {
            const createFn = Reflect.get(coreGroup, 'createEntry') as unknown
            if (typeof createFn === 'function') {
                return (createFn as (a: unknown) => unknown)(arg)
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

export const schemaHelpFn = (): Promise<unknown> =>
    Promise.resolve({
        group: 'schema',
        description:
            'Memory Journal Schema: Embedded SQLite database storing entries, tags, entry tags, relationships, and projects.',
        tables: ['entries', 'tags', 'entry_tags', 'relationships', 'projects'],
        entrySchema: {
            id: 'number (auto-increment primary key)',
            title: 'string (required, entry title)',
            content: 'string (markdown body)',
            entry_type: "'journal' | 'retrospective' | 'decision' | 'note' | 'runbook'",
            tags: 'string[] (optional array of tags)',
            project_number: 'number (optional project number)',
            session_id: 'string (optional session tracking id)',
            metadata: 'Record<string, unknown> (optional JSON metadata)',
        },
        methods: ['help', 'describe', 'listTables', 'describeTable', 'getSchema'],
        usage: 'Call mj.core.createEntry.schema() for entry parameter details, or mj.analytics.getStatistics() for database statistics.',
    })

/**
 * Creates the `schema` shim proxy for `shimMj`.
 */
export function createSchemaShim(shimMj: Record<string, unknown>): object {
    const getStatsFn = (): ((...args: unknown[]) => unknown) | undefined => {
        const analyticsGroup = shimMj['analytics']
        if (isTargetLike(analyticsGroup)) {
            const fn = Reflect.get(analyticsGroup, 'getStatistics') as unknown
            if (typeof fn === 'function') {
                return fn as (...args: unknown[]) => unknown
            }
        }
        return undefined
    }

    const schemaCallable = function (...args: unknown[]): unknown {
        const fn = getStatsFn()
        if (fn !== undefined) {
            return fn(...args)
        }
        return schemaHelpFn()
    }
    return new Proxy(schemaCallable, {
        apply(_t, _thisArg, args: unknown[]): unknown {
            const fn = getStatsFn()
            if (fn !== undefined) {
                return Reflect.apply(fn, undefined, args)
            }
            return schemaHelpFn()
        },
        get(_t, p: string | symbol): unknown {
            if (p === 'then') return undefined
            if (p === 'help' || p === 'describe') return schemaHelpFn
            if (p === 'listTables') {
                return (): Promise<unknown> =>
                    Promise.resolve({
                        success: true,
                        tables: ['entries', 'tags', 'entry_tags', 'relationships', 'projects'],
                    })
            }
            if (p === 'describeTable' || p === 'getSchema') return schemaHelpFn
            if (p === 'schema') return createSchemaShim(shimMj)
            if (p === 'tables')
                return ['entries', 'tags', 'entry_tags', 'relationships', 'projects']
            if (p === 'entries' || p === 'journal' || p === 'memory') {
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
export function createEmptyFallback(_name: string): unknown {
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
        set: () => fallback,
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
    return new Proxy(fallback, {
        get(t, p): unknown {
            if (p in t) return t[p]
            if (typeof p === 'symbol') return undefined
            return undefined
        },
    })
}

const CONTEXT_COLLECTION_NAMES = [
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
]

/**
 * Builds the frozen `context` global proxy for the sandbox.
 */
export function createContextProxy(contextObj?: Record<string, unknown>): Record<string, unknown> {
    const contextProxy = new Proxy(contextObj ?? {}, {
        get(target, prop): unknown {
            if (typeof prop === 'symbol') {
                if (prop === Symbol.toPrimitive) {
                    return (hint: string) => {
                        if (hint === 'number') return NaN
                        try {
                            return JSON.stringify(target)
                        } catch {
                            return '[object Object]'
                        }
                    }
                }
                return undefined
            }
            if (prop === 'toString') {
                return () => {
                    try {
                        return JSON.stringify(target)
                    } catch {
                        return '[object Object]'
                    }
                }
            }
            if (prop === 'toJSON') {
                return () => target
            }
            if (prop === 'get' || prop === 'getContext' || prop === 'get_context') {
                return (key?: string) =>
                    Promise.resolve(
                        wrapResult(
                            typeof key === 'string' && key in target
                                ? target[key]
                                : { success: true, ...target }
                        )
                    )
            }
            if (prop in target) return target[prop]
            if (
                prop === 'executeSystemPrompt' ||
                prop === 'getPrompt' ||
                prop === 'executePrompt'
            ) {
                return (_promptName?: string) =>
                    Promise.resolve({
                        success: false,
                        error: `Code Mode cannot execute MCP Prompts via context.${prop}(). Code Mode is for running JavaScript with mj.* tools. Use mj.core.createEntry to save entries.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true,
                    })
            }
            if (typeof prop === 'string' && CONTEXT_COLLECTION_NAMES.includes(prop)) {
                return createEmptyFallback(prop)
            }
            return target[prop]
        },
    })
    return Object.freeze(contextProxy)
}
