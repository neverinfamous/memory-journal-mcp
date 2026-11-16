/**
 * Main-thread RPC handler for Code Mode worker sandboxes (split out of worker-sandbox.ts).
 */

import type { MessagePort } from 'node:worker_threads'
import type { RpcRequest, RpcResponse } from './types.js'
import { runWithRpcExecutionOverrides } from './rpc-context.js'

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
        let target: unknown
        if (req.group === '_topLevel') {
            target = Object.hasOwn(apiBindings, req.method) ? apiBindings[req.method] : undefined
        } else if (Object.hasOwn(apiBindings, req.group)) {
            const groupApi = apiBindings[req.group]
            if (groupApi !== undefined && groupApi !== null && typeof groupApi === 'object') {
                target = Object.hasOwn(groupApi, req.method)
                    ? (Reflect.get(groupApi, req.method) as unknown)
                    : undefined
            }
        }

        if (typeof target === 'function') {
            const callFn = (): Promise<unknown> =>
                (target as (...args: unknown[]) => Promise<unknown>)(...safeArgs)
            if (req.readonly === true || req.dryRun === true || req.useTestDb === true) {
                const overrides: { readonly?: boolean; dryRun?: boolean; useTestDb?: boolean } = {}
                if (req.readonly === true) overrides.readonly = true
                if (req.dryRun === true) overrides.dryRun = true
                if (req.useTestDb === true) overrides.useTestDb = true
                response.result = await runWithRpcExecutionOverrides(overrides, callFn)
            } else {
                response.result = await callFn()
            }
        } else {
            response.error = `Unknown method: ${req.group}.${req.method}`
        }
    } catch (err) {
        response.error = err instanceof Error ? err.message : String(err)
    }

    safePostRpcResponse(hostPort, response)
}
