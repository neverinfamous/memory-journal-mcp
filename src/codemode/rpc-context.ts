/**
 * Request-scoped AsyncLocalStorage context for Code Mode RPC execution overrides.
 * Propagates readonly/dryRun constraints from nested mj.executeCode() calls across RPC boundaries.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RpcExecutionOverrides {
    readonly?: boolean
    dryRun?: boolean
    useTestDb?: boolean
    workspaceId?: string
    projectNumber?: number
    sessionId?: string
    autoVersion?: boolean
}

const rpcOverridesStorage = new AsyncLocalStorage<RpcExecutionOverrides>()

/**
 * Execute an asynchronous callback with merged RPC execution overrides.
 * Nested calls tighten permissions and scope monotonically (once readonly/dryRun/useTestDb or a concrete workspace/project is active, it cannot be widened).
 */
export function runWithRpcExecutionOverrides<T>(
    overrides: RpcExecutionOverrides,
    fn: () => Promise<T>
): Promise<T> {
    const parent = rpcOverridesStorage.getStore()
    const merged: RpcExecutionOverrides = {}
    if (parent?.readonly === true || overrides.readonly === true) {
        merged.readonly = true
    }
    if (parent?.dryRun === true || overrides.dryRun === true) {
        merged.dryRun = true
    }
    if (parent?.useTestDb === true || overrides.useTestDb === true) {
        merged.useTestDb = true
    }
    if (parent?.autoVersion === false || overrides.autoVersion === false) {
        merged.autoVersion = false
    } else if (overrides.autoVersion === true) {
        merged.autoVersion = true
    }
    const parentSess = parent?.sessionId?.trim()
    const nextSess = overrides.sessionId?.trim()
    if (parentSess !== undefined && parentSess !== '') {
        merged.sessionId = parentSess
    } else if (nextSess !== undefined && nextSess !== '') {
        merged.sessionId = nextSess
    }
    const parentWs = parent?.workspaceId?.trim()
    const nextWs = overrides.workspaceId?.trim()
    if (parentWs !== undefined && parentWs !== '' && parentWs !== '*') {
        merged.workspaceId = parentWs
    } else if (nextWs !== undefined && nextWs !== '' && nextWs !== '*') {
        merged.workspaceId = nextWs
    } else if (parentWs === '*') {
        merged.workspaceId = '*'
    }
    if (parent?.projectNumber !== undefined) {
        merged.projectNumber = parent.projectNumber
    } else if (
        typeof overrides.projectNumber === 'number' &&
        Number.isSafeInteger(overrides.projectNumber) &&
        overrides.projectNumber > 0
    ) {
        merged.projectNumber = overrides.projectNumber
    }
    return rpcOverridesStorage.run(merged, fn)
}

/**
 * Retrieve the active Code Mode RPC execution overrides for the current async execution chain.
 */
export function getRpcExecutionOverrides(): RpcExecutionOverrides | undefined {
    return rpcOverridesStorage.getStore()
}
