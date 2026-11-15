/**
 * Request-scoped AsyncLocalStorage context for Code Mode RPC execution overrides.
 * Propagates readonly/dryRun constraints from nested mj.executeCode() calls across RPC boundaries.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RpcExecutionOverrides {
    readonly?: boolean
    dryRun?: boolean
}

const rpcOverridesStorage = new AsyncLocalStorage<RpcExecutionOverrides>()

/**
 * Execute an asynchronous callback with merged RPC execution overrides.
 * Nested calls tighten permissions monotonically (once readonly/dryRun is active, it stays active).
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
    return rpcOverridesStorage.run(merged, fn)
}

/**
 * Retrieve the active Code Mode RPC execution overrides for the current async execution chain.
 */
export function getRpcExecutionOverrides(): RpcExecutionOverrides | undefined {
    return rpcOverridesStorage.getStore()
}
