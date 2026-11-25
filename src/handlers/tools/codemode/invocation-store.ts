/**
 * Request-scoped AsyncLocalStorage store holding active Code Mode invocation state.
 * Host-only: must never be imported from worker-side Code Mode modules.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { ToolContext, ProjectRegistryEntry } from '../../../types/index.js'

export interface CodemodeInvocationState {
    sessionContext: ToolContext
    projectId: number | string | undefined
    workspaceId: string | undefined
    explicitWorkspace?: boolean | undefined
    sessionId?: string | undefined
    autoVersion: boolean
    dryRun: boolean
    projectRegistry?: Record<string, ProjectRegistryEntry> | undefined
    onMutatingDispatch?: (() => void) | undefined
}

const codemodeInvocationStorage = new AsyncLocalStorage<CodemodeInvocationState>()

/**
 * Execute `fn` with the active Code Mode invocation state bound via AsyncLocalStorage.
 */
export function runWithCodemodeInvocation<T>(
    state: CodemodeInvocationState,
    fn: () => Promise<T>
): Promise<T> {
    return codemodeInvocationStorage.run(state, fn)
}

/**
 * Retrieve the active Code Mode invocation state for the current async execution chain.
 */
export function getCodemodeInvocationState(): CodemodeInvocationState | undefined {
    return codemodeInvocationStorage.getStore()
}
