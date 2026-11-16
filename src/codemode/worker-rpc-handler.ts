/**
 * Main-thread RPC handler for Code Mode worker sandboxes (split out of worker-sandbox.ts).
 */

import type { MessagePort } from 'node:worker_threads'
import type { RpcRequest, RpcResponse } from './types.js'
import { runWithRpcExecutionOverrides, type RpcExecutionOverrides } from './rpc-context.js'

function safePostRpcResponse(hostPort: MessagePort, response: RpcResponse): void {
    try {
        hostPort.postMessage(response)
    } catch (postErr) {
        const fallbackMsg = postErr instanceof Error ? postErr.message : String(postErr)
        try {
            hostPort.postMessage({
                id: response.id,
                error: `RPC response serialization failed: ${fallbackMsg}`,
            } satisfies RpcResponse)
        } catch {
            // Host port already closed/terminated; swallow to avoid unhandled rejection on host thread.
        }
    }
}

function resolveRpcTarget(req: RpcRequest, apiBindings: Record<string, unknown>): unknown {
    if (req.group === '_topLevel') {
        return Object.hasOwn(apiBindings, req.method) ? apiBindings[req.method] : undefined
    }
    if (!Object.hasOwn(apiBindings, req.group)) return undefined
    const groupApi = apiBindings[req.group]
    if (groupApi === undefined || groupApi === null || typeof groupApi !== 'object') {
        return undefined
    }
    return Object.hasOwn(groupApi, req.method)
        ? (Reflect.get(groupApi, req.method) as unknown)
        : undefined
}

function buildRpcOverrides(req: RpcRequest): RpcExecutionOverrides | undefined {
    const overrides: RpcExecutionOverrides = {}
    let hasOverride = false
    if (req.readonly === true) {
        overrides.readonly = true
        hasOverride = true
    }
    if (req.dryRun === true) {
        overrides.dryRun = true
        hasOverride = true
    }
    if (req.useTestDb === true) {
        overrides.useTestDb = true
        hasOverride = true
    }
    if (
        typeof req.workspaceId === 'string' &&
        req.workspaceId.trim() !== '' &&
        req.workspaceId.trim() !== '*'
    ) {
        overrides.workspaceId = req.workspaceId.trim()
        hasOverride = true
    }
    if (
        typeof req.projectNumber === 'number' &&
        Number.isInteger(req.projectNumber) &&
        req.projectNumber > 0
    ) {
        overrides.projectNumber = req.projectNumber
        hasOverride = true
    }
    return hasOverride ? overrides : undefined
}

export async function handleRpcRequest(
    req: RpcRequest,
    apiBindings: Record<string, unknown>,
    hostPort: MessagePort,
    methodList: Record<string, string[]>
): Promise<void> {
    if (typeof req !== 'object' || req === null || typeof req.id !== 'number') {
        return
    }
    const response: RpcResponse = { id: req.id }

    try {
        if (typeof req.group !== 'string' || typeof req.method !== 'string') {
            response.error = 'Malformed RPC request: group and method must be strings'
            safePostRpcResponse(hostPort, response)
            return
        }

        const allowedMethods = Object.hasOwn(methodList, req.group)
            ? methodList[req.group]
            : undefined
        if (!allowedMethods?.includes(req.method)) {
            response.error = `Unauthorized method invocation: ${req.group}.${req.method}`
            safePostRpcResponse(hostPort, response)
            return
        }

        const safeArgs = Array.isArray(req.args) ? req.args : []
        const target = resolveRpcTarget(req, apiBindings)

        if (typeof target === 'function') {
            const callFn = (): Promise<unknown> =>
                (target as (...args: unknown[]) => Promise<unknown>)(...safeArgs)
            const overrides = buildRpcOverrides(req)
            response.result =
                overrides !== undefined
                    ? await runWithRpcExecutionOverrides(overrides, callFn)
                    : await callFn()
        } else {
            response.error = `Unknown method: ${req.group}.${req.method}`
        }
    } catch (err) {
        response.error = err instanceof Error ? err.message : String(err)
    }

    safePostRpcResponse(hostPort, response)
}
