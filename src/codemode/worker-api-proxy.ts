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
                    throw new Error(`🛠️ AUTONOMOUS HEALING: Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`)
                }
                if (prop === Symbol.iterator) {
                    throw new Error(`🛠️ AUTONOMOUS HEALING: Attempted to iterate over a Promise object. Did you forget to 'await' the tool call? (e.g. const [item] = await mj.group.${methodName}(...))`)
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return Reflect.get(target, prop)
            }
        })
    }

    function attachMethodIntrospection(
        targetFn: (...args: unknown[]) => unknown,
        group: string,
        methodName: string,
        getSchema: () => string,
        customDescription?: string
    ): void {
        const description = customDescription ?? `Code Mode tool mj.${group}.${methodName}. Use mj.${group}.${methodName}.schema() to view parameter schema.`
        Object.assign(targetFn, {
            schema: (): Promise<string> => Promise.resolve(getSchema()),
            help: (): Promise<unknown> =>
                Promise.resolve({
                    name: methodName,
                    group,
                    schema: getSchema(),
                    description,
                }),
            describe: (): Promise<unknown> =>
                Promise.resolve({
                    name: methodName,
                    group,
                    schema: getSchema(),
                    description,
                }),
        })
    }

    for (const [group, methodNames] of Object.entries(methods)) {
        if (!Array.isArray(methodNames)) continue
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
                attachMethodIntrospection(proxyFn, '_topLevel', methodName, () => schemas?.['_topLevel']?.[methodName] ?? 'unknown')
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
            attachMethodIntrospection(proxyFn, group, methodName, () => schemas?.[group]?.[methodName] ?? 'unknown')
            groupProxy[methodName] = proxyFn
        }

        groupProxy['help'] = () =>
            Promise.resolve({
                group,
                methods: methodNames,
            })
        groupProxy['describe'] = groupProxy['help']

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
                        attachMethodIntrospection(teamFn, teamGroup, teamSnakeKey, () => schemas?.[teamGroup]?.[teamSnakeKey] ?? 'unknown')
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
                        attachMethodIntrospection(crossFn, foundGroup, snakeKey, () => schemas?.[foundGroup]?.[snakeKey] ?? schemas?.[foundGroup]?.[resolvedKey] ?? 'unknown')
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
                attachMethodIntrospection(fallbackFn, group, key, () => 'unknown', reason)
                return fallbackFn
            },
            set(): boolean { return false },
            defineProperty(): boolean { return false },
            deleteProperty(): boolean { return false },
            setPrototypeOf(): boolean { return false },
        })

        api[group] = groupProxyWrapped
    }

    const schemaHelp = (): Promise<unknown> =>
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
            usage: 'Use mj.core.createEntry.schema() for entry parameter details, or mj.analytics.getStatistics() for database statistics.',
        })

    const schemaCallable = function (..._args: unknown[]): Promise<unknown> {
        return safeRpcCall('analytics', 'get_statistics', []).then(wrapResult)
    }

    const schemaProxy = new Proxy(schemaCallable, {
        apply(_t, _thisArg, args) {
            return safeRpcCall('analytics', 'get_statistics', args).then(wrapResult)
        },
        get(_t, p) {
            if (typeof p === 'symbol' || p === 'then') return undefined
            if (p === 'help' || p === 'describe') return schemaHelp
            if (p === 'listTables') {
                return (): Promise<unknown> =>
                    Promise.resolve({
                        success: true,
                        tables: ['entries', 'tags', 'entry_tags', 'relationships', 'projects'],
                    })
            }
            if (p === 'describeTable' || p === 'getSchema') return schemaHelp
            if (p === 'tables') return ['entries', 'tags', 'entry_tags', 'relationships', 'projects']
            if (p in Function.prototype) {
                return Reflect.get(Function.prototype, p) as unknown
            }
            return undefined
        },
    })

    api['schema'] = schemaProxy

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
    api['describe'] = api['help']

    const invokeRpc = (g: string, m: string, args: unknown[]): Promise<unknown> => {
        const intercept = applyArgInterceptions(m, args);
        if ('error' in intercept) {
            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), m);
        }
        const resultPromise = safeRpcCall(g, m, intercept.args).then(wrapResult);
        return wrapPromise(resultPromise, m);
    };

    // Projects namespace proxy & shims
    const adminListProjects = methods['admin']?.includes('list_projects')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'list_projects', args)
        : methods['analytics']?.includes('get_cross_project_insights')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('analytics', 'get_cross_project_insights', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true, projects: [] })), 'list_projects');

    const adminGetProject = methods['admin']?.includes('get_project')
        ? (nameOrParams: unknown): Promise<unknown> => {
            const params = typeof nameOrParams === 'string' || typeof nameOrParams === 'number'
                ? [{ name: String(nameOrParams) }]
                : [nameOrParams ?? {}];
            return invokeRpc('admin', 'get_project', params);
        }
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'get_project');

    const adminRegisterProject = methods['admin']?.includes('register_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'register_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'register_project');

    const adminUpdateProject = methods['admin']?.includes('update_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'update_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'update_project');

    const adminDeleteProject = methods['admin']?.includes('delete_project')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'delete_project', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'delete_project');

    const projectsCallable = function(this: unknown, ...args: unknown[]): Promise<unknown> {
        return adminListProjects(...args);
    };
    const projectsObj: Record<string, unknown> = {
        list: adminListProjects,
        listProjects: adminListProjects,
        list_projects: adminListProjects,
        getProjects: adminListProjects,
        get_projects: adminListProjects,
        getAll: adminListProjects,
        all: adminListProjects,
        get: adminGetProject,
        getProject: adminGetProject,
        get_project: adminGetProject,
        register: adminRegisterProject,
        registerProject: adminRegisterProject,
        register_project: adminRegisterProject,
        create: adminRegisterProject,
        createProject: adminRegisterProject,
        update: adminUpdateProject,
        updateProject: adminUpdateProject,
        update_project: adminUpdateProject,
        delete: adminDeleteProject,
        deleteProject: adminDeleteProject,
        delete_project: adminDeleteProject,
        remove: adminDeleteProject,
        removeProject: adminDeleteProject,
    };
    Object.assign(projectsCallable, projectsObj);
    const projectsProxy = new Proxy(projectsCallable, {
        apply(_t, _thisArg, args: unknown[]): Promise<unknown> {
            return adminListProjects(...args);
        },
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined;
            if (p in t) return (Reflect.get(t, p) as unknown);
            if (typeof p === 'string') {
                const low = p.toLowerCase();
                if (low.includes('list') || low.includes('all') || (low.includes('get') && low.endsWith('s'))) {
                    return adminListProjects;
                }
                if (low.includes('get') || low.includes('find')) {
                    return adminGetProject;
                }
                if (low.includes('create') || low.includes('register') || low.includes('add')) {
                    return adminRegisterProject;
                }
                if (low.includes('update') || low.includes('edit')) {
                    return adminUpdateProject;
                }
                if (low.includes('delete') || low.includes('remove')) {
                    return adminDeleteProject;
                }
            }
            return adminListProjects;
        }
    });
    api['projects'] = projectsProxy;
    api['project'] = projectsProxy;

    // Tags namespace proxy & shims
    const coreListTags = methods['core']?.includes('list_tags')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('core', 'list_tags', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true, tags: [], count: 0 })), 'list_tags');

    const adminMergeTags = methods['admin']?.includes('merge_tags')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('admin', 'merge_tags', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'merge_tags');

    const tagsCallable = function(this: unknown, ...args: unknown[]): Promise<unknown> {
        return coreListTags(...args);
    };
    const tagsObj: Record<string, unknown> = {
        list: coreListTags,
        listTags: coreListTags,
        list_tags: coreListTags,
        get: coreListTags,
        getTags: coreListTags,
        get_tags: coreListTags,
        getAll: coreListTags,
        all: coreListTags,
        merge: adminMergeTags,
        mergeTags: adminMergeTags,
        merge_tags: adminMergeTags,
    };
    Object.assign(tagsCallable, tagsObj);
    const tagsProxy = new Proxy(tagsCallable, {
        apply(_t, _thisArg, args: unknown[]): Promise<unknown> {
            return coreListTags(...args);
        },
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined;
            if (p in t) return (Reflect.get(t, p) as unknown);
            if (typeof p === 'string') {
                const low = p.toLowerCase();
                if (low.includes('merge')) {
                    return adminMergeTags;
                }
                if (low.includes('list') || low.includes('get') || low.includes('all') || low.includes('find') || low.includes('search')) {
                    return coreListTags;
                }
            }
            return coreListTags;
        }
    });
    api['tags'] = tagsProxy;
    api['tag'] = tagsProxy;

    // System namespace proxy & shims
    const getStats = methods['analytics']?.includes('get_statistics')
        ? (...args: unknown[]): Promise<unknown> => invokeRpc('analytics', 'get_statistics', args)
        : (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true })), 'get_statistics');

    const systemCallable = function(this: unknown, ...args: unknown[]): Promise<unknown> {
        return getStats(...args);
    };
    const systemObj: Record<string, unknown> = {
        getStatistics: getStats,
        getStats: getStats,
        stats: getStats,
        serverInfo: getStats,
        server_info: getStats,
        serverHealth: getStats,
        server_health: getStats,
        serverStatus: getStats,
        server_status: getStats,
        healthCheck: getStats,
        health_check: getStats,
        diagnostics: getStats,
        getDiagnostics: getStats,
        systemInfo: getStats,
        system_info: getStats,
        info: getStats,
        getInfo: getStats,
        health: getStats,
        getHealth: getStats,
        status: getStats,
        getStatus: getStats,
        ping: (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true, status: 'pong' })), 'ping'),
        version: (): Promise<unknown> => wrapPromise(Promise.resolve(wrapResult({ success: true, version: '1.0.0', name: 'memory-journal-mcp' })), 'version'),
    };
    Object.assign(systemCallable, systemObj);
    const systemProxy = new Proxy(systemCallable, {
        apply(_t, _thisArg, args: unknown[]): Promise<unknown> {
            return getStats(...args);
        },
        get(t, p): unknown {
            if (typeof p === 'symbol' || p === 'then') return undefined;
            if (p in t) return (Reflect.get(t, p) as unknown);
            return getStats;
        }
    });
    api['system'] = systemProxy;

    return new Proxy(api, {
        get(target, prop) {
            if (typeof prop === 'symbol') return undefined
            if (prop in target) return target[prop]
            if (prop === 'gitApi') return target['git']
            if (prop === 'journal' || prop === 'memory') return target['core'] ?? target
            if (prop === 'schema') return target['schema']
            if (prop === 'projects' || prop === 'project') return target['projects']
            if (prop === 'tags' || prop === 'tag') return target['tags']
            if (prop === 'system') return target['system']
            if (prop === 'sqlite' || prop === 'sqlite3' || prop === 'db') return target
            if (prop === 'then') return undefined

            if (
                prop === 'getInstance' || prop === 'get_instance' ||
                prop === 'createInstance' || prop === 'create_instance' ||
                prop === 'getClient' || prop === 'get_client' ||
                prop === 'createClient' || prop === 'create_client' ||
                prop === 'initClient' || prop === 'init_client' ||
                prop === 'initInstance' || prop === 'init_instance' ||
                prop === 'getJournal' || prop === 'get_journal' ||
                prop === 'loadJournal' || prop === 'load_journal' ||
                prop === 'loadMemory' || prop === 'load_memory' ||
                prop === 'init' || prop === 'initialize' ||
                prop === 'connect' || prop === 'open' ||
                prop === 'default'
            ) {
                const factoryFn = function(this: unknown, ..._args: unknown[]): unknown {
                    return api
                }
                return new Proxy(factoryFn, {
                    apply(_t, _thisArg, _args): unknown {
                        return api
                    },
                    construct(_t, _args): object {
                        return api
                    },
                    get(_t, p): unknown {
                        if (p === 'then') return undefined
                        if (p === 'name') return 'factoryFn'
                        if (p === 'length') return 0
                        if (p === 'bind' || p === 'call' || p === 'apply' || p === 'toString') {
                            return Function.prototype[p].bind(factoryFn)
                        }
                        return api[p as string]
                    }
                })
            }

            if (typeof prop === 'string') {
                const snakeKey = /[A-Z]/.test(prop) ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : prop;
                
                // 1. Check if the property is an alias in any group
                for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
                    if (groupAliases?.[prop] !== undefined) {
                        const canonicalCamel = groupAliases[prop];
                        const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
                        if (methods[g]?.includes(canonicalSnake)) {
                            const proxyFn = (...args: unknown[]): Promise<unknown> => {
                                const intercept = applyArgInterceptions(canonicalSnake, args);
                                if ('error' in intercept) {
                                    return wrapPromise(Promise.resolve(wrapResult(intercept.error)), canonicalSnake);
                                }
                                const resultPromise = safeRpcCall(g, canonicalSnake, intercept.args).then(wrapResult);
                                return wrapPromise(resultPromise, canonicalSnake);
                            };
                            attachMethodIntrospection(proxyFn, g, canonicalSnake, () => schemas?.[g]?.[canonicalSnake] ?? 'unknown');
                            return proxyFn;
                        }
                    }
                }

                // 2. Check for team prefix hallucination (e.g. mj.semanticSearch -> mj.team.teamSemanticSearch)
                const teamSnakeKey = `team_${snakeKey}`;
                const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                    const proxyFn = (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(teamSnakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                        }
                        const resultPromise = safeRpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, teamSnakeKey);
                    };
                    attachMethodIntrospection(proxyFn, teamGroup, teamSnakeKey, () => schemas?.[teamGroup]?.[teamSnakeKey] ?? 'unknown');
                    return proxyFn;
                }

                // 3. Check for cross-group hallucination (e.g. mj.update_configuration -> mj.admin.update_configuration)
                const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                if (foundGroup) {
                    const proxyFn = (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(snakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                        }
                        const resultPromise = safeRpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, snakeKey);
                    };
                    attachMethodIntrospection(proxyFn, foundGroup, snakeKey, () => schemas?.[foundGroup]?.[snakeKey] ?? 'unknown');
                    return proxyFn;
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
