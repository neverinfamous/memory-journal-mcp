/**
 * Worker API Proxy Builder — constructs the `mj.*` proxy API for the sandbox.
 *
 * Each tool group becomes a namespace with methods that dispatch RPC calls
 * to the main thread. Includes snake_case→camelCase fallback, readResource
 * hallucination handling, and schema() introspection on every method.
 */

import { wrapResult } from './worker-result-proxy.js'
import { METHOD_ALIASES } from './api-constants.js'
import { applyArgInterceptions } from './param-normalizer.js'

/**
 * Build the mj.* API proxy from method and schema lists.
 *
 * @param rpcCall - Function to dispatch RPC calls to main thread
 * @param methods - Map of group name → method names
 * @param schemas - Optional map of group name → method name → type string
 * @param readonlyMode - If true, blocked methods show readonly error
 */
export function buildApiProxy(
    rpcCall: (group: string, method: string, args: unknown[]) => Promise<unknown>,
    methods: Record<string, string[]>,
    schemas?: Record<string, Record<string, string>>,
    readonlyMode?: boolean
): Record<string, unknown> {
    // Freeze note: Group namespaces are Proxy objects and cannot be frozen
    // via Object.freeze(). Schema descriptors are function closures attached
    // via Object.assign (`.schema()`) that return Promise<string> — they are
    // not mutable data objects. The caller (worker-script.ts) freezes the
    // returned `api` object and its group namespace values after construction.
    const api: Record<string, unknown> = {}

    const safeRpcCall = (group: string, method: string, args: unknown[]): Promise<unknown> => 
        rpcCall(group, method, args).catch((err: unknown) => ({ success: false, error: err instanceof Error ? err.message : String(err), code: 'EXECUTION_ERROR', category: 'execution', recoverable: true }));


    function wrapPromise(promise: Promise<unknown>, methodName: string): Promise<unknown> {
        return new Proxy(promise, {
            get(target, prop) {
                if (prop === 'then') return target.then.bind(target)
                if (prop === 'catch') return target.catch.bind(target)
                if (prop === 'finally') return target.finally.bind(target)
                if (typeof prop === 'string' && prop !== 'constructor' && prop !== 'toString' && prop !== 'valueOf' && prop !== 'toJSON') {
                    throw new Error(`Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`)
                }
                if (prop === Symbol.iterator) {
                    throw new Error(`Attempted to iterate over a Promise object. Did you forget to 'await' the tool call? (e.g. const [item] = await mj.group.${methodName}(...))`)
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return Reflect.get(target, prop)
            }
        })
    }

    for (const [group, methodNames] of Object.entries(methods)) {
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                const proxyFn = (...args: unknown[]): Promise<unknown> => {
                    const intercept = applyArgInterceptions(methodName, args)
                    if ('error' in intercept) {
                        return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName)
                    }
                    const resultPromise = safeRpcCall('_topLevel', methodName, intercept.args).then(wrapResult)
                    return wrapPromise(resultPromise, methodName)
                }
                Object.assign(proxyFn, {
                    schema: (): Promise<string> =>
                        Promise.resolve(schemas?.['_topLevel']?.[methodName] ?? 'unknown'),
                })
                api[methodName] = proxyFn
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const methodName of methodNames) {
            const proxyFn = (...args: unknown[]): Promise<unknown> => {
                const intercept = applyArgInterceptions(methodName, args)
                if ('error' in intercept) {
                    return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName)
                }
                const resultPromise = safeRpcCall(group, methodName, intercept.args).then(wrapResult)
                return wrapPromise(resultPromise, methodName)
            }
            Object.assign(proxyFn, {
                schema: (): Promise<string> =>
                    Promise.resolve(schemas?.[group]?.[methodName] ?? 'unknown'),
            })
            groupProxy[methodName] = proxyFn
        }

        groupProxy['help'] = () =>
            Promise.resolve({
                group,
                methods: methodNames,
            })

        const groupCallable = function (): void {
            // Callable group namespace target shim
        }
        Object.assign(groupCallable, groupProxy)

        const groupProxyWrapped = new Proxy(groupCallable, {
            apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
                const primaryMethod = methodNames.find((m) => !m.endsWith('_help') && m !== 'help')
                if (primaryMethod !== undefined) {
                    const fn = groupProxy[primaryMethod]
                    if (fn !== undefined) {
                        return fn(...args)
                    }
                }
                return wrapPromise(
                    Promise.resolve(
                        wrapResult({
                            success: false,
                            error: `Group '${group}' is a tool namespace, not a function. Available methods in '${group}': ${methodNames.join(', ')}.`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true,
                        })
                    ),
                    group
                )
            },
            get(target: object, prop: string | symbol): unknown {
                if (typeof prop === 'symbol') return undefined
                const key = prop
                const targetRecord = target as unknown as Record<string, unknown>
                if (key in targetRecord) return targetRecord[key]

                // Generic camelCase to snake_case fallback
                if (/[A-Z]/.test(key)) {
                    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    if (snakeKey in targetRecord) return targetRecord[snakeKey]
                }

                // Resolve using unified METHOD_ALIASES map
                const aliases = METHOD_ALIASES[group]
                let resolvedKey = key
                if (aliases?.[key] !== undefined) {
                    const canonicalCamel = aliases[key]
                    // Convert the canonical camelCase to the target's snake_case keys
                    const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                    if (canonicalSnake in targetRecord) return targetRecord[canonicalSnake]
                    if (canonicalCamel in targetRecord) return targetRecord[canonicalCamel]
                    
                    resolvedKey = canonicalCamel
                }

                // Cross-Group Constructor Wiring (Phase 31.3)
                if (group === 'core') {
                    const semanticGroup = api['semantic'] as Record<string, unknown> | undefined;
                    const adminGroup = api['admin'] as Record<string, unknown> | undefined;
                    
                    if (resolvedKey === 'semanticSearch' || key === 'semantic_search') {
                        return semanticGroup?.['semantic_search'] ?? semanticGroup?.['semanticSearch'];
                    }
                    if (resolvedKey === 'vectorStats' || key === 'vector_stats') {
                        return semanticGroup?.['vector_stats'] ?? semanticGroup?.['vectorStats'];
                    }
                    if (resolvedKey === 'searchAuditLog' || key === 'search_audit_log') {
                        return adminGroup?.['search_audit_log'] ?? adminGroup?.['searchAuditLog'];
                    }
                    if (resolvedKey === 'listDeletedEntries' || key === 'list_deleted_entries') {
                        return adminGroup?.['list_deleted_entries'] ?? adminGroup?.['listDeletedEntries'];
                    }
                }

                if (resolvedKey === 'getConfig') {
                    return () => wrapPromise(Promise.resolve(wrapResult({
                        success: false,
                        error: "Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings.",
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true
                    })), 'getConfig')
                }

                if (resolvedKey === 'getBriefing') {
                    return () => wrapPromise(Promise.resolve(wrapResult({
                        success: false,
                        error: "Code Mode cannot directly read the briefing resource via getBriefing(). Use mj.core.getRecentEntries() instead, or read the memory://briefing resource via standard MCP client requests outside of Code Mode.",
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true
                    })), 'getBriefing')
                }

                if (resolvedKey === 'readResource') {
                    // §2.3: URI-aware suggestions for common readResource hallucinations
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
                        return wrapPromise(Promise.resolve(wrapResult({
                            success: false,
                            error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true
                        })), 'readResource')
                    }
                }

                if (resolvedKey === 'then') return undefined
                
                // Cross-group search and Team tool transparent routing
                if (typeof resolvedKey === 'string') {
                    const snakeKey = /[A-Z]/.test(resolvedKey) ? resolvedKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : resolvedKey;
                    
                    // 1. Check for team prefix hallucination (e.g. semanticSearch -> team_semantic_search)
                    const teamSnakeKey = `team_${snakeKey}`;
                    const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                    if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                        const teamFn = (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(teamSnakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                            }
                            const resultPromise = safeRpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, teamSnakeKey);
                        }
                        Object.assign(teamFn, {
                            schema: (): Promise<string> =>
                                Promise.resolve(schemas?.[teamGroup]?.[teamSnakeKey] ?? 'unknown'),
                        })
                        return teamFn
                    }

                    // 2. Check for cross-group hallucination (e.g. mj.core.searchEntries -> mj.search.searchEntries)
                    const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                    if (foundGroup) {
                        const crossFn = (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(snakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                            }
                            const resultPromise = safeRpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, snakeKey);
                        }
                        Object.assign(crossFn, {
                            schema: (): Promise<string> =>
                                Promise.resolve(schemas?.[foundGroup]?.[snakeKey] ?? schemas?.[foundGroup]?.[resolvedKey] ?? 'unknown'),
                        })
                        return crossFn
                    }
                }

                const available = methodNames.join(', ') || 'none'
                const reason = readonlyMode
                    ? `🛠️ AUTONOMOUS HEALING: Operation '${key}' is blocked in readonly mode. Read operations only.`
                    : methodNames.length === 0
                      ? `🛠️ AUTONOMOUS HEALING: Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                      : `🛠️ AUTONOMOUS HEALING: Operation '${key}' is not found in group '${group}'. Available: ${available}.`
                const fallbackFn = (..._args: unknown[]): Promise<unknown> => {
                    return wrapPromise(Promise.resolve(wrapResult({
                        success: false,
                        error: reason,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        recoverable: true
                    })), key)
                }
                Object.assign(fallbackFn, {
                    schema: (): Promise<string> => Promise.resolve('unknown'),
                })
                return fallbackFn
            },
            set(): boolean { return false },
            defineProperty(): boolean { return false },
            deleteProperty(): boolean { return false },
            setPrototypeOf(): boolean { return false },
        })

        api[group] = groupProxyWrapped
    }

    api['help'] = () => {
        const groups = Object.keys(methods).filter(
            (g) => g !== '_topLevel' && g !== 'memory' && g !== 'entries'
        )
        let totalMethods = 0
        for (const group of groups) {
            totalMethods += methods[group]?.length ?? 0
        }
        return Promise.resolve({
            groups,
            totalMethods,
            usage: 'Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details.',
        })
    }

    return new Proxy(api, {
        get(target, prop) {
            if (typeof prop === 'symbol') return undefined
            if (prop in target) return target[prop]
            if (prop === 'gitApi') return target['git']
            if (prop === 'then') return undefined

            if (typeof prop === 'string') {
                const snakeKey = /[A-Z]/.test(prop) ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : prop;
                
                // 1. Check if the property is an alias in any group
                for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
                    if (groupAliases?.[prop] !== undefined) {
                        const canonicalCamel = groupAliases[prop];
                        const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
                        if (methods[g]?.includes(canonicalSnake)) {
                            return (...args: unknown[]): Promise<unknown> => {
                                const intercept = applyArgInterceptions(canonicalSnake, args);
                                if ('error' in intercept) {
                                    return wrapPromise(Promise.resolve(wrapResult(intercept.error)), canonicalSnake);
                                }
                                const resultPromise = safeRpcCall(g, canonicalSnake, intercept.args).then(wrapResult);
                                return wrapPromise(resultPromise, canonicalSnake);
                            }
                        }
                    }
                }

                // 2. Check for team prefix hallucination (e.g. mj.semanticSearch -> mj.team.teamSemanticSearch)
                const teamSnakeKey = `team_${snakeKey}`;
                const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                    return (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(teamSnakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                        }
                        const resultPromise = safeRpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, teamSnakeKey);
                    }
                }

                // 3. Check for cross-group hallucination (e.g. mj.update_configuration -> mj.admin.update_configuration)
                const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                if (foundGroup) {
                    return (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(snakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                        }
                        const resultPromise = safeRpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, snakeKey);
                    }
                }
            }

            const available = Object.keys(methods)
                .filter((k) => k !== '_topLevel')
                .join(', ')
            let reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            if (typeof prop === 'string') {
                const normalized = prop.replace(/^mj_/, '').replace(/_/g, '-');
                // Common prompt names that agents mistake for tools in Code Mode
                const knownPrompts = ['session-summary', 'plan-draft', 'adversarial-review', 'copilot-validation', 'plan-refinement', 'team-session-summary'];
                const isPrompt = knownPrompts.includes(normalized) || knownPrompts.includes(prop) || knownPrompts.includes(prop.replace(/^mj_/, ''));
                
                if (isPrompt) {
                    reason = `'${prop}' is an MCP Prompt, not an MCP Tool. Code Mode cannot invoke MCP Prompts directly. Please use the 'get_prompt' tool (or your native MCP Prompts integration) outside of Code Mode to evaluate it, then use 'mj.core.createEntry' to save the result.`;
                } else if (prop.startsWith('mj_')) {
                    reason = `'${prop}' is not a valid root tool in Code Mode. Code Mode uses namespaced groups (e.g., 'mj.core.searchEntries'). Use 'mj.help()' to see available namespaces.`;
                }
            }

            // Return a proxy that rejects any method call
            return new Proxy(
                () => {
                    // no-op function target for the proxy
                },
                {
                    apply() {
                        return wrapPromise(Promise.resolve(wrapResult({
                            success: false,
                            error: reason,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            recoverable: true
                        })), prop)
                    },
                    get(_t, subProp) {
                        if (typeof subProp === 'symbol') return undefined
                        if (subProp === 'then') return undefined
                        return (..._args: unknown[]) => {
                            return wrapPromise(Promise.resolve(wrapResult({
                                success: false,
                                error: `${reason} (Attempted to access 'mj.${prop}.${subProp}')`,
                                code: 'VALIDATION_ERROR',
                                category: 'validation',
                                recoverable: true
                            })), `${prop}.${subProp}`)
                        }
                    },
                }
            )
        },
    })
}
