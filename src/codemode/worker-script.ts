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
import { buildApiProxy } from './worker-api-proxy.js'

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
// Execution
// =============================================================================

async function executeCode(
    code: string,
    methodList: Record<string, string[]>,
    schemaList: Record<string, Record<string, string>> | undefined,
    timeoutMs: number,
    contextObj?: Record<string, unknown>,
    readonlyMode?: boolean
): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    try {
        const mjApi = buildApiProxy(rpcCall, methodList, schemaList, readonlyMode)

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
            readQuery: ['core', 'readQuery'],
        }

        // Permissive shim to smooth out common agent hallucinations across different repos
        const shimMj: Record<string, unknown> = new Proxy(mjApi, {
            get(target: Record<string, unknown>, prop: string | symbol): unknown {
                // Handle infinite chaining
                if (prop === 'mj' || prop === 'journal' || prop === 'memory') return shimMj
                // Handle `sqlite.mj.executeCode` (from db-mcp parity)
                if (prop === 'executeCode') {
                    if ('codemode' in target) {
                        const codemodeGroup = target['codemode'] as Record<string, unknown>
                        return codemodeGroup['mjExecuteCode'] ?? codemodeGroup['executeCode']
                    }
                    return () =>
                        Promise.reject(
                            new Error(
                                'You are already inside Code Mode execution. You do not need to call executeCode again. Just write your logic directly (e.g., return await mj.core.createEntry(...)).'
                            )
                        )
                }
                if (prop === 'readResource') {
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
                        return Promise.reject(
                            new Error(
                                `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
                            )
                        )
                    }
                }
                // Handle `memory.journal.addEntry` natural hallucination
                if (prop === 'addEntry' && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    return coreGroup['create_entry'] ?? coreGroup['createEntry']
                }
                // Handle get/list/searchProjects hallucination via proxy intercept
                if (prop === 'getProjects' || prop === 'listProjects' || prop === 'searchProjects') {
                    if ('analytics' in target) {
                        const analyticsGroup = target['analytics'] as Record<string, unknown>
                        return analyticsGroup['get_cross_project_insights'] ?? analyticsGroup['getCrossProjectInsights']
                    }
                }
                // Handle `memory.append(tags, content, metadata)` natural hallucination
                if (prop === 'append' && 'core' in target) {
                    const coreGroup = target['core'] as Record<string, unknown>
                    const createEntry = coreGroup['createEntry'] as (args: unknown) => unknown
                    return (arg1: unknown, arg2: unknown, arg3: unknown) => {
                        const tags = Array.isArray(arg1)
                            ? arg1
                            : [typeof arg1 === 'string' ? arg1 : 'test']
                        const content =
                            typeof arg2 === 'string'
                                ? arg2
                                : arg2 != null
                                  ? JSON.stringify(arg2)
                                  : ''
                        const metadata =
                            typeof arg3 === 'object' && arg3 !== null
                                ? { ...(arg3 as Record<string, unknown>) }
                                : undefined

                        const typeVal = metadata?.['type']
                        const type =
                            typeof typeVal === 'string' && typeVal !== '' ? typeVal : 'test_entry'
                        if (metadata && 'type' in metadata) delete metadata['type']

                        return createEntry({ type, tags, content, metadata })
                    }
                }
                // Generic snake_case to camelCase fallback for top-level operations
                if (typeof prop === 'string' && prop.includes('_')) {
                    const camelProp = prop.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
                    if (camelProp !== prop) {
                        // Check if the camelProp is mapped in DB_TO_JOURNAL
                        const mapping = DB_TO_JOURNAL[camelProp]
                        if (mapping !== undefined) {
                            const [group, method] = mapping
                            if (group in target) return (target[group] as Record<string, unknown>)[method]
                        }
                        if (camelProp in target) return Reflect.get(target, camelProp)
                    }
                }

                // db-mcp bleedover: silently route database-specific methods to closest journal equivalents
                if (typeof prop === 'string') {
                    const mapping = DB_TO_JOURNAL[prop]
                    if (mapping !== undefined) {
                        const [group, method] = mapping
                        if (group in target) {
                            return (target[group] as Record<string, unknown>)[method]
                        }
                    }
                }
                // Fall back to the strict `mjApi` proxy which provides exact error messages
                return Reflect.get(target, prop) as unknown
            },
        })

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
            fetch: () =>
                Promise.reject(
                    new Error(
                        "SandboxNetworkError: 'fetch' is not defined in Code Mode for security. Network and HTTP modules are isolated. To retrieve server metrics, read the appropriate MCP resources (e.g., memory://metrics/summary, memory://metrics/latency) outside of Code Mode."
                    )
                ),
            sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5000))),
            setTimeout: (cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
                setTimeout(cb, Math.min(ms ?? 0, 5000), ...args),
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
            context
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

        const errString = String(err)
        // Add tip for syntax or tagged template errors caused by unescaped backticks
        // Checking error string directly because VM sandbox errors fail cross-realm `instanceof` checks
        if (
            errString.includes('missing ) after argument list') ||
            errString.includes('is not a function') ||
            errString.includes('Invalid or unexpected token')
        ) {
            error.message +=
                '\n\n💡 Tip: When passing long multi-line strings or markdown with embedded quotes/backticks, NEVER use template literals (backticks `) in the code string as they will prematurely evaluate and cause SyntaxErrors or Tagged Template TypeErrors. ALWAYS pass them safely via the `context` parameter and reference them as `context.myParam`.'
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
                readonlyMode?: boolean
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
                readonlyMode,
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

            const result = await executeCode(
                code,
                methodList,
                schemaList,
                timeoutMs ?? 30000,
                contextObj,
                readonlyMode
            )

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
