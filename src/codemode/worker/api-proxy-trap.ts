/**
 * Root `mj.*` Proxy `get` trap helpers (split out of worker-api-proxy.ts).
 */

import { METHOD_ALIASES } from '../api-constants.js'
import {
    wrapPromise,
    attachMethodIntrospection,
    createFactoryFnProxy,
    createUnknownGroupRejectionProxy,
} from '../proxy-helpers.js'
import { wrapResult } from '../worker-result-proxy.js'

export const FACTORY_METHOD_NAMES = new Set([
    'getInstance', 'get_instance', 'createInstance', 'create_instance',
    'getClient', 'get_client', 'createClient', 'create_client',
    'initClient', 'init_client', 'initInstance', 'init_instance',
    'getJournal', 'get_journal', 'loadJournal', 'load_journal',
    'loadMemory', 'load_memory', 'getDatabase', 'get_database',
    'getDb', 'get_db', 'connectToDatabase', 'connect_to_database',
    'openDatabase', 'open_database', 'init', 'initialize',
    'connect', 'open', 'default',
])

const KNOWN_PROMPTS = [
    'session-summary', 'plan-draft', 'adversarial-review',
    'copilot-validation', 'plan-refinement', 'team-session-summary',
]

export interface ApiRootTrapContext {
    api: Record<string, unknown>
    methods: Record<string, string[]>
    schemas: Record<string, Record<string, string>> | undefined
    readonlyMode: boolean | undefined
    createMethodProxyFn: (
        groupName: string,
        methodName: string,
        schemaFallbackKey?: string
    ) => (...args: unknown[]) => Promise<unknown>
    resolveFallbackSchema: (
        schemas: Record<string, Record<string, string>> | undefined,
        group: string,
        key: string,
        resolvedKey: string
    ) => string | undefined
}

function resolveStaticRootAlias(target: Record<string, unknown>, prop: string): { hit: true; value: unknown } | { hit: false } {
    if (prop === 'gitApi') return { hit: true, value: target['git'] }
    if (prop === 'graph' || prop === 'rel' || prop === 'relations' || prop === 'relationship') {
        return { hit: true, value: target['relationships'] ?? target }
    }
    if (prop === 'journal' || prop === 'memory' || prop === 'entries' || prop === 'entry') {
        return { hit: true, value: target['core'] ?? target }
    }
    if (prop === 'schema') return { hit: true, value: target['schema'] }
    if (prop === 'projects' || prop === 'project') return { hit: true, value: target['projects'] }
    if (prop === 'tags' || prop === 'tag') return { hit: true, value: target['tags'] }
    if (prop === 'system') return { hit: true, value: target['system'] }
    if (prop === 'context') return { hit: true, value: target['context'] }
    if (prop === 'getContext' || prop === 'get_context') return { hit: true, value: target['getContext'] }
    if (prop === 'sqlite' || prop === 'sqlite3' || prop === 'db') return { hit: true, value: target }
    if (prop === 'then') return { hit: true, value: undefined }
    return { hit: false }
}

function resolveDynamicMethodAlias(ctx: ApiRootTrapContext, prop: string): unknown {
    const isExplicitTeamProp = prop.startsWith('team_') || /^team[A-Z]/.test(prop)
    const snakeKey = /[A-Z]/.test(prop)
        ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        : prop

    for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
        if (g === 'team' && !isExplicitTeamProp) continue
        if (groupAliases !== undefined && Object.hasOwn(groupAliases, prop)) {
            const canonicalCamel = groupAliases[prop]
            if (canonicalCamel === undefined) continue
            const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
            if (Object.hasOwn(ctx.methods, g) && ctx.methods[g]?.includes(canonicalSnake) === true) {
                return ctx.createMethodProxyFn(g, canonicalSnake)
            }
        }
    }

    const foundGroup = Object.keys(ctx.methods).find(
        (g) => (g !== 'team' || isExplicitTeamProp) && ctx.methods[g]?.includes(snakeKey)
    )
    return foundGroup !== undefined ? ctx.createMethodProxyFn(foundGroup, snakeKey) : undefined
}

function resolveReadonlyOrUnknownRoot(ctx: ApiRootTrapContext, prop: string): unknown {
    if (ctx.readonlyMode === true) {
        const topSchema = ctx.resolveFallbackSchema(ctx.schemas, '_topLevel', prop, prop)
        if (topSchema !== undefined) {
            const roReason = `🛠️ AUTONOMOUS HEALING: Operation '${prop}' is blocked in readonly mode. Read operations only.`
            const roFn = (..._args: unknown[]): Promise<unknown> =>
                wrapPromise(
                    Promise.resolve(
                        wrapResult({
                            success: false,
                            error: roReason,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                        })
                    ),
                    prop
                )
            attachMethodIntrospection(roFn, '_topLevel', prop, () => topSchema, roReason)
            return roFn
        }
    }

    const available = Object.keys(ctx.methods).filter((k) => k !== '_topLevel').join(', ')
    let reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`
    const normalized = prop.replace(/^mj_/, '').replace(/_/g, '-')
    const isPrompt =
        KNOWN_PROMPTS.includes(normalized) ||
        KNOWN_PROMPTS.includes(prop) ||
        KNOWN_PROMPTS.includes(prop.replace(/^mj_/, ''))
    if (isPrompt) {
        reason = `'${prop}' is an MCP Prompt, not an MCP Tool. Code Mode cannot invoke MCP Prompts directly. Please use the 'get_prompt' tool (or your native MCP Prompts integration) outside of Code Mode to evaluate it, then use 'mj.core.createEntry' to save the result.`
    } else if (prop.startsWith('mj_')) {
        reason = `'${prop}' is not a valid root tool in Code Mode. Code Mode uses namespaced groups (e.g., 'mj.core.searchEntries'). Use 'mj.help()' to see available namespaces.`
    }
    return createUnknownGroupRejectionProxy(prop, reason)
}

export function createApiRootGetTrap(
    ctx: ApiRootTrapContext
): (target: Record<string, unknown>, prop: string | symbol) => unknown {
    return (target, prop): unknown => {
        if (typeof prop === 'symbol') return undefined
        if (Object.hasOwn(target, prop)) return target[prop]
        const staticHit = resolveStaticRootAlias(target, prop)
        if (staticHit.hit) return staticHit.value
        if (FACTORY_METHOD_NAMES.has(prop)) return createFactoryFnProxy(ctx.api)
        const dynamicMatch = resolveDynamicMethodAlias(ctx, prop)
        if (dynamicMatch !== undefined) return dynamicMatch
        return resolveReadonlyOrUnknownRoot(ctx, prop)
    }
}
