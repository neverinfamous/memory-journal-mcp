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
import { validateSandboxCode } from './security.js'

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

function createScopedRpcCall(overrides?: { readonly?: boolean; dryRun?: boolean }): RpcCallFn {
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
            }
            rpcPort.postMessage(request)
        })
    }
}

const rpcCall = createScopedRpcCall()

type RunIsolatedNestedFn = (wrapped: string, nestedReadonly: boolean, nestedDryRun: boolean) => Promise<unknown>

interface SandboxExecutorOptions {
    shimMj: Record<string, unknown>
    vmContextRef: { current?: vm.Context }
    timeoutMs: number
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    pinnedWorkspaceRaw: unknown
    runIsolatedNestedCode: RunIsolatedNestedFn
}

function createSandboxExecutor(options: SandboxExecutorOptions): (arg: unknown) => Promise<unknown> {
    const {
        shimMj,
        vmContextRef,
        timeoutMs,
        readonlyMode,
        dryRunMode,
        pinnedWorkspaceRaw,
        runIsolatedNestedCode,
    } = options
    const pinnedWorkspace =
        typeof pinnedWorkspaceRaw === 'string' &&
        pinnedWorkspaceRaw.trim() !== '' &&
        pinnedWorkspaceRaw.trim() !== '*'
            ? pinnedWorkspaceRaw.trim()
            : undefined

    const invokeCreateEntry = (payload: unknown): unknown => {
        const coreGroup = shimMj['core']
        if ((typeof coreGroup === 'object' && coreGroup !== null) || typeof coreGroup === 'function') {
            const fn = Reflect.get(coreGroup, 'createEntry') as unknown
            if (typeof fn === 'function') return (fn as (a: unknown) => unknown)(payload)
        }
        return undefined
    }

    return async (arg: unknown): Promise<unknown> => {
        const isPlainRec = (val: unknown): val is Record<string, unknown> =>
            typeof val === 'object' && val !== null && !Array.isArray(val)
        const argRec = isPlainRec(arg) ? arg : undefined
        const argReadonly = argRec?.['readonly'] === true
        const argDryRun = argRec?.['dry_run'] === true || argRec?.['dryRun'] === true
        const rawArgWs = argRec?.['workspace_id'] ?? argRec?.['workspaceId']
        const argWs =
            typeof rawArgWs === 'string' && rawArgWs.trim() !== '' && rawArgWs.trim() !== '*'
                ? rawArgWs.trim()
                : undefined
        if (
            argWs !== undefined &&
            pinnedWorkspace !== undefined &&
            argWs.toLowerCase() !== pinnedWorkspace.toLowerCase()
        ) {
            return {
                success: false,
                error: `Workspace '${argWs}' conflicts with pinned session workspace '${pinnedWorkspace}'`,
                code: 'VALIDATION_ERROR',
            }
        }
        const effectiveReadonly = readonlyMode === true || argReadonly

        const codeToExec = readExecutableCode(arg)
        if (codeToExec === null) {
            if (effectiveReadonly) {
                return {
                    success: false,
                    error: 'Write operations are disabled in readonly mode',
                    code: 'PERMISSION_DENIED',
                }
            }
            if (argDryRun || dryRunMode === true) {
                return {
                    success: false,
                    error: 'dry_run is not supported for synthesized entry writes inside nested execute_code',
                    code: 'VALIDATION_ERROR',
                }
            }
            return invokeCreateEntry(arg)
        }
        if (codeToExec === '') {
            return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }
        }
        const natural = naturalLanguageEntry(codeToExec)
        if (natural !== undefined) {
            if (effectiveReadonly) {
                return {
                    success: false,
                    error: 'Write operations are disabled in readonly mode',
                    code: 'PERMISSION_DENIED',
                }
            }
            if (argDryRun || dryRunMode === true) {
                return {
                    success: false,
                    error: 'dry_run is not supported for synthesized entry writes inside nested execute_code',
                    code: 'VALIDATION_ERROR',
                }
            }
            return invokeCreateEntry(natural)
        }
        const validation = validateSandboxCode(codeToExec)
        if (!validation.valid) {
            return {
                success: false,
                error: validation.errors.join('; '),
                code: 'SECURITY_VIOLATION',
            }
        }
        if (vmContextRef.current !== undefined) {
            const transformed = transformAutoReturn(codeToExec)
            const wrapped = `(async () => {\n${transformed}\n})()`
            const effectiveDryRun = dryRunMode === true || argDryRun
            if ((effectiveReadonly && readonlyMode !== true) || (effectiveDryRun && dryRunMode !== true)) {
                return runIsolatedNestedCode(wrapped, effectiveReadonly, effectiveDryRun)
            }
            return (await vm.runInContext(wrapped, vmContextRef.current, { timeout: timeoutMs })) as unknown
        }
        return { success: false, error: 'No code was executed', code: 'VALIDATION_ERROR' }
    }
}

function readExecutableCode(arg: unknown): string | null {
    if (typeof arg === 'string') return arg
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return ''
    const codeProp = Reflect.get(arg, 'code') as unknown
    const scriptProp = Reflect.get(arg, 'script') as unknown
    const codeToExec = typeof codeProp === 'string' ? codeProp : typeof scriptProp === 'string' ? scriptProp : ''
    if (codeToExec !== '') return codeToExec
    const hasEntryText =
        typeof Reflect.get(arg, 'content') === 'string' ||
        typeof Reflect.get(arg, 'text') === 'string' ||
        typeof Reflect.get(arg, 'description') === 'string' ||
        typeof Reflect.get(arg, 'title') === 'string'
    return hasEntryText ? null : ''
}

function naturalLanguageEntry(codeToExec: string): { title: string; content: string; entry_type: string } | undefined {
    const trimmed = codeToExec.trim()
    const isNaturalPrompt =
        /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(trimmed) &&
        !/\b(const|let|var|function|return|await|import|export)\b/.test(trimmed)
    const looksLikeCode = /[{}()=]/.test(trimmed)
    if (looksLikeCode || !(isNaturalPrompt || /^(?:create|add|new|record|log)?\s*entry\b/i.test(trimmed))) {
        return undefined
    }
    const firstLine = (trimmed.split('\n')[0] ?? '')
        .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
        .replace(/[:.]+$/, '')
        .trim()
    const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
    return { title, content: trimmed, entry_type: 'technical_note' }
}

interface VmExecutionContextOptions {
    rpcFn: RpcCallFn
    methodList: Record<string, string[]>
    schemaList: Record<string, Record<string, string>> | undefined
    timeoutMs: number
    contextObj: Record<string, unknown> | undefined
    readonlyMode: boolean | undefined
    dryRunMode: boolean | undefined
    pinnedWorkspaceRaw: unknown
    activeTimers: Set<NodeJS.Timeout>
}

function createVmExecutionContext(options: VmExecutionContextOptions): vm.Context {
    const {
        rpcFn,
        methodList,
        schemaList,
        timeoutMs,
        contextObj,
        readonlyMode,
        dryRunMode,
        pinnedWorkspaceRaw,
        activeTimers,
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
    const runIsolatedNestedCode: RunIsolatedNestedFn = async (
        wrapped: string,
        nestedReadonly: boolean,
        nestedDryRun: boolean
    ): Promise<unknown> => {
        const overrides: { readonly?: boolean; dryRun?: boolean } = {}
        if (nestedReadonly) overrides.readonly = true
        if (nestedDryRun) overrides.dryRun = true
        const nestedContext = createVmExecutionContext({
            rpcFn: createScopedRpcCall(overrides),
            methodList,
            schemaList,
            timeoutMs,
            contextObj,
            readonlyMode: nestedReadonly,
            dryRunMode: nestedDryRun,
            pinnedWorkspaceRaw,
            activeTimers,
        })
        return (await vm.runInContext(wrapped, nestedContext, { timeout: timeoutMs })) as unknown
    }

    const executeCodeFn = createSandboxExecutor({
        shimMj,
        vmContextRef,
        timeoutMs,
        readonlyMode,
        dryRunMode,
        pinnedWorkspaceRaw,
        runIsolatedNestedCode,
    })
    executeCodeFnRef.current = executeCodeFn

    const sandbox = buildSandboxGlobals({
        mjApi,
        shimMj,
        safeFsShim,
        frozenContext,
        executeCodeFn,
        updateMemoryFn,
        activeTimers,
    })

    const context = vm.createContext(sandbox, {
        name: 'codemode-worker-sandbox',
        codeGeneration: { strings: false, wasm: false },
    })
    vmContextRef.current = context
    freezeInnerVmContext(context)
    return context
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
    if (hardeningError !== null) {
        return { success: false, error: hardeningError, metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 } }
    }
    const activeTimers = new Set<NodeJS.Timeout>()

    const registryPayload = contextObj?.['__mj_project_registry']
    const pinnedWorkspaceRaw = contextObj?.['__mj_workspace_id']
    if (contextObj !== undefined) {
        Reflect.deleteProperty(contextObj, '__mj_project_registry')
        Reflect.deleteProperty(contextObj, '__mj_workspace_id')
    }
    setActiveProjectRegistry(readProjectRegistryPayload(registryPayload))

    try {
        const context = createVmExecutionContext({
            rpcFn: rpcCall,
            methodList,
            schemaList,
            timeoutMs,
            contextObj,
            readonlyMode,
            dryRunMode: undefined,
            pinnedWorkspaceRaw,
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
    } finally {
        setActiveProjectRegistry(undefined)
        for (const handle of activeTimers) {
            clearTimeout(handle)
        }
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
            const result = await executeCode(code, methodList, schemaList, timeoutMs ?? 30000, contextObj, readonlyMode)
            serializeAndEnforceEgress(result, maxResultSize)
            if (!resultSent) {
                resultSent = true
                parentPort?.postMessage({ type: 'RESULT', id, result })
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
