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

function buildApiProxy(methods: Record<string, string[]>): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    for (const [group, methodNames] of Object.entries(methods)) {
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
            usage: 'Use mj.<group>.help() for group details. Example: mj.core.help()',
        })
    }

    return api
}

// =============================================================================
// Execution
// =============================================================================

async function executeCode(code: string, methodList: Record<string, string[]>, timeoutMs: number): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    try {
        const mjApi = buildApiProxy(methodList)

        const sandbox: Record<string, unknown> = {
            mj: mjApi,
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
        }

        const context = vm.createContext(sandbox, {
            name: 'codemode-worker-sandbox',
        })

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
// Master Listener
// =============================================================================

parentPort?.on('message', (msg: unknown) => {
    void (async () => {
        if (msg !== null && msg !== undefined && typeof msg === 'object' && 'type' in msg && (msg as { type: string }).type === 'EXECUTE') {
            const executeMsg = msg as unknown as {
                id: number
                code: string
                methodList: Record<string, string[]>
                timeoutMs?: number
                rpcPort: MessagePort
            }
            const { id, code, methodList, timeoutMs, rpcPort: newRpcPort } = executeMsg

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

            const result = await executeCode(code, methodList, timeoutMs ?? 30000)

            rpcPort?.close()
            rpcPort = null

            parentPort?.postMessage({ type: 'RESULT', id, result })
        }
    })()
})
