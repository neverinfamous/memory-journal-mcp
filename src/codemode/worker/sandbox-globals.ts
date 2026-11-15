/**
 * Worker Sandbox Globals — builds the frozen `sandbox` object exposed to
 * `vm.createContext` with all top-level aliases, delegating wrappers, and shims.
 */

import { type SafeFsShim, pathShim, consoleShim, createPreparedStatementShim } from './node-shims.js'
import {
    buildMemoryAndFactoryShims,
    createChildProcessShims,
    createFetchShim,
    createSandboxProcessObject,
} from './sandbox-process-shims.js'

export interface BuildSandboxGlobalsOptions {
    mjApi: Record<string, unknown>
    shimMj: Record<string, unknown>
    safeFsShim: SafeFsShim
    frozenContext: Record<string, unknown>
    executeCodeFn: (arg: unknown) => Promise<unknown>
    updateMemoryFn: (arg: unknown) => unknown
    activeTimers?: Set<NodeJS.Timeout>
}

/**
 * Builds and freezes the sandbox global object for `vm.createContext`.
 */
export function buildSandboxGlobals(
    options: BuildSandboxGlobalsOptions
): Record<string, unknown> {
    const { mjApi, shimMj, safeFsShim, frozenContext, executeCodeFn, updateMemoryFn, activeTimers } = options
    const registerTimer = (handle: NodeJS.Timeout): NodeJS.Timeout => {
        activeTimers?.add(handle)
        return handle
    }

    const servicesProxy = new Proxy({}, { get: (): unknown => shimMj })
    const kernelProxy = new Proxy({}, { get: (): unknown => shimMj })

    const sandbox: Record<string, unknown> = {
        ...buildMemoryAndFactoryShims(shimMj, safeFsShim, updateMemoryFn),
        ...createChildProcessShims(),
        mj: shimMj,
        mcp: shimMj,
        __mcp: shimMj,
        __mcp_server: shimMj,
        __mcp_client: shimMj,
        execute: executeCodeFn,
        mj_execute_code: executeCodeFn,
        execute_code: executeCodeFn,
        executeCode: executeCodeFn,
        mjExecuteCode: executeCodeFn,
        core: shimMj,
        journal: shimMj,
        _journal: shimMj,
        services: servicesProxy,
        kernel: kernelProxy,
        path: pathShim,
        __path: pathShim,
        prepare: (sql?: string) =>
            createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj),
        context: frozenContext,
        console: consoleShim,
        fetch: createFetchShim(),
        sleep: (ms: number) =>
            new Promise((resolve) => {
                registerTimer(setTimeout(resolve, Math.min(Math.max(0, ms), 30_000)))
            }),
        setTimeout: (cb: (...args: unknown[]) => void, ms: number, ...args: unknown[]) =>
            registerTimer(setTimeout(cb, Math.min(Math.max(0, ms), 30_000), ...args)),
        setInterval: undefined,
        setImmediate: undefined,
        getConfig: () => Promise.resolve({ dbPath: 'memory-journal.db' }),
        process: createSandboxProcessObject(),
        require: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        globalThis: shimMj,
        Proxy: undefined,
    }

    // Spread all callable methods from all groups into the sandbox as standalone globals
    for (const key of Object.keys(mjApi)) {
        const val = mjApi[key]
        if ((val !== null && typeof val === 'object') || typeof val === 'function') {
            for (const groupMethod of Object.keys(val)) {
                if (groupMethod in sandbox) continue
                const fn = Reflect.get(val, groupMethod) as unknown
                if (typeof fn === 'function') sandbox[groupMethod] = fn
            }
            if (typeof val === 'function' && !(key in sandbox)) sandbox[key] = val
        }
    }

    return Object.freeze(sandbox)
}
