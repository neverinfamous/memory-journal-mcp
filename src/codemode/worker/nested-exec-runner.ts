/**
 * Nested Code Mode `executeCode` isolated VM runner and RPC override propagation.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type * as vm from 'node:vm'
import type { RpcRequest } from '../types.js'
import type { NestedExecIsolationOverrides, RunIsolatedNestedFn } from './nested-exec-scope.js'
import { enforceNestedResultLimit, raceWithSandboxTimeout } from './nested-exec-payload.js'
import type { ExecutionLifecycleState } from './sandbox-globals.js'
import { getOrCompileVmScript } from './script-and-metadata-cache.js'

export { enforceNestedResultLimit }

export type RpcCallFn = (group: string, method: string, args: unknown[]) => Promise<unknown>
export type SendRpcRequestFn = (payload: Omit<RpcRequest, 'id'>) => Promise<unknown>

export interface ScopedRpcOverrides {
    readonly?: boolean
    dryRun?: boolean
    useTestDb?: boolean
    workspaceId?: string
    projectNumber?: number
    sessionId?: string
    autoVersion?: boolean
}

export const MAX_NESTED_EXEC_DEPTH = 4

export interface VmExecutionContextOptions {
    rpcFn: RpcCallFn
    sendRpcRequest: SendRpcRequestFn
    methodList: Record<string, string[]>
    schemaList: Record<string, Record<string, string>> | undefined
    timeoutMs: number
    maxResultSize?: number | undefined
    contextObj: Record<string, unknown> | undefined
    readonlyMode?: boolean
    dryRunMode?: boolean
    useTestDbMode?: boolean
    parentRpcOverrides?: ScopedRpcOverrides
    pinnedWorkspaceRaw: unknown
    pinnedProjectRaw: unknown
    projectRegistryRaw: unknown
    activeTimers: Set<NodeJS.Timeout>
    executionLifecycle?: ExecutionLifecycleState
    nestedDepth?: number
}

const nestedRpcOverridesStorage = new AsyncLocalStorage<ScopedRpcOverrides>()

function pickDefinedOverrides(raw: ScopedRpcOverrides): ScopedRpcOverrides | undefined {
    const cleaned: ScopedRpcOverrides = {
        ...(raw.readonly === true ? { readonly: true } : {}),
        ...(raw.dryRun === true ? { dryRun: true } : {}),
        ...(raw.useTestDb === true ? { useTestDb: true } : {}),
        ...(raw.workspaceId !== undefined ? { workspaceId: raw.workspaceId } : {}),
        ...(raw.projectNumber !== undefined ? { projectNumber: raw.projectNumber } : {}),
        ...(raw.sessionId !== undefined ? { sessionId: raw.sessionId } : {}),
        ...(raw.autoVersion !== undefined ? { autoVersion: raw.autoVersion } : {}),
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function mergeScopedRpcOverrides(
    outer: ScopedRpcOverrides | undefined,
    inner: ScopedRpcOverrides | undefined
): ScopedRpcOverrides | undefined {
    if (outer === undefined && inner === undefined) return undefined
    if (outer === undefined) return inner !== undefined ? pickDefinedOverrides(inner) : undefined
    if (inner === undefined) return pickDefinedOverrides(outer)
    const nextWs = outer.workspaceId ?? inner.workspaceId
    const nextProj = outer.projectNumber ?? inner.projectNumber
    const nextSession = outer.sessionId ?? inner.sessionId
    const nextAutoVersion =
        outer.autoVersion === false ? false : (inner.autoVersion ?? outer.autoVersion)
    return pickDefinedOverrides({
        ...(outer.readonly === true || inner.readonly === true ? { readonly: true } : {}),
        ...(outer.dryRun === true || inner.dryRun === true ? { dryRun: true } : {}),
        ...(outer.useTestDb === true || inner.useTestDb === true ? { useTestDb: true } : {}),
        ...(nextWs !== undefined ? { workspaceId: nextWs } : {}),
        ...(nextProj !== undefined ? { projectNumber: nextProj } : {}),
        ...(nextSession !== undefined ? { sessionId: nextSession } : {}),
        ...(nextAutoVersion !== undefined ? { autoVersion: nextAutoVersion } : {}),
    })
}

/** Run `fn` with active nested RPC override bounds propagated to fast-path RPC calls. */
export function runWithNestedRpcOverrides<T>(
    overrides: ScopedRpcOverrides | undefined,
    fn: () => T
): T {
    const merged = mergeScopedRpcOverrides(nestedRpcOverridesStorage.getStore(), overrides)
    if (merged === undefined) return fn()
    return nestedRpcOverridesStorage.run(merged, fn)
}

export function createScopedRpcCall(
    sendRpcRequest: SendRpcRequestFn,
    overrides?: ScopedRpcOverrides
): RpcCallFn {
    return (group: string, method: string, args: unknown[]): Promise<unknown> => {
        const merged = mergeScopedRpcOverrides(overrides, nestedRpcOverridesStorage.getStore())
        return sendRpcRequest({
            group,
            method,
            args,
            ...(merged?.readonly === true ? { readonly: true } : {}),
            ...(merged?.dryRun === true ? { dryRun: true } : {}),
            ...(merged?.useTestDb === true ? { useTestDb: true } : {}),
            ...(merged?.workspaceId !== undefined ? { workspaceId: merged.workspaceId } : {}),
            ...(merged?.projectNumber !== undefined ? { projectNumber: merged.projectNumber } : {}),
            ...(merged?.sessionId !== undefined ? { sessionId: merged.sessionId } : {}),
            ...(merged?.autoVersion !== undefined ? { autoVersion: merged.autoVersion } : {}),
        })
    }
}

export function mergeNestedExecutionContext(
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

function buildNestedVmContextOptions(
    options: VmExecutionContextOptions,
    sendRpcRequest: SendRpcRequestFn,
    outerWs: string | undefined,
    outerProj: number | undefined,
    nestedReadonly: boolean,
    nestedDryRun: boolean,
    nestedUseTestDb: boolean,
    childTimers: Set<NodeJS.Timeout>,
    childLifecycle: ExecutionLifecycleState,
    nextDepth: number,
    overrides?: NestedExecIsolationOverrides
): { vmOpts: VmExecutionContextOptions; nextTimeout: number; nextMaxResult: number | undefined } {
    const nextWs = outerWs ?? overrides?.workspaceId
    const nextProj = outerProj ?? overrides?.projectNumber
    const safeOuterTimeout = Math.max(1, Math.ceil(options.timeoutMs))
    const nextTimeout =
        overrides?.timeoutMs !== undefined
            ? Math.min(safeOuterTimeout, Math.max(1, Math.ceil(overrides.timeoutMs)))
            : safeOuterTimeout
    const nextMaxResult =
        overrides?.maxResultSize !== undefined && options.maxResultSize !== undefined
            ? Math.min(options.maxResultSize, overrides.maxResultSize)
            : (overrides?.maxResultSize ?? options.maxResultSize)
    const nextSessionId = options.parentRpcOverrides?.sessionId ?? overrides?.sessionId
    const nextAutoVersion =
        options.parentRpcOverrides?.autoVersion === false
            ? false
            : (overrides?.autoVersion ?? options.parentRpcOverrides?.autoVersion)
    const rpcOverrides: ScopedRpcOverrides = {
        ...(nestedReadonly ? { readonly: true } : {}),
        ...(nestedDryRun ? { dryRun: true } : {}),
        ...(nestedUseTestDb ? { useTestDb: true } : {}),
        ...(nextWs !== undefined ? { workspaceId: nextWs } : {}),
        ...(nextProj !== undefined ? { projectNumber: nextProj } : {}),
        ...(nextSessionId !== undefined ? { sessionId: nextSessionId } : {}),
        ...(nextAutoVersion !== undefined ? { autoVersion: nextAutoVersion } : {}),
    }
    return {
        nextTimeout,
        nextMaxResult,
        vmOpts: {
            sendRpcRequest,
            rpcFn: createScopedRpcCall(sendRpcRequest, rpcOverrides),
            methodList: options.methodList,
            schemaList: options.schemaList,
            timeoutMs: nextTimeout,
            maxResultSize: nextMaxResult,
            contextObj: mergeNestedExecutionContext(
                options.contextObj,
                overrides?.contextObj,
                nextWs,
                nextProj,
                nextSessionId
            ),
            readonlyMode: nestedReadonly,
            dryRunMode: nestedDryRun,
            useTestDbMode: nestedUseTestDb,
            parentRpcOverrides: rpcOverrides,
            pinnedWorkspaceRaw: nextWs ?? options.pinnedWorkspaceRaw,
            pinnedProjectRaw: nextProj,
            projectRegistryRaw: options.projectRegistryRaw,
            activeTimers: childTimers,
            executionLifecycle: childLifecycle,
            nestedDepth: nextDepth,
        },
    }
}

function invokeChildCleanups(
    childLifecycle: ExecutionLifecycleState,
    childTimers: Set<NodeJS.Timeout>,
    parentCleanupSet: Set<() => void> | undefined,
    cleanupFn: () => void
): void {
    childLifecycle.ended = true
    if (childLifecycle.childCleanups !== undefined) {
        for (const fn of childLifecycle.childCleanups) {
            try {
                fn()
            } catch {
                // Best-effort cleanup of nested children
            }
        }
        childLifecycle.childCleanups.clear()
    }
    for (const timer of childTimers) clearTimeout(timer)
    childTimers.clear()
    parentCleanupSet?.delete(cleanupFn)
}

function createChildLifecycleState(
    parentLifecycle: ExecutionLifecycleState | undefined
): ExecutionLifecycleState {
    let childPostClose = false
    return {
        ended: false,
        get postCloseActivity(): boolean {
            return childPostClose
        },
        set postCloseActivity(value: boolean) {
            childPostClose = value
            if (value && parentLifecycle !== undefined) {
                parentLifecycle.postCloseActivity = true
            }
        },
        childCleanups: new Set<() => void>(),
    }
}

export function createIsolatedNestedRunner(
    options: VmExecutionContextOptions,
    sendRpcRequest: SendRpcRequestFn,
    buildVmContext: (opts: VmExecutionContextOptions) => vm.Context
): RunIsolatedNestedFn {
    const outerWs =
        typeof options.pinnedWorkspaceRaw === 'string' &&
        options.pinnedWorkspaceRaw.trim() !== '' &&
        options.pinnedWorkspaceRaw.trim() !== '*'
            ? options.pinnedWorkspaceRaw.trim()
            : undefined
    const outerProj =
        typeof options.pinnedProjectRaw === 'number' &&
        Number.isSafeInteger(options.pinnedProjectRaw) &&
        options.pinnedProjectRaw > 0
            ? options.pinnedProjectRaw
            : undefined

    return async (
        wrapped: string,
        nestedReadonly: boolean,
        nestedDryRun: boolean,
        nestedUseTestDb: boolean,
        overrides?: NestedExecIsolationOverrides
    ): Promise<unknown> => {
        const nextDepth = (overrides?.nestedDepth ?? options.nestedDepth ?? 0) + 1
        if (nextDepth > MAX_NESTED_EXEC_DEPTH) {
            throw new Error(
                `Nested executeCode exceeded maximum recursion depth of ${String(MAX_NESTED_EXEC_DEPTH)}`
            )
        }
        if (options.executionLifecycle?.ended === true) {
            throw new Error('Nested sandbox execution has already ended')
        }
        const childTimers = new Set<NodeJS.Timeout>()
        const parentLifecycle = options.executionLifecycle
        const childLifecycle = createChildLifecycleState(parentLifecycle)
        const parentCleanupSet =
            options.executionLifecycle !== undefined
                ? (options.executionLifecycle.childCleanups ??= new Set<() => void>())
                : undefined
        const cleanupChild = (): void => {
            invokeChildCleanups(childLifecycle, childTimers, parentCleanupSet, cleanupChild)
        }
        parentCleanupSet?.add(cleanupChild)
        const childSendRpcRequest: SendRpcRequestFn = (payload) => {
            if (childLifecycle.ended || options.executionLifecycle?.ended === true) {
                childLifecycle.postCloseActivity = true
                return Promise.reject(new Error('Nested sandbox execution has already ended'))
            }
            return sendRpcRequest(payload)
        }
        const { vmOpts, nextTimeout, nextMaxResult } = buildNestedVmContextOptions(
            options, childSendRpcRequest, outerWs, outerProj,
            nestedReadonly, nestedDryRun, nestedUseTestDb,
            childTimers, childLifecycle, nextDepth, overrides
        )
        const nestedContext = buildVmContext(vmOpts)
        try {
            const rawResult: unknown = await raceWithSandboxTimeout<unknown>(
                Promise.resolve(
                    getOrCompileVmScript(wrapped).runInContext(nestedContext, {
                        timeout: Math.max(1, Math.ceil(nextTimeout)),
                    })
                ),
                nextTimeout,
                childTimers
            )
            // [M11] Teardown child lifecycle & timers BEFORE enforceNestedResultLimit runs untrusted toJSON()/getters.
            cleanupChild()
            return enforceNestedResultLimit(rawResult, nextMaxResult)
        } finally {
            cleanupChild()
        }
    }
}
