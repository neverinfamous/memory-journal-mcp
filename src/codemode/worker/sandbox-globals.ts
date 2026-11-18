/**
 * Worker Sandbox Globals — builds the frozen `sandbox` object exposed to
 * `vm.createContext` with all top-level aliases, delegating wrappers, and shims.
 */

import { type SafeFsShim, pathShim, consoleShim, createPreparedStatementShim } from './node-shims.js'
import { LAZY_GROUP_METHOD_NAMES } from '../worker-api-proxy.js'
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

function createSafeTimerHelpers(activeTimers?: Set<NodeJS.Timeout>): {
    createSafeTimeout: (cb: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => number
    clearSafeTimeout: (id: unknown) => void
} {
    const timerMap = new Map<number, NodeJS.Timeout>()
    let nextTimerId = 1
    const createSafeTimeout = (
        cb: (...args: unknown[]) => void,
        ms: number,
        ...args: unknown[]
    ): number => {
        const id = nextTimerId++
        const delay = Number.isFinite(ms) ? Math.min(Math.max(0, ms), 30_000) : 0
        const handle = setTimeout(
            (...cbArgs: unknown[]) => {
                timerMap.delete(id)
                activeTimers?.delete(handle)
                cb(...cbArgs)
            },
            delay,
            ...args
        )
        activeTimers?.add(handle)
        timerMap.set(id, handle)
        return id
    }
    const clearSafeTimeout = (id: unknown): void => {
        if (typeof id !== 'number') return
        const handle = timerMap.get(id)
        if (handle !== undefined) {
            clearTimeout(handle)
            timerMap.delete(id)
            activeTimers?.delete(handle)
        }
    }
    return { createSafeTimeout, clearSafeTimeout }
}

function exposeApiMethodsOnSandbox(
    sandbox: Record<string, unknown>,
    mjApi: Record<string, unknown>
): void {
    for (const key of Object.keys(mjApi)) {
        const val = mjApi[key]
        if ((val === null || typeof val !== 'object') && typeof val !== 'function') continue
        const lazyNames = Reflect.get(val, LAZY_GROUP_METHOD_NAMES) as unknown
        if (Array.isArray(lazyNames)) {
            for (const groupMethod of lazyNames) {
                if (typeof groupMethod !== 'string' || groupMethod in sandbox) continue
                let resolved: unknown
                let hasResolved = false
                Object.defineProperty(sandbox, groupMethod, {
                    enumerable: true,
                    configurable: true,
                    get(): unknown {
                        if (!hasResolved) {
                            resolved = Reflect.get(val, groupMethod)
                            hasResolved = true
                        }
                        return resolved
                    },
                })
            }
        } else {
            for (const groupMethod of Object.keys(val)) {
                if (groupMethod in sandbox) continue
                const fn = Reflect.get(val, groupMethod) as unknown
                if (typeof fn === 'function') sandbox[groupMethod] = fn
            }
        }
        if (typeof val === 'function' && !(key in sandbox)) sandbox[key] = val
    }
}

/**
 * Builds and freezes the sandbox global object for `vm.createContext`.
 */
export function buildSandboxGlobals(
    options: BuildSandboxGlobalsOptions
): Record<string, unknown> {
    const { mjApi, shimMj, safeFsShim, frozenContext, executeCodeFn, updateMemoryFn, activeTimers } = options
    const { createSafeTimeout, clearSafeTimeout } = createSafeTimerHelpers(activeTimers)
    const servicesProxy = new Proxy({}, { get: (): unknown => shimMj })
    const kernelProxy = new Proxy({}, { get: (): unknown => shimMj })
    const frozenPathShim = Object.freeze({ ...pathShim })
    const frozenConsoleShim = Object.freeze({ ...consoleShim })

    const sandbox: Record<string, unknown> = {
        ...buildMemoryAndFactoryShims(shimMj, safeFsShim, updateMemoryFn),
        ...createChildProcessShims(),
        ...(shimMj['help'] !== undefined || mjApi['help'] !== undefined
            ? { help: shimMj['help'] ?? mjApi['help'] }
            : {}),
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
        path: frozenPathShim,
        __path: frozenPathShim,
        prepare: (sql?: string) =>
            createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj),
        context: frozenContext,
        console: frozenConsoleShim,
        fetch: createFetchShim(),
        sleep: (ms: number) =>
            new Promise((resolve) => {
                createSafeTimeout(() => resolve(undefined), ms)
            }),
        setTimeout: createSafeTimeout,
        clearTimeout: clearSafeTimeout,
        setInterval: undefined,
        setImmediate: undefined,
        getConfig:
            typeof shimMj['getConfig'] === 'function'
                ? (): Promise<unknown> =>
                      Promise.resolve((shimMj['getConfig'] as () => unknown)())
                : (): Promise<unknown> => Promise.resolve({ dbPath: 'memory://internal' }),
        process: createSandboxProcessObject(),
        require: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        globalThis: shimMj,
        Proxy: undefined,
        Reflect: undefined,
    }

    exposeApiMethodsOnSandbox(sandbox, mjApi)
    return Object.freeze(sandbox)
}
