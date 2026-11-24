/**
 * Main-thread RPC handler for Code Mode worker sandboxes (split out of worker-sandbox.ts).
 */

import type { MessagePort } from 'node:worker_threads'
import type { RpcRequest, RpcResponse } from './types.js'
import { runWithRpcExecutionOverrides, type RpcExecutionOverrides } from './rpc-context.js'
import {
    markValidatedToolInput,
    exceedsMaxToolInputElements,
    resolveEffectiveMaxToolInputElements,
} from '../utils/tool-input-bounds.js'
import { createNullProtoRecord } from '../utils/type-guards.js'
import { sanitizeErrorForLogging } from '../utils/security-utils.js'
import { isCallable } from './worker/result-proxy-aliases.js'

function safePostRpcResponse(hostPort: MessagePort, response: RpcResponse): void {
    try {
        hostPort.postMessage(response)
    } catch (postErr) {
        const fallbackMsg = sanitizeErrorForLogging(
            postErr instanceof Error ? postErr.message : String(postErr)
        )
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
        Number.isSafeInteger(req.projectNumber) &&
        req.projectNumber > 0
    ) {
        overrides.projectNumber = req.projectNumber
        hasOverride = true
    }
    if (typeof req.sessionId === 'string' && req.sessionId.trim() !== '') {
        overrides.sessionId = req.sessionId.trim()
        hasOverride = true
    }
    if (typeof req.autoVersion === 'boolean') {
        overrides.autoVersion = req.autoVersion
        hasOverride = true
    }
    return hasOverride ? overrides : undefined
}

export interface CachedAllowedMethods {
    methodList: Record<string, string[]>
    methodListKey: string
    methodSets: Record<string, ReadonlySet<string>>
}

const ALLOWED_METHODS_CACHE = new WeakMap<Record<string, unknown>, CachedAllowedMethods>()

export function getAllowedMethodMetadata(apiBindings: Record<string, unknown>): CachedAllowedMethods {
    const cached = ALLOWED_METHODS_CACHE.get(apiBindings)
    if (cached !== undefined) return cached
    const methodList: Record<string, string[]> = {}
    const methodSets = createNullProtoRecord<ReadonlySet<string>>()
    const topLevel: string[] = []
    for (const [key, value] of Object.entries(apiBindings)) {
        if (typeof value === 'function') {
            topLevel.push(key)
        } else if (typeof value === 'object' && value !== null) {
            const methods: string[] = []
            for (const [methodName, methodValue] of Object.entries(value)) {
                if (typeof methodValue === 'function') methods.push(methodName)
            }
            if (methods.length > 0) {
                methodList[key] = methods
                methodSets[key] = new Set(methods)
            }
        }
    }
    if (topLevel.length > 0) {
        methodList['_topLevel'] = topLevel
        methodSets['_topLevel'] = new Set(topLevel)
    }
    const entry: CachedAllowedMethods = {
        methodList,
        methodListKey: JSON.stringify(methodList),
        methodSets,
    }
    ALLOWED_METHODS_CACHE.set(apiBindings, entry)
    return entry
}

export async function handleRpcRequest(
    req: RpcRequest,
    apiBindings: Record<string, unknown>,
    hostPort: MessagePort,
    methodList: Record<string, string[] | ReadonlySet<string>>,
    configuredMaxToolInputElements?: number
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
        const isAllowed =
            allowedMethods === undefined
                ? false
                : Array.isArray(allowedMethods)
                  ? allowedMethods.includes(req.method)
                  : allowedMethods.has(req.method)
        if (!isAllowed) {
            response.error = `Unauthorized method invocation: ${req.group}.${req.method}`
            safePostRpcResponse(hostPort, response)
            return
        }

        const safeArgs = Array.isArray(req.args) ? req.args : []
        if (safeArgs.length > 0) {
            const maxElements = resolveEffectiveMaxToolInputElements(configuredMaxToolInputElements)
            if (exceedsMaxToolInputElements(safeArgs, maxElements)) {
                response.result = {
                    success: false,
                    error: `Tool input exceeds maximum of ${String(maxElements)} elements.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: false,
                }
                safePostRpcResponse(hostPort, response)
                return
            }
            if (safeArgs.length === 1 && safeArgs[0] !== null && typeof safeArgs[0] === 'object') {
                markValidatedToolInput(safeArgs[0], maxElements)
            }
        }
        const target = resolveRpcTarget(req, apiBindings)

        if (isCallable(target)) {
            const callFn = (): Promise<unknown> => Promise.resolve(target(...safeArgs))
            const overrides = buildRpcOverrides(req)
            response.result =
                overrides !== undefined
                    ? await runWithRpcExecutionOverrides(overrides, callFn)
                    : await callFn()
        } else {
            response.error = `Unknown method: ${req.group}.${req.method}`
        }
    } catch (err) {
        response.error = sanitizeErrorForLogging(err instanceof Error ? err.message : String(err))
    }

    safePostRpcResponse(hostPort, response)
}
