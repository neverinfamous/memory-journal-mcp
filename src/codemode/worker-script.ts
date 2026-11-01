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
import { hardenOuterFunctionPrototypes, freezeInnerVmContext } from './worker/prototype-hardening.js'
import { createSafeFsShim } from './worker/node-shims.js'
import { createUpdateMemoryFn, createContextProxy } from './worker/namespace-shims.js'
import { createShimMjProxy } from './worker/mj-shim-proxy.js'
import { buildSandboxGlobals } from './worker/sandbox-globals.js'
import { serializeAndEnforceEgress } from './worker/result-compactor.js'

hardenOuterFunctionPrototypes()

let rpcPort: MessagePort | null = null
let rpcIdCounter = 0
const pendingRpcRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>()

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
        const mjApi = buildApiProxy(rpcCall, methodList, schemaList, readonlyMode, contextObj)

        for (const key of Object.keys(mjApi)) {
            const val = mjApi[key]
            if (typeof val === 'object' && val !== null) Object.freeze(val)
        }
        Object.freeze(mjApi)

        const safeFsShim = createSafeFsShim(contextObj)
        const executeCodeFnRef: { current?: (arg: unknown) => Promise<unknown> } = {}
        const updateMemoryFnHolder: { current?: (arg: unknown) => unknown } = {}

        const shimMj = createShimMjProxy({
            mjApi,
            safeFsShim,
            executeCodeFnRef,
            getUpdateMemoryFn: () => updateMemoryFnHolder.current ?? (() => undefined),
        })

        const updateMemoryFn = createUpdateMemoryFn(shimMj)
        updateMemoryFnHolder.current = updateMemoryFn

        const frozenContext = createContextProxy(contextObj)
        const vmContextRef: { current?: vm.Context } = {}

        const invokeCreateEntry = (payload: unknown): unknown => {
            const coreGroup = shimMj['core']
            if ((typeof coreGroup === 'object' && coreGroup !== null) || typeof coreGroup === 'function') {
                const fn = Reflect.get(coreGroup, 'createEntry') as unknown
                if (typeof fn === 'function') return (fn as (a: unknown) => unknown)(payload)
            }
            return undefined
        }

        const executeCodeFn = async (arg: unknown): Promise<unknown> => {
            let codeToExec = ''
            if (typeof arg === 'string') {
                codeToExec = arg
            } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
                const codeProp = Reflect.get(arg, 'code') as unknown
                const scriptProp = Reflect.get(arg, 'script') as unknown
                codeToExec = typeof codeProp === 'string' ? codeProp : typeof scriptProp === 'string' ? scriptProp : ''
                if (
                    codeToExec === '' &&
                    (typeof Reflect.get(arg, 'content') === 'string' ||
                        typeof Reflect.get(arg, 'text') === 'string' ||
                        typeof Reflect.get(arg, 'description') === 'string' ||
                        typeof Reflect.get(arg, 'title') === 'string')
                ) {
                    return invokeCreateEntry(arg)
                }
            }
            if (codeToExec !== '') {
                const trimmed = codeToExec.trim()
                const isNaturalPrompt =
                    /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(trimmed) &&
                    !/\b(const|let|var|function|return|await|import|export)\b/.test(trimmed)
                if (isNaturalPrompt || /^(?:create|add|new|record|log)?\s*entry\b/i.test(trimmed)) {
                    const firstLine = (trimmed.split('\n')[0] ?? '')
                        .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
                        .replace(/[:.]+$/, '')
                        .trim()
                    const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
                    return invokeCreateEntry({ title, content: trimmed, entry_type: 'technical_decision' })
                }
                if (vmContextRef.current !== undefined) {
                    const transformed = transformAutoReturn(codeToExec)
                    const wrapped = `(async () => {\n${transformed}\n})()`
                    return (await vm.runInContext(wrapped, vmContextRef.current)) as unknown
                }
            }
            return { success: true }
        }
        executeCodeFnRef.current = executeCodeFn

        const sandbox = buildSandboxGlobals({
            mjApi,
            shimMj,
            safeFsShim,
            frozenContext,
            executeCodeFn,
            updateMemoryFn,
        })

        const context = vm.createContext(sandbox, {
            name: 'codemode-worker-sandbox',
            codeGeneration: { strings: false, wasm: false },
        })
        vmContextRef.current = context

        freezeInnerVmContext(context)

        const transformed = transformAutoReturn(code)
        const script = new vm.Script(`(async () => {\n${transformed}\n})()`, {
            filename: 'codemode-execution.js',
        })

        const resultPromise = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>
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
        if (
            errString.includes('missing ) after argument list') ||
            errString.includes('is not a function') ||
            errString.includes('Invalid or unexpected token') ||
            errString.includes('Unexpected token') ||
            errString.includes('Unexpected identifier') ||
            errString.includes('Cannot use import statement')
        ) {
            error.message = `🛠️ AUTONOMOUS HEALING: Syntax error in Code Mode execution (${error.message}). Code Mode requires valid JavaScript code (e.g., 'return await mj.core.getRecentEntries({ limit: 10 })' or 'return await mj.core.createEntry(...)'), not raw SQL statements or unquoted text.\n\n💡 Tip: When querying the journal, use Code Mode methods like 'return await mj.core.getRecentEntries({ limit: 10 })' or 'return await mj.search.searchEntries({ query: "..." })'. When passing long multi-line strings or markdown with embedded quotes/backticks, pass them safely via the \`context\` parameter and reference them as \`context.myParam\`.`
        }

        return {
            success: false,
            error: error.message,
            metrics: {
                wallTimeMs: Math.round(endTime - startTime),
                cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1000),
                memoryUsedMb: 0,
            },
        }
    }
}

interface ExecuteWorkerMessage {
    type: 'EXECUTE'; id: number; code: string; methodList: Record<string, string[]>;
    schemaList?: Record<string, Record<string, string>>; timeoutMs?: number; maxResultSize?: number;
    rpcPort: MessagePort; contextObj?: Record<string, unknown>; readonlyMode?: boolean;
}

function isExecuteMessage(msg: unknown): msg is ExecuteWorkerMessage {
    return msg !== null && msg !== undefined && typeof msg === 'object' && 'type' in msg && Reflect.get(msg, 'type') === 'EXECUTE'
}

parentPort?.on('message', (msg: unknown) => {
    void (async () => {
        if (!isExecuteMessage(msg)) return
        const { id, code, methodList, schemaList, timeoutMs, maxResultSize, rpcPort: newRpcPort, contextObj, readonlyMode } = msg
        rpcPort = newRpcPort
        rpcIdCounter = 0
        pendingRpcRequests.clear()

        rpcPort?.on('message', (response: RpcResponse) => {
            const pending = pendingRpcRequests.get(response.id)
            if (pending !== undefined) {
                pendingRpcRequests.delete(response.id)
                if (response.error !== undefined) pending.reject(new Error(response.error))
                else pending.resolve(response.result)
            }
        })

        const result = await executeCode(code, methodList, schemaList, timeoutMs ?? 30000, contextObj, readonlyMode)
        serializeAndEnforceEgress(result, maxResultSize)
        rpcPort?.close()
        rpcPort = null
        parentPort?.postMessage({ type: 'RESULT', id, result })
    })()
})
