/**
 * Worker API Proxy Builder — constructs the `mj.*` proxy API for the sandbox.
 *
 * Each tool group becomes a namespace with methods that dispatch RPC calls
 * to the main thread. Includes snake_case→camelCase fallback, readResource
 * hallucination handling, and schema() introspection on every method.
 */

import { wrapResult } from './worker-result-proxy.js'
import { METHOD_ALIASES } from './api-constants.js'

function applyArgInterceptions(methodName: string, args: unknown[]): { args: unknown[] } | { error: Record<string, unknown> } {
    // Hallucination intercept for _executeRawQueryUnsafe string arguments
    if (methodName === '_executeRawQueryUnsafe' && args.length === 1 && typeof args[0] === 'string') {
        args[0] = { query: args[0] }
    }
    // Hallucination intercept for search exact_match
    if (
        (methodName === 'search_entries' || methodName === 'searchEntries' || methodName === 'team_search' || methodName === 'teamSearch' || methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') &&
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null
    ) {
        const obj = args[0] as Record<string, unknown>
        if ('exact_match' in obj) {
            const isFuzzy = obj['exact_match'] === false;
            obj['fuzzy_match'] = isFuzzy;
            obj['auto_correct'] = isFuzzy;
            delete obj['exact_match']
        } else if (obj['fuzzy_match'] === true && !('auto_correct' in obj)) {
            obj['auto_correct'] = true;
        }
        
        if (typeof obj['start_date'] === 'string' && (obj['end_date'] === undefined || obj['end_date'] === null || obj['end_date'] === '')) {
            obj['end_date'] = new Date().toISOString().split('T')[0];
        }

        if ((methodName === 'team_search' || methodName === 'teamSearch') && obj['project_number'] == null) {
            const tags = obj['tags'] as string[] | undefined;
            if (tags && tags.length > 0 && tags.some(t => !t.startsWith('flag:'))) {
                return { error: {
                    success: false,
                    error: 'Cross-project team searches are only permitted for flags. Provide a project_number or use flag:* tags.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or use tags starting with "flag:"',
                    recoverable: true
                }};
            }
        }

        if ((methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') && obj['project_number'] == null) {
            const entryType = obj['entry_type'] as string | undefined;
            if (entryType && entryType !== 'flag') {
                return { error: {
                    success: false,
                    error: 'Cross-project team date range searches are only permitted for flags. Provide a project_number or use entry_type="flag".',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or set entry_type to "flag"',
                    recoverable: true
                }};
            }
        }
    }

    // Single ID methods hallucination: passing primitive instead of object, passing array, or missing ID
    const singleIdMethods = ['delete_entry', 'deleteEntry', 'restore_entry', 'restoreEntry', 'get_entry_by_id', 'getEntryById', 'get_entry_history', 'getEntryHistory', 'add_to_vector_index', 'addToVectorIndex', 'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry', 'team_delete_entry', 'teamDeleteEntry', 'team_restore_entry', 'teamRestoreEntry'];
    if (singleIdMethods.includes(methodName) && args.length === 1) {
        if (Array.isArray(args[0])) {
            return { error: {
                success: false,
                error: `${methodName} only accepts a single entry. To process multiple entries, use the batch equivalent (e.g., batch_delete_entries).`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Use a batch method or pass a single object like { entry_id: number }`,
                recoverable: true
            }};
        } else if (typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (Array.isArray(obj['ids']) || Array.isArray(obj['entry_ids'])) {
                return { error: {
                    success: false,
                    error: `${methodName} only accepts a single entry_id. To process multiple entries, use the batch equivalent.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Use a batch method (e.g. batch_delete_entries) or pass { entry_id: number }`,
                    recoverable: true
                }};
            }
            if (obj['entry_id'] === undefined && obj['id'] === undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} requires an 'entry_id' parameter.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Provide { entry_id: number, ... } as the argument`,
                    recoverable: true
                }};
            }
            const idVal = obj['entry_id'] !== undefined ? obj['entry_id'] : obj['id'];
            if (typeof idVal === 'string' && isNaN(parseInt(idVal, 10))) {
                return { error: {
                    success: false,
                    error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a numeric ID.',
                    recoverable: true
                }};
            }
        } else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
            const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0];
            if (!isNaN(asNum)) {
                args[0] = { entry_id: asNum };
            } else {
                return { error: {
                    success: false,
                    error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${args[0]}'). Journal entries use auto-incrementing integer IDs.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a numeric ID.',
                    recoverable: true
                }};
            }
        }
    }

    // update_entry hallucination: passing ID as first arg and data as second arg
    if ((methodName === 'update_entry' || methodName === 'updateEntry') && args.length === 2 && (typeof args[0] === 'number' || typeof args[0] === 'string') && typeof args[1] === 'object' && args[1] !== null) {
        const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0];
        if (!isNaN(asNum)) {
            args = [{ entry_id: asNum, ...args[1] }];
        }
    }

    // batch_create_entries hallucination: passing array directly
    if ((methodName === 'batch_create_entries' || methodName === 'batchCreateEntries' || methodName === 'team_batch_create_entries' || methodName === 'teamBatchCreateEntries') && args.length === 1 && Array.isArray(args[0])) {
        args[0] = { entries: args[0] };
    }

    // batch_update_entries hallucination: passing array directly
    if ((methodName === 'batch_update_entries' || methodName === 'batchUpdateEntries' || methodName === 'team_batch_update_entries' || methodName === 'teamBatchUpdateEntries') && args.length === 1 && Array.isArray(args[0])) {
        args[0] = { updates: args[0] };
    }

    // batch_delete_entries hallucination: passing comma-separated string or multiple args or direct array
    if (methodName === 'batch_delete_entries' || methodName === 'batchDeleteEntries' || methodName === 'team_batch_delete_entries' || methodName === 'teamBatchDeleteEntries') {
        if (args.length === 1 && typeof args[0] === 'string') {
            const ids = args[0].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            args[0] = { entry_ids: ids };
        } else if (args.length === 1 && Array.isArray(args[0])) {
            const hasStrings = args[0].some(id => typeof id === 'string');
            if (hasStrings) {
                return { error: {
                    success: false,
                    error: `batch_delete_entries expects an array of numeric IDs, but received an array containing strings.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Ensure all IDs in the array are numbers. Use parseInt() if necessary.',
                    recoverable: true
                }};
            }
            args[0] = { entry_ids: args[0] };
        } else if (args.length > 1 && args.every(a => typeof a === 'number')) {
            args = [{ entry_ids: args }];
        }
    }

    // update_configuration hallucination: passing string directly or nested config object
    if (methodName === 'update_configuration' || methodName === 'updateConfiguration' || methodName === 'config' || methodName === 'configure') {
        if (args.length === 1 && typeof args[0] === 'string') {
            args[0] = { instruction_level: args[0] };
        } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = { ...(args[0] as Record<string, unknown>) };
            if (typeof obj['config'] === 'object' && obj['config'] !== null) {
                args[0] = { ...obj, ...(obj['config'] as Record<string, unknown>) };
                delete (args[0] as Record<string, unknown>)['config'];
            }
        }
    }

    // merge_tags hallucination: passing `source_tags` or `from`/`to` or comma-separated tags
    if (methodName === 'merge_tags' || methodName === 'mergeTags' || methodName === 'team_merge_tags' || methodName === 'teamMergeTags') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (obj['source_tags'] !== undefined && obj['source_tag'] === undefined) {
                obj['source_tag'] = Array.isArray(obj['source_tags']) ? obj['source_tags'][0] : obj['source_tags'];
                delete obj['source_tags'];
            }
            if (obj['from'] !== undefined && obj['source_tag'] === undefined) {
                obj['source_tag'] = obj['from'];
                delete obj['from'];
            }
            if (obj['to'] !== undefined && obj['target_tag'] === undefined) {
                obj['target_tag'] = obj['to'];
                delete obj['to'];
            }
            if (typeof obj['source_tag'] === 'string' && obj['source_tag'].includes(',')) {
                return { error: {
                    success: false,
                    error: `merge_tags only accepts a single source_tag string, not a comma-separated list.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a single tag string for source_tag. To merge multiple tags, call this tool multiple times.',
                    recoverable: true
                }};
            }
        }
    }

    // search_audit_log hallucination: passing `limit` as a string
    if (methodName === 'search_audit_log' || methodName === 'searchAuditLog') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (typeof obj['limit'] === 'string') {
                const parsed = parseInt(obj['limit'], 10);
                if (!isNaN(parsed)) obj['limit'] = parsed;
            }
        }
    }

    // rebuild_vector_index hallucination: passing a boolean instead of object
    if (methodName === 'rebuild_vector_index' || methodName === 'rebuildVectorIndex') {
        if (args.length === 1 && typeof args[0] === 'boolean') {
            args[0] = {};
        }
    }

    return { args };
}

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
    const api: Record<string, unknown> = {}

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
                    const resultPromise = rpcCall('_topLevel', methodName, intercept.args).then(wrapResult)
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
                const resultPromise = rpcCall(group, methodName, intercept.args).then(wrapResult)
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

        const groupProxyWrapped = new Proxy(groupProxy, {
            get(target, prop) {
                if (typeof prop === 'symbol') return undefined
                const key = prop
                if (key in target) return target[key]

                // Generic camelCase to snake_case fallback
                if (typeof key === 'string' && /[A-Z]/.test(key)) {
                    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    if (snakeKey in target) return target[snakeKey]
                }

                // Resolve using unified METHOD_ALIASES map
                const aliases = METHOD_ALIASES[group]
                if (aliases && typeof key === 'string' && aliases[key]) {
                    const canonicalCamel = aliases[key]
                    // Convert the canonical camelCase to the target's snake_case keys
                    const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                    if (canonicalSnake in target) return target[canonicalSnake]
                    if (canonicalCamel in target) return target[canonicalCamel]
                }

                if (key === 'getConfig') {
                    return () => Promise.reject(new Error(
                        "Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings."
                    ))
                }

                if (key === 'getBriefing') {
                    return () => Promise.reject(new Error(
                        "Code Mode cannot directly read the briefing resource via getBriefing(). Use mj.core.getRecentEntries() instead, or read the memory://briefing resource via standard MCP client requests outside of Code Mode."
                    ))
                }

                if (key === 'readResource') {
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
                        return Promise.reject(new Error(
                            `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
                        ))
                    }
                }

                if (key === 'then') return undefined
                
                // Cross-group search and Team tool transparent routing
                if (typeof key === 'string') {
                    const snakeKey = /[A-Z]/.test(key) ? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : key;
                    
                    // 1. Check for team prefix hallucination (e.g. semanticSearch -> team_semantic_search)
                    const teamSnakeKey = `team_${snakeKey}`;
                    const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                    if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                        return (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(teamSnakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                            }
                            const resultPromise = rpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, teamSnakeKey);
                        }
                    }

                    // 2. Check for cross-group hallucination (e.g. mj.core.searchEntries -> mj.search.searchEntries)
                    const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                    if (foundGroup) {
                        return (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(snakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                            }
                            const resultPromise = rpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, snakeKey);
                        }
                    }
                }

                const available = methodNames.join(', ') || 'none'
                const reason = readonlyMode
                    ? `Operation '${key}' is blocked in readonly mode. Read operations only.`
                    : methodNames.length === 0
                      ? `Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                      : `Operation '${key}' is not found in group '${group}'. Available: ${available}.`
                return (..._args: unknown[]) => {
                    throw new Error(reason)
                }
            },
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
                                const resultPromise = rpcCall(g, canonicalSnake, intercept.args).then(wrapResult);
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
                        const resultPromise = rpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
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
                        const resultPromise = rpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, snakeKey);
                    }
                }
            }

            const available = Object.keys(methods)
                .filter((k) => k !== '_topLevel')
                .join(', ')
            const reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            // Return a proxy that rejects any method call
            return new Proxy(
                () => {
                    // no-op function target for the proxy
                },
                {
                    apply() {
                        throw new Error(reason)
                    },
                    get(_t, subProp) {
                        if (typeof subProp === 'symbol') return undefined
                        if (subProp === 'then') return undefined
                        return (..._args: unknown[]) => {
                            throw new Error(
                                `${reason} (Attempted to access 'mj.${prop}.${subProp}')`
                            )
                        }
                    },
                }
            )
        },
    })
}
