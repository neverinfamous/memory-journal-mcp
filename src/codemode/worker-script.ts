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
import { readProjectRegistryPayload, setActiveProjectRegistry } from './normalizers/generic-field-aliases.js'
import { buildApiProxy } from './worker-api-proxy.js'
import { hardenOuterFunctionPrototypes, freezeInnerVmContext } from './worker/prototype-hardening.js'
import { createSafeFsShim } from './worker/node-shims.js'
import { createUpdateMemoryFn, createContextProxy } from './worker/namespace-shims.js'
import { createShimMjProxy } from './worker/mj-shim-proxy.js'
import { buildSandboxGlobals } from './worker/sandbox-globals.js'
import { serializeAndEnforceEgress } from './worker/result-compactor.js'
import {
    createIsolatedNestedRunner,
    createScopedRpcCall,
    type VmExecutionContextOptions,
} from './worker/nested-exec-runner.js'
import { createSandboxExecutor } from './worker/nested-exec-scope.js'
import {
    formatVmErrorResult,
    getOrCompileVmScript,
    isExecuteMessage,
    resolveWorkerMetadata,
} from './worker/script-and-metadata-cache.js'

// [L4] Hardening failures are fatal: refuse to execute any user code in a half-hardened realm.
const hardeningFailures = hardenOuterFunctionPrototypes()
const hardeningError =
    hardeningFailures.length > 0
        ? `Code Mode worker prototype hardening failed: ${hardeningFailures.join(', ')}`
        : null

let activeExecutionId: number | null = null
let resultSent = false

function postExecutionFailure(reason: unknown): void {
    if (activeExecutionId === null || resultSent) return
    const id = activeExecutionId
    resultSent = true
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const result: SandboxResult = {
        success: false,
        error: error.message,
        metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
        ...(error.stack !== undefined ? { stack: error.stack } : {}),
    }
    parentPort?.postMessage({ type: 'RESULT', id, result })
}

process.on('unhandledRejection', (reason: unknown) => {
    postExecutionFailure(reason)
})
process.on('uncaughtException', (err: unknown) => {
    postExecutionFailure(err)
})

let rpcPort: MessagePort | null = null
let rpcIdCounter = 0
const pendingRpcRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>()

function rejectPendingRpcRequests(message: string): void {
    for (const pending of pendingRpcRequests.values()) {
        pending.reject(new Error(message))
    }
    pendingRpcRequests.clear()
}

function sendRpcRequest(payload: Omit<RpcRequest, 'id'>): Promise<unknown> {
    return new Promise((resolve, reject) => {
        if (!rpcPort) {
            reject(new Error('RPC port not initialized'))
            return
        }
        const id = ++rpcIdCounter
        pendingRpcRequests.set(id, { resolve, reject })
        rpcPort.postMessage({ id, ...payload })
    })
}

const rpcCall = createScopedRpcCall(sendRpcRequest)

function createVmExecutionContext(options: VmExecutionContextOptions): vm.Context {
    const {
        rpcFn, methodList, schemaList, timeoutMs, maxResultSize, contextObj, readonlyMode, dryRunMode,
        useTestDbMode, pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, activeTimers,
    } = options
    const mjApi = buildApiProxy(rpcFn, methodList, schemaList, readonlyMode, contextObj)
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
    const runIsolatedNestedCode = createIsolatedNestedRunner(
        options,
        sendRpcRequest,
        createVmExecutionContext
    )

    const executeCodeFn = createSandboxExecutor({
        shimMj, vmContextRef, timeoutMs, maxResultSize, readonlyMode, dryRunMode, useTestDbMode,
        pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, runIsolatedNestedCode, activeTimers,
    })
    executeCodeFnRef.current = executeCodeFn

    const sandbox = buildSandboxGlobals({
        mjApi, shimMj, safeFsShim, frozenContext, executeCodeFn, updateMemoryFn, activeTimers,
    })

    const context = vm.createContext(sandbox, {
        name: 'codemode-worker-sandbox',
        codeGeneration: { strings: false, wasm: false },
    })
    vmContextRef.current = context
    freezeInnerVmContext(context)
    return context
}

function extractScopeContext(contextObj?: Record<string, unknown>): {
    registryPayload: unknown
    pinnedWorkspaceRaw: unknown
    pinnedProjectRaw: unknown
} {
    const registryPayload = contextObj?.['__mj_project_registry']
    const pinnedWorkspaceRaw = contextObj?.['__mj_workspace_id']
    const pinnedProjectRaw = contextObj?.['__mj_project_number']
    if (contextObj !== undefined) {
        Reflect.deleteProperty(contextObj, '__mj_project_registry')
        Reflect.deleteProperty(contextObj, '__mj_workspace_id')
        Reflect.deleteProperty(contextObj, '__mj_project_number')
    }
    return { registryPayload, pinnedWorkspaceRaw, pinnedProjectRaw }
}

async function executeCode(
    code: string,
    methodList: Record<string, string[]>,
    schemaList: Record<string, Record<string, string>> | undefined,
    timeoutMs: number,
    contextObj?: Record<string, unknown>,
    readonlyMode?: boolean,
    maxResultSize?: number,
    dryRunMode?: boolean,
    useTestDbMode?: boolean
): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()
    if (hardeningError !== null) {
        return { success: false, error: hardeningError, metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 } }
    }
    const activeTimers = new Set<NodeJS.Timeout>()
    const { registryPayload, pinnedWorkspaceRaw, pinnedProjectRaw } = extractScopeContext(contextObj)
    setActiveProjectRegistry(readProjectRegistryPayload(registryPayload))

    try {
        const context = createVmExecutionContext({
            rpcFn: rpcCall,
            methodList,
            schemaList,
            timeoutMs,
            ...(maxResultSize !== undefined ? { maxResultSize } : {}),
            contextObj,
            ...(readonlyMode !== undefined ? { readonlyMode } : {}),
            ...(dryRunMode !== undefined ? { dryRunMode } : {}),
            ...(useTestDbMode !== undefined ? { useTestDbMode } : {}),
            pinnedWorkspaceRaw,
            pinnedProjectRaw,
            projectRegistryRaw: registryPayload,
            activeTimers,
        })
        const transformed = transformAutoReturn(code)
        const script = getOrCompileVmScript(`(async () => {\n${transformed}\n})()`)
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
        return formatVmErrorResult(err, startTime, startCpu)
    } finally {
        setActiveProjectRegistry(undefined)
        for (const handle of activeTimers) clearTimeout(handle)
        activeTimers.clear()
    }
}

parentPort?.on('message', (msg: unknown) => {
    void (async () => {
        if (!isExecuteMessage(msg)) return
        const {
            id,
            code,
            timeoutMs,
            maxResultSize,
            rpcPort: newRpcPort,
            contextObj,
            readonlyMode,
            dryRunMode,
            useTestDbMode,
        } = msg
        const { methodList, schemaList } = resolveWorkerMetadata(msg)
        rpcPort = newRpcPort
        rpcIdCounter = 0
        rejectPendingRpcRequests('Sandbox execution ended before the call completed')
        activeExecutionId = id
        resultSent = false

        rpcPort?.on('message', (response: RpcResponse) => {
            const pending = pendingRpcRequests.get(response.id)
            if (pending !== undefined) {
                pendingRpcRequests.delete(response.id)
                if (response.error !== undefined) pending.reject(new Error(response.error))
                else pending.resolve(response.result)
            }
        })

        try {
            const result = await executeCode(
                code,
                methodList,
                schemaList,
                timeoutMs ?? 30000,
                contextObj,
                readonlyMode,
                maxResultSize,
                dryRunMode,
                useTestDbMode
            )
            serializeAndEnforceEgress(result, maxResultSize)
            if (!resultSent) {
                parentPort?.postMessage({ type: 'RESULT', id, result })
                resultSent = true
            }
        } catch (err: unknown) {
            postExecutionFailure(err)
        } finally {
            rejectPendingRpcRequests('Sandbox execution ended before the call completed')
            rpcPort?.close()
            rpcPort = null
            activeExecutionId = null
        }
    })()
})
