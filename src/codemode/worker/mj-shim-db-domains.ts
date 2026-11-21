/**
 * Worker `shimMj` DB, Adapter, and System Domain Builders.
 * [BOUNDARY] Zero-dep worker module: uses build-time `PACKAGE_VERSION` (no `createRequire`/`fs`).
 */

import { PACKAGE_VERSION } from '../package-version.js'
import { createPreparedStatementShim } from './node-shims.js'
import { createSchemaShim } from './namespace-shims.js'
import { IMMUTABLE_PROXY_TRAPS } from './result-proxy-aliases.js'

function getGroupProp(target: Record<string, unknown>, group: string, prop: string): unknown {
    const g = target[group]
    return (typeof g === 'object' && g !== null) || typeof g === 'function'
        ? (Reflect.get(g, prop) as unknown)
        : undefined
}

const ADAPTER_ITEMS = Object.freeze(
    [
        {
            name: 'sqlite',
            type: 'database',
            driver: 'better-sqlite3',
            status: 'connected',
            primary: true,
            description: 'Primary SQLite storage engine for journal entries, tags, and relationships',
        },
        {
            name: 'sqlite-vec',
            type: 'vector',
            driver: 'sqlite-vec',
            status: 'connected',
            description: 'Native vector embeddings and semantic search engine',
        },
        {
            name: 'team',
            type: 'database',
            driver: 'better-sqlite3',
            status: 'connected',
            description: 'Collaborative team journal database adapter',
        },
        {
            name: 'github',
            type: 'integration',
            driver: 'octokit / gh',
            status: 'connected',
            description: 'GitHub synchronization and issue tracking adapter',
        },
    ].map((item) => Object.freeze(item))
)

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
        ...IMMUTABLE_PROXY_TRAPS,
        apply: () => returnAdapters(),
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p in t) return Reflect.get(t, p) as unknown
            return returnAdapters
        },
    })
}

const RESOURCE_SUGGESTIONS: Record<string, string> = {
    'memory://agent-context': 'mj.core.getStatistics() or mj.core.listProjects()',
    'memory://agent-id':
        'mj.core.getStatistics() or mj.core.listProjects() (prefer memory://agent-context/<repo>)',
    'memory://recent': 'mj.core.getRecentEntries()',
    'memory://statistics': 'mj.analytics.getStatistics()',
    'memory://tags': 'mj.core.listTags()',
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

const STATS_METHOD_KEYS = new Set([
    'getStatistics', 'getStats', 'stats', 'info', 'getInfo', 'getDatabaseInfo', 'databaseInfo',
    'getHealth', 'health', 'status', 'getStatus', 'serverInfo', 'server_info', 'serverHealth',
    'server_health', 'serverStatus', 'server_status', 'healthCheck', 'health_check',
    'diagnostics', 'getDiagnostics', 'systemInfo', 'system_info', 'adapters', 'listAdapters',
    'list_adapters', 'getAdapters', 'get_adapters',
])

function createStatementMethodHandler(
    dbProp: string,
    shimMj: Record<string, unknown>
): ((sql?: string, ...args: unknown[]) => unknown) | undefined {
    if (dbProp === 'prepare' || dbProp === 'stmt' || dbProp === 'statement') {
        return (sql?: string) =>
            createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
    }
    if (dbProp === 'exec' || dbProp === 'query' || dbProp === 'raw') {
        const methodKey = dbProp === 'exec' ? 'run' : 'all'
        return (sql?: string, ...args: unknown[]) => {
            const stmt = createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj)
            const fn = stmt[methodKey]
            return typeof fn === 'function'
                ? (fn as (...a: unknown[]) => unknown)(...args)
                : undefined
        }
    }
    return undefined
}

export function createDbDomainProxy(
    target: Record<string, unknown>,
    shimMj: Record<string, unknown>
): object {
    const getStatsFn =
        getGroupProp(target, 'analytics', 'getStatistics') ??
        getGroupProp(target, 'analytics', 'get_statistics')

    return new Proxy(
        {},
        {
            ...IMMUTABLE_PROXY_TRAPS,
            get(_t, dbProp): unknown {
                if (typeof dbProp === 'symbol' || dbProp === 'then') return undefined
                if (dbProp === 'schema') return createSchemaShim(shimMj)
                if (dbProp === 'help' || dbProp === 'describe') {
                    const helpFn = target['help']
                    return () =>
                        typeof helpFn === 'function' ? (helpFn as () => unknown)() : undefined
                }
                const stmtHandler = createStatementMethodHandler(dbProp, shimMj)
                if (stmtHandler !== undefined) return stmtHandler
                if (dbProp === 'close' || dbProp === 'dispose' || dbProp === 'disconnect') {
                    return () => ({
                        success: false,
                        code: 'VALIDATION_ERROR',
                        error: `${dbProp} is not executed in the sandbox`,
                    })
                }
                if (
                    dbProp === 'getDatabase' ||
                    dbProp === 'getDb' ||
                    dbProp === 'get_database' ||
                    dbProp === 'get_db'
                ) {
                    return () => shimMj
                }
                if (dbProp === 'ping') return () => Promise.resolve({ success: true, status: 'pong' })
                if (dbProp === 'version') {
                    return () =>
                        Promise.resolve({
                            success: true,
                            version: PACKAGE_VERSION,
                            name: 'memory-journal-mcp',
                        })
                }
                if (STATS_METHOD_KEYS.has(dbProp) && typeof getStatsFn === 'function') {
                    return getStatsFn
                }
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
        }
    )
}

export function createSystemDatabaseDomainProxy(
    target: Record<string, unknown>,
    _shimMj: Record<string, unknown>
): object {
    if (
        typeof target['system'] === 'function' ||
        (typeof target['system'] === 'object' && target['system'] !== null)
    ) {
        return target['system']
    }
    const getStatsFn =
        getGroupProp(target, 'analytics', 'getStatistics') ??
        getGroupProp(target, 'analytics', 'get_statistics')
    const dbShim: Record<string, unknown> = {
        ping: () => Promise.resolve({ success: true, status: 'pong' }),
        version: () =>
            Promise.resolve({
                success: true,
                version: PACKAGE_VERSION,
                name: 'memory-journal-mcp',
            }),
    }
    for (const k of STATS_METHOD_KEYS) dbShim[k] = getStatsFn
    return new Proxy(dbShim, {
        ...IMMUTABLE_PROXY_TRAPS,
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
