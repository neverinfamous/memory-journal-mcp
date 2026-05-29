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
// API Proxy Builder
// =============================================================================

function wrapResult(result: unknown): unknown {
    if (
        result !== null &&
        result !== undefined &&
        typeof result === 'object' &&
        'success' in result &&
        (result as Record<string, unknown>)['success'] === false
    ) {
        const failedResult = result as Record<string | symbol, unknown>
        return new Proxy(failedResult, {
            get(target, prop) {
                if (prop in target) return target[prop]
                if (
                    typeof prop === 'string' &&
                    prop !== 'then' &&
                    prop !== 'catch' &&
                    prop !== 'finally' &&
                    prop !== 'constructor' &&
                    prop !== 'prototype' &&
                    prop !== 'toJSON'
                ) {
                    const errVal = target['error']
                    const errorMsg = typeof errVal === 'string' ? errVal : 'Unknown error'
                    throw new Error(
                        `Attempted to access missing property '${prop}' on a failed operation. API Error: ${errorMsg}`
                    )
                }
                return undefined
            },
        })
    }
    return result
}

function buildApiProxy(
    methods: Record<string, string[]>,
    schemas?: Record<string, Record<string, string>>
): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    for (const [group, methodNames] of Object.entries(methods)) {
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                const proxyFn = async (...args: unknown[]): Promise<unknown> => {
                    const result = await rpcCall('_topLevel', methodName, args)
                    return wrapResult(result)
                }
                Object.assign(proxyFn, {
                    schema: (): Promise<string> => Promise.resolve(schemas?.['_topLevel']?.[methodName] ?? 'any')
                })
                api[methodName] = proxyFn
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const methodName of methodNames) {
            const proxyFn = async (...args: unknown[]): Promise<unknown> => {
                const result = await rpcCall(group, methodName, args)
                return wrapResult(result)
            }
            Object.assign(proxyFn, {
                schema: (): Promise<string> => Promise.resolve(schemas?.[group]?.[methodName] ?? 'any')
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
                if (key === 'then') return undefined
                const available = methodNames.join(', ') || 'none'
                const reason =
                    methodNames.length === 0
                        ? `Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                        : `Operation '${key}' is not found in group. Available: ${available}.`
                return (..._args: unknown[]) => Promise.reject(new Error(reason))
            },
        })

        api[group] = groupProxyWrapped
    }

    api['help'] = () => {
        const groups = Object.keys(methods).filter((g) => g !== '_topLevel')
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

            const available = Object.keys(methods).filter(k => k !== '_topLevel').join(', ')
            const reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            // Return a proxy that rejects any method call
            return new Proxy(() => {
                // no-op function target for the proxy
            }, {
                apply() {
                    return Promise.reject(new Error(reason))
                },
                get(_t, subProp) {
                    if (typeof subProp === 'symbol') return undefined
                    if (subProp === 'then') return undefined
                    return (..._args: unknown[]) => Promise.reject(new Error(`${reason} (Attempted to access 'mj.${prop}.${subProp}')`))
                }
            })
        }
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
    contextObj?: Record<string, unknown>
): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    try {
        const mjApi = buildApiProxy(methodList, schemaList)

        // Permissive shim to smooth out common agent hallucinations across different repos
        const shimMj: Record<string, unknown> = new Proxy(mjApi, {
            get(target: Record<string, unknown>, prop: string | symbol): unknown {
                // Handle infinite chaining
                if (prop === 'mj' || prop === 'journal' || prop === 'memory') return shimMj;
                // Handle `sqlite.mj.executeCode` (from db-mcp parity)
                if (prop === 'executeCode') {
                    if ('codemode' in target) {
                        const codemodeGroup = target['codemode'] as Record<string, unknown>;
                        return codemodeGroup['mjExecuteCode'] ?? codemodeGroup['executeCode'];
                    }
                    return () => Promise.reject(new Error("You are already inside Code Mode execution. You do not need to call executeCode again. Just write your logic directly (e.g., return await mj.core.createEntry(...))."));
                }
                // Handle `memory.journal.addEntry` natural hallucination
                if (prop === 'addEntry' && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>;
                    return coreGroup['createEntry'];
                }
                // Handle `memory.append(tags, content, metadata)` natural hallucination
                if (prop === 'append' && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>;
                    const createEntry = coreGroup['createEntry'] as (args: unknown) => unknown;
                    return (arg1: unknown, arg2: unknown, arg3: unknown) => {
                        const tags = Array.isArray(arg1) ? arg1 : [typeof arg1 === 'string' ? arg1 : 'test'];
                        const content = typeof arg2 === 'string' ? arg2 : (arg2 != null ? JSON.stringify(arg2) : '');
                        const metadata = typeof arg3 === 'object' && arg3 !== null ? { ...(arg3 as Record<string, unknown>) } : undefined;
                        
                        const typeVal = metadata?.['type'];
                        const type = typeof typeVal === 'string' && typeVal !== '' ? typeVal : 'test_entry';
                        if (metadata && 'type' in metadata) delete metadata['type'];

                        return createEntry({ type, tags, content, metadata });
                    };
                }
                // db-mcp bleedover: silently route database-specific methods to closest journal equivalents
                if (typeof prop === 'string') {
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
                        readQuery: ['search', 'searchEntries'],
                    };
                    const mapping = DB_TO_JOURNAL[prop];
                    if (mapping !== undefined) {
                        const [group, method] = mapping;
                        if (group in target) {
                            return (target[group] as Record<string, unknown>)[method];
                        }
                    }
                }
                // Fall back to the strict `mjApi` proxy which provides exact error messages
                return Reflect.get(target, prop) as unknown;
            }
        });

        const sandbox: Record<string, unknown> = {
            mj: shimMj,
            journal: shimMj,
            sqlite: shimMj,
            postgres: shimMj,
            mysql: shimMj,
            db: shimMj,
            memory: shimMj, // Unified with shimMj to catch memory.append and memory.journal
            sqlite_journal_add_entry: (shimMj['core'] as Record<string, unknown>)?.['createEntry'],
            context: contextObj ?? {},
            console: {
                log: (...args: unknown[]) => args,
                warn: (...args: unknown[]) => args,
                error: (...args: unknown[]) => args,
                info: (...args: unknown[]) => args,
                debug: (...args: unknown[]) => args,
            },
            setTimeout: undefined,
            setInterval: undefined,
            setImmediate: undefined,
            process: undefined,
            require: undefined,
            __dirname: undefined,
            __filename: undefined,
            global: undefined,
            globalThis: undefined,
            Proxy: undefined,
        }

        // Spread callable top-level methods (e.g., find, recent, createEntry) from
        // shimMj into the sandbox as standalone globals so agents can call `find({...})`
        // without the `mj.` prefix. Only functions are spread; group namespaces (objects)
        // and existing sandbox keys are skipped to avoid collisions.
        for (const key of Object.keys(mjApi)) {
            if (key in sandbox) continue
            const val = shimMj[key]
            if (typeof val === 'function') {
                sandbox[key] = val
            }
        }

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
            context,
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
        
        // Add tip for syntax errors
        if (error instanceof SyntaxError && error.message.includes('missing ) after argument list')) {
            error.message += '\n\n💡 Tip: When passing long multi-line strings or markdown with embedded quotes, use template literals (backticks `) instead of single/double quotes to avoid escaping SyntaxErrors.'
        }
        
        return {
            success: false,
            error: error.message,
            stack: error.stack,
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
            } = executeMsg

            rpcPort = newRpcPort
            rpcIdCounter = 0
            pendingRpcRequests.clear()

            rpcPort?.on('message', (response: RpcResponse) => {
                const pending = pendingRpcRequests.get(response.id)
                if (pending) {
                    pendingRpcRequests.delete(response.id)
                    if (response.error) {
                        pending.reject(new Error(response.error))
                    } else {
                        pending.resolve(response.result)
                    }
                }
            })

            const result = await executeCode(code, methodList, schemaList, timeoutMs ?? 30000, contextObj)

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
