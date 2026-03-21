/**
 * memory-journal-mcp - Worker Script (Worker Thread Entry Point)
 *
 * Runs inside `node:worker_threads`. Receives serialized API bindings,
 * builds an async Proxy API object (`mj.*`), and executes user code
 * within a secondary `vm.createContext` boundary.
 */

import { parentPort, workerData } from 'node:worker_threads'
import * as vm from 'node:vm'
import type { MessagePort } from 'node:worker_threads'
import type { RpcRequest, RpcResponse, SandboxResult, ExecutionMetrics } from './types.js'

// =============================================================================
// Worker Data
// =============================================================================

interface WorkerInit {
    code: string
    methodList: Record<string, string[]>
    timeoutMs: number
    rpcPort: MessagePort
}

const { code, methodList, timeoutMs, rpcPort: workerRpcPort } = workerData as WorkerInit

// =============================================================================
// RPC Client (Worker Side)
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

/**
 * Build the `mj` API proxy object from the method list.
 * Each group becomes a namespace with async methods that call
 * back to the main thread via RPC.
 */
function buildApiProxy(methods: Record<string, string[]>): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    for (const [group, methodNames] of Object.entries(methods)) {
        // _topLevel methods go directly on the api object (mj.createEntry, etc.)
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                api[methodName] = (...args: unknown[]) => rpcCall('_topLevel', methodName, args)
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const methodName of methodNames) {
            groupProxy[methodName] = (...args: unknown[]) => rpcCall(group, methodName, args)
        }

        // Per-group help()
        groupProxy['help'] = () =>
            Promise.resolve({
                group,
                methods: methodNames,
            })

        // Wrap in a Proxy so that calling an undefined method (e.g. a mutation
        // that was stripped in readonly mode) returns a structured error object
        // instead of throwing `TypeError: mj.<group>.<method> is not a function`.
        const groupProxyWrapped = new Proxy(groupProxy, {
            get(target, prop) {
                const key = String(prop)
                if (key in target) return target[key]
                // Unknown method — return a function that resolves to a structured error
                return (..._args: unknown[]) =>
                    Promise.resolve({
                        success: false,
                        error: `Operation '${key}' is not available${methodNames.length === 0 ? ' — this group has no methods in read-only mode' : ` in this context (readonly mode may be active)`}. Available: ${methodNames.join(', ') || 'none'}.`,
                    })
            },
        })

        api[group] = groupProxyWrapped
    }

    // Top-level help()
    api['help'] = () => {
        const groups = Object.keys(methods).filter((g) => g !== '_topLevel')
        let totalMethods = 0
        for (const group of groups) {
            totalMethods += methods[group]?.length ?? 0
        }
        return Promise.resolve({
            groups,
            totalMethods,
            usage: 'Use mj.<group>.help() for group details. Example: mj.core.help()',
        })
    }

    return api
}

// =============================================================================
// Execution
// =============================================================================

async function executeCode(): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    try {
        const mjApi = buildApiProxy(methodList)

        // Build sandbox context with nulled dangerous globals
        // Built-ins (JSON, Math, Promise, etc.) inherit from the worker's global scope
        const sandbox: Record<string, unknown> = {
            mj: mjApi,
            console: {
                log: (...args: unknown[]) => args,
                warn: (...args: unknown[]) => args,
                error: (...args: unknown[]) => args,
                info: (...args: unknown[]) => args,
                debug: (...args: unknown[]) => args,
            },
            // Nulled globals
            setTimeout: undefined,
            setInterval: undefined,
            setImmediate: undefined,
            process: undefined,
            require: undefined,
            __dirname: undefined,
            __filename: undefined,
            global: undefined,
            globalThis: undefined,
        }

        const context = vm.createContext(sandbox, {
            name: 'codemode-worker-sandbox',
        })

        const wrappedCode = `(async () => { ${code} })()`
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
            memoryUsedMb: 0, // Measured on host side via RSS delta
        }

        return { success: true, result, metrics }
    } catch (err) {
        const endTime = performance.now()
        const endCpu = process.cpuUsage(startCpu)
        const error = err instanceof Error ? err : new Error(String(err))
        const metrics: ExecutionMetrics = {
            wallTimeMs: Math.round(endTime - startTime),
            cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1000),
            memoryUsedMb: 0,
        }

        return {
            success: false,
            error: error.message,
            stack: error.stack,
            metrics,
        }
    }
}

// =============================================================================
// Startup — Port from workerData, execute immediately
// =============================================================================

// Initialize RPC port from workerData (transferred via constructor)
rpcPort = workerRpcPort
rpcPort.ref() // Keep event loop alive while RPC is active

// Listen for RPC responses from the main thread
rpcPort.on('message', (response: RpcResponse) => {
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

// Execute code and send result back to the host via parentPort
void executeCode().then((result) => {
    // Close the RPC port before sending result (allows worker to exit)
    rpcPort?.unref()
    rpcPort?.close()
    parentPort?.postMessage(result)
})
