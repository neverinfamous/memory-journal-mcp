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

// Capture host macrotask scheduler before prototype/global hardening runs.
const hostSetImmediate = setImmediate
import type { RpcRequest, RpcResponse, SandboxResult, ExecutionMetrics } from './types.js'
import { transformAutoReturn } from './auto-return.js'
import { validateSandboxCode } from './security.js'
import { DEFAULT_SECURITY_CONFIG } from './types.js'
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
let activeAbortCleanup: ((reason: string) => void) | null = null

function postExecutionFailure(reason: unknown): void {
    if (activeExecutionId === null || resultSent) return
    const id = activeExecutionId
    resultSent = true
    activeAbortCleanup?.('Sandbox execution aborted due to unhandled async error')
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const result: SandboxResult = {
        success: false,
        error: error.message,
        metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
        ...(error.stack !== undefined ? { stack: error.stack } : {}),
    }
    // [H1] Mark async-error failures fatal so WorkerSandbox evicts any still-running background timers/microtasks.
    parentPort?.postMessage({ type: 'RESULT', id, result, fatal: true })
}

process.on('unhandledRejection', (reason: unknown) => {
    postExecutionFailure(reason)
})
process.on('uncaughtException', (err: unknown) => {
    postExecutionFailure(err)
})

interface ExecutionRpcBridge {
    sendRpcRequest: (payload: Omit<RpcRequest, 'id'>) => Promise<unknown>
    rpcCall: (group: string, method: string, args: unknown[]) => Promise<unknown>
    closeBridge: (reason: string) => void
}

function createExecutionRpcBridge(port: MessagePort): ExecutionRpcBridge {
    let closed = false
    let rpcIdCounter = 0
    const pendingRpcRequests = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (reason: Error) => void }
    >()

    const rejectAll = (message: string): void => {
        for (const pending of pendingRpcRequests.values()) {
            pending.reject(new Error(message))
        }
        pendingRpcRequests.clear()
    }

    port.on('message', (response: RpcResponse) => {
        const pending = pendingRpcRequests.get(response.id)
        if (pending !== undefined) {
            pendingRpcRequests.delete(response.id)
            if (response.error !== undefined) pending.reject(new Error(response.error))
            else pending.resolve(response.result)
        }
    })

    const sendRpcRequest = (payload: Omit<RpcRequest, 'id'>): Promise<unknown> =>
        new Promise((resolve, reject) => {
            if (closed) {
                reject(new Error('Sandbox execution has already ended'))
                return
            }
            const id = ++rpcIdCounter
            pendingRpcRequests.set(id, { resolve, reject })
            try {
                port.postMessage({ id, ...payload })
            } catch (err: unknown) {
                pendingRpcRequests.delete(id)
                reject(err instanceof Error ? err : new Error(String(err)))
            }
        })

    return {
        sendRpcRequest,
        rpcCall: createScopedRpcCall(sendRpcRequest),
        closeBridge: (reason: string): void => {
            if (closed) return
            closed = true
            rejectAll(reason)
            port.close()
        },
    }
}

function createVmExecutionContext(options: VmExecutionContextOptions): vm.Context {
    const {
        rpcFn, sendRpcRequest, methodList, schemaList, timeoutMs, maxResultSize, contextObj,
        readonlyMode, dryRunMode, useTestDbMode, pinnedWorkspaceRaw, pinnedProjectRaw,
        projectRegistryRaw, activeTimers,
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
    bridge: ExecutionRpcBridge,
    methodList: Record<string, string[]>,
    schemaList: Record<string, Record<string, string>> | undefined,
    timeoutMs: number,
    contextObj?: Record<string, unknown>,
    readonlyMode?: boolean,
    maxResultSize?: number,
    dryRunMode?: boolean,
    useTestDbMode?: boolean,
    activeTimers = new Set<NodeJS.Timeout>()
): Promise<SandboxResult> {
    const startCpu = process.cpuUsage()
    const startTime = performance.now()
    if (hardeningError !== null) {
        return { success: false, error: hardeningError, metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 } }
    }
    const { registryPayload, pinnedWorkspaceRaw, pinnedProjectRaw } = extractScopeContext(contextObj)
    setActiveProjectRegistry(readProjectRegistryPayload(registryPayload))

    try {
        const context = createVmExecutionContext({
            rpcFn: bridge.rpcCall,
            sendRpcRequest: bridge.sendRpcRequest,
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
        if (transformed !== code) {
            const postValidation = validateSandboxCode(transformed, {
                ...DEFAULT_SECURITY_CONFIG,
                maxCodeLength: DEFAULT_SECURITY_CONFIG.maxCodeLength + 32,
            })
            if (!postValidation.valid) {
                return {
                    success: false,
                    error: postValidation.errors.join('; '),
                    metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
                }
            }
        }
        const script = getOrCompileVmScript(`(async () => {\n"use strict";\n${transformed}\n})()`)
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
        const bridge = createExecutionRpcBridge(newRpcPort)
        const activeTimers = new Set<NodeJS.Timeout>()
        activeExecutionId = id
        resultSent = false
        activeAbortCleanup = (reason: string): void => {
            for (const handle of activeTimers) clearTimeout(handle)
            activeTimers.clear()
            bridge.closeBridge(reason)
        }

        try {
            const result = await executeCode(
                code,
                bridge,
                methodList,
                schemaList,
                timeoutMs ?? 30000,
                contextObj,
                readonlyMode,
                maxResultSize,
                dryRunMode,
                useTestDbMode,
                activeTimers
            )
            // Drain V8's microtask checkpoint before posting RESULT so unawaited microtask loops
            // or delayed async rejections cannot disarm the host timeout watchdog.
            if (!resultSent && activeExecutionId === id) {
                await new Promise<void>((resolve) => {
                    hostSetImmediate(resolve)
                })
            }
            serializeAndEnforceEgress(result, maxResultSize)
            if (!resultSent && activeExecutionId === id) {
                parentPort?.postMessage({ type: 'RESULT', id, result })
                resultSent = true
            }
        } catch (err: unknown) {
            postExecutionFailure(err)
        } finally {
            bridge.closeBridge('Sandbox execution ended before the call completed')
            if (activeExecutionId === id) {
                activeExecutionId = null
                activeAbortCleanup = null
            }
        }
    })()
})
