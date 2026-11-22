/**
 * Nested Code Mode `executeCode` isolated VM runner and RPC override propagation.
 * Worker-thread safe (no host DB, config-file, or external npm imports).
 */

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
}

export function createScopedRpcCall(
    sendRpcRequest: SendRpcRequestFn,
    overrides?: ScopedRpcOverrides
): RpcCallFn {
    return (group: string, method: string, args: unknown[]): Promise<unknown> =>
        sendRpcRequest({
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
        })
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
    overrides?: NestedExecIsolationOverrides
): { vmOpts: VmExecutionContextOptions; nextTimeout: number; nextMaxResult: number | undefined } {
    const nextWs = outerWs ?? overrides?.workspaceId
    const nextProj = outerProj ?? overrides?.projectNumber
    const nextTimeout =
        overrides?.timeoutMs !== undefined ? Math.min(options.timeoutMs, overrides.timeoutMs) : options.timeoutMs
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
            activeTimers: options.activeTimers,
            ...(options.executionLifecycle !== undefined
                ? { executionLifecycle: options.executionLifecycle }
                : {}),
        },
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
        const { vmOpts, nextTimeout, nextMaxResult } = buildNestedVmContextOptions(
            options,
            sendRpcRequest,
            outerWs,
            outerProj,
            nestedReadonly,
            nestedDryRun,
            nestedUseTestDb,
            overrides
        )
        const nestedContext = buildVmContext(vmOpts)
        const rawResult: unknown = await raceWithSandboxTimeout<unknown>(
            Promise.resolve(
                getOrCompileVmScript(wrapped).runInContext(nestedContext, { timeout: nextTimeout })
            ),
            nextTimeout,
            options.activeTimers
        )
        return enforceNestedResultLimit(rawResult, nextMaxResult)
    }
}
