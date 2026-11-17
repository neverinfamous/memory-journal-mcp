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
import { createSandboxExecutor, type NestedExecIsolationOverrides, type RunIsolatedNestedFn } from './worker/nested-exec-scope.js'

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

type RpcCallFn = (group: string, method: string, args: unknown[]) => Promise<unknown>

interface ScopedRpcOverrides {
    readonly?: boolean
    dryRun?: boolean
    useTestDb?: boolean
    workspaceId?: string
    projectNumber?: number
    sessionId?: string
    autoVersion?: boolean
}

function createScopedRpcCall(overrides?: ScopedRpcOverrides): RpcCallFn {
    return (group: string, method: string, args: unknown[]): Promise<unknown> => {
        return new Promise((resolve, reject) => {
            if (!rpcPort) {
                reject(new Error('RPC port not initialized'))
                return
            }
            const id = ++rpcIdCounter
            pendingRpcRequests.set(id, { resolve, reject })
            const request: RpcRequest = {
                id,
                group,
                method,
                args,
                ...(overrides?.readonly === true ? { readonly: true } : {}),
                ...(overrides?.dryRun === true ? { dryRun: true } : {}),
                ...(overrides?.useTestDb === true ? { useTestDb: true } : {}),
                ...(overrides?.workspaceId !== undefined ? { workspaceId: overrides.workspaceId } : {}),
                ...(overrides?.projectNumber !== undefined ? { projectNumber: overrides.projectNumber } : {}),
                ...(overrides?.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
                ...(overrides?.autoVersion !== undefined ? { autoVersion: overrides.autoVersion } : {}),
            }
            rpcPort.postMessage(request)
        })
    }
}

const rpcCall = createScopedRpcCall()

/* createSandboxExecutor moved to ./worker/nested-exec-scope.ts */

interface VmExecutionContextOptions {
    rpcFn: RpcCallFn
    methodList: Record<string, string[]>
    schemaList: Record<string, Record<string, string>> | undefined
    timeoutMs: number
    maxResultSize?: number | undefined
    contextObj: Record<string, unknown> | undefined
    readonlyMode?: boolean
    dryRunMode?: boolean
    useTestDbMode?: boolean
    pinnedWorkspaceRaw: unknown
    pinnedProjectRaw: unknown
    projectRegistryRaw: unknown
    activeTimers: Set<NodeJS.Timeout>
}

function mergeNestedExecutionContext(
    outerContext: Record<string, unknown> | undefined,
    nestedContext: Record<string, unknown> | undefined,
    workspaceId: string | undefined,
    projectNumber: number | undefined,
    sessionId: string | undefined
): Record<string, unknown> | undefined {
    if (
        nestedContext === undefined &&
        workspaceId === undefined &&
        projectNumber === undefined &&
        sessionId === undefined
    ) {
        return outerContext
    }
    const merged: Record<string, unknown> = { ...(outerContext ?? {}) }
    if (nestedContext !== undefined) {
        for (const [k, v] of Object.entries(nestedContext)) {
            if (k.startsWith('__mj_') || k === '__proto__' || k === 'constructor' || k === 'prototype') {
                continue
            }
            merged[k] = v
        }
    }
    if (workspaceId !== undefined) {
        merged['workspace_id'] = workspaceId
        merged['workspaceId'] = workspaceId
    }
    if (projectNumber !== undefined) {
        merged['project_number'] = projectNumber
        merged['projectNumber'] = projectNumber
        merged['project_id'] = projectNumber
        merged['projectId'] = projectNumber
    }
    if (sessionId !== undefined) {
        merged['session_id'] = sessionId
        merged['sessionId'] = sessionId
    }
    return merged
}

function enforceNestedResultLimit(rawResult: unknown, maxResultSize: number | undefined): unknown {
    if (maxResultSize === undefined || rawResult === undefined) return rawResult
    const wrapper: SandboxResult = {
        success: true,
        result: rawResult,
        metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 },
    }
    serializeAndEnforceEgress(wrapper, maxResultSize)
    if (!wrapper.success) {
        throw new Error(wrapper.error ?? 'Nested execution output limit exceeded')
    }
    return wrapper.result
}

function createIsolatedNestedRunner(options: VmExecutionContextOptions): RunIsolatedNestedFn {
    const {
        methodList, schemaList, timeoutMs, maxResultSize, contextObj,
        pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, activeTimers,
    } = options
    const outerWs =
        typeof pinnedWorkspaceRaw === 'string' && pinnedWorkspaceRaw.trim() !== '' && pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined
    const outerProj =
        typeof pinnedProjectRaw === 'number' && Number.isInteger(pinnedProjectRaw) && pinnedProjectRaw > 0
            ? pinnedProjectRaw
            : undefined

    return async (
        wrapped: string,
        nestedReadonly: boolean,
        nestedDryRun: boolean,
        nestedUseTestDb: boolean,
        overrides?: NestedExecIsolationOverrides
    ): Promise<unknown> => {
        const nextWs = outerWs ?? overrides?.workspaceId
        const nextProj = outerProj ?? overrides?.projectNumber
        const nextTimeout =
            overrides?.timeoutMs !== undefined ? Math.min(timeoutMs, overrides.timeoutMs) : timeoutMs
        const nextMaxResult =
            overrides?.maxResultSize !== undefined && maxResultSize !== undefined
                ? Math.min(maxResultSize, overrides.maxResultSize)
                : (overrides?.maxResultSize ?? maxResultSize)
        const mergedContext = mergeNestedExecutionContext(
            contextObj, overrides?.contextObj, nextWs, nextProj, overrides?.sessionId
        )
        const rpcOverrides: ScopedRpcOverrides = {
            ...(nestedReadonly ? { readonly: true } : {}),
            ...(nestedDryRun ? { dryRun: true } : {}),
            ...(nestedUseTestDb ? { useTestDb: true } : {}),
            ...(nextWs !== undefined ? { workspaceId: nextWs } : {}),
            ...(nextProj !== undefined ? { projectNumber: nextProj } : {}),
            ...(overrides?.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
            ...(overrides?.autoVersion !== undefined ? { autoVersion: overrides.autoVersion } : {}),
        }
        const nestedContext = createVmExecutionContext({
            rpcFn: createScopedRpcCall(rpcOverrides),
            methodList,
            schemaList,
            timeoutMs: nextTimeout,
            maxResultSize: nextMaxResult,
            contextObj: mergedContext,
            readonlyMode: nestedReadonly,
            dryRunMode: nestedDryRun,
            useTestDbMode: nestedUseTestDb,
            pinnedWorkspaceRaw: nextWs ?? pinnedWorkspaceRaw,
            pinnedProjectRaw: nextProj ?? pinnedProjectRaw,
            projectRegistryRaw,
            activeTimers,
        })
        const rawResult = (await vm.runInContext(wrapped, nestedContext, { timeout: nextTimeout })) as unknown
        return enforceNestedResultLimit(rawResult, overrides?.maxResultSize)
    }
}

function createVmExecutionContext(options: VmExecutionContextOptions): vm.Context {
    const {
        rpcFn, methodList, schemaList, timeoutMs, maxResultSize, contextObj, readonlyMode, dryRunMode,
        useTestDbMode, pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, activeTimers,
    } = options
    const mjApi = buildApiProxy(rpcFn, methodList, schemaList, readonlyMode, contextObj)

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
    const runIsolatedNestedCode = createIsolatedNestedRunner(options)

    const executeCodeFn = createSandboxExecutor({
        shimMj, vmContextRef, timeoutMs, maxResultSize, readonlyMode, dryRunMode, useTestDbMode,
        pinnedWorkspaceRaw, pinnedProjectRaw, projectRegistryRaw, runIsolatedNestedCode,
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

function formatVmErrorResult(
    err: unknown,
    startTime: number,
    startCpu: NodeJS.CpuUsage
): SandboxResult {
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

async function executeCode(
    code: string,
    methodList: Record<string, string[]>,
    schemaList: Record<string, Record<string, string>> | undefined,
    timeoutMs: number,
    contextObj?: Record<string, unknown>,
    readonlyMode?: boolean,
    maxResultSize?: number
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
            pinnedWorkspaceRaw,
            pinnedProjectRaw,
            projectRegistryRaw: registryPayload,
            activeTimers,
        })
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
        return formatVmErrorResult(err, startTime, startCpu)
    } finally {
        setActiveProjectRegistry(undefined)
        for (const handle of activeTimers) clearTimeout(handle)
        activeTimers.clear()
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
                code, methodList, schemaList, timeoutMs ?? 30000, contextObj, readonlyMode, maxResultSize
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
