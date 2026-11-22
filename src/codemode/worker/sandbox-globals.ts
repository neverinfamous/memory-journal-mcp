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

export interface ExecutionLifecycleState {
    ended: boolean
    postCloseActivity: boolean
}

export interface BuildSandboxGlobalsOptions {
    mjApi: Record<string, unknown>
    shimMj: Record<string, unknown>
    safeFsShim: SafeFsShim
    frozenContext: Record<string, unknown>
    executeCodeFn: (...args: unknown[]) => Promise<unknown>
    updateMemoryFn: (...args: unknown[]) => unknown
    activeTimers?: Set<NodeJS.Timeout>
    executionLifecycle?: ExecutionLifecycleState
}

function createSafeTimerHelpers(
    activeTimers?: Set<NodeJS.Timeout>,
    executionLifecycle?: ExecutionLifecycleState
): {
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
        if (executionLifecycle?.ended === true) {
            executionLifecycle.postCloseActivity = true
            return 0
        }
        const id = nextTimerId++
        const delay = Number.isFinite(ms) ? Math.min(Math.max(0, ms), 30_000) : 0
        const handle = setTimeout(
            (...cbArgs: unknown[]) => {
                timerMap.delete(id)
                activeTimers?.delete(handle)
                if (executionLifecycle?.ended === true) {
                    executionLifecycle.postCloseActivity = true
                    return
                }
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

function isAllowedTeamGlobal(name: string): boolean {
    return name.startsWith('team_') || /^team[A-Z]/.test(name)
}

function exposeApiMethodsOnSandbox(
    sandbox: Record<string, unknown>,
    mjApi: Record<string, unknown>
): void {
    for (const key of Object.keys(mjApi)) {
        const val = mjApi[key]
        if ((val === null || typeof val !== 'object') && typeof val !== 'function') continue
        const isTeamGroup = key === 'team'
        const lazyNames = Reflect.get(val, LAZY_GROUP_METHOD_NAMES) as unknown
        if (Array.isArray(lazyNames)) {
            for (const groupMethod of lazyNames) {
                if (typeof groupMethod !== 'string' || groupMethod in sandbox) continue
                if (isTeamGroup && !isAllowedTeamGlobal(groupMethod)) continue
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
                if (isTeamGroup && !isAllowedTeamGlobal(groupMethod)) continue
                const fn = Reflect.get(val, groupMethod) as unknown
                if (typeof fn === 'function') sandbox[groupMethod] = fn
            }
        }
        if (typeof val === 'function' && !(key in sandbox)) sandbox[key] = val
    }
}

function createReadonlyMirrorProxy(target: Record<string, unknown>): Record<string, unknown> {
    return new Proxy(
        {},
        {
            isExtensible: (): boolean => true,
            preventExtensions: (): boolean => false,
            get: (): unknown => target,
            set: (): boolean => false,
            defineProperty: (): boolean => false,
            deleteProperty: (): boolean => false,
            setPrototypeOf: (): boolean => false,
        }
    )
}

function createBlockedAndTimerGlobals(
    activeTimers?: Set<NodeJS.Timeout>,
    executionLifecycle?: ExecutionLifecycleState
): Record<string, unknown> {
    const { createSafeTimeout, clearSafeTimeout } = createSafeTimerHelpers(
        activeTimers,
        executionLifecycle
    )
    return {
        fetch: createFetchShim(),
        sleep: (ms: number) =>
            new Promise((resolve) => {
                createSafeTimeout(() => resolve(undefined), ms)
            }),
        setTimeout: createSafeTimeout,
        clearTimeout: clearSafeTimeout,
        setInterval: undefined,
        setImmediate: undefined,
        process: createSandboxProcessObject(),
        require: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        Proxy: undefined,
        Reflect: undefined,
        SharedArrayBuffer: undefined,
        Atomics: undefined,
        WebAssembly: undefined,
        FinalizationRegistry: undefined,
        WeakRef: undefined,
    }
}

/**
 * Builds and freezes the sandbox global object for `vm.createContext`.
 */
export function buildSandboxGlobals(
    options: BuildSandboxGlobalsOptions
): Record<string, unknown> {
    const {
        mjApi,
        shimMj,
        safeFsShim,
        frozenContext,
        executeCodeFn,
        updateMemoryFn,
        activeTimers,
        executionLifecycle,
    } = options
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
        services: createReadonlyMirrorProxy(shimMj),
        kernel: createReadonlyMirrorProxy(shimMj),
        path: frozenPathShim,
        __path: frozenPathShim,
        prepare: (sql?: string) =>
            createPreparedStatementShim(typeof sql === 'string' ? sql : '', shimMj),
        context: frozenContext,
        ctx: frozenContext,
        console: frozenConsoleShim,
        getConfig:
            typeof shimMj['getConfig'] === 'function'
                ? (): Promise<unknown> =>
                      Promise.resolve((shimMj['getConfig'] as () => unknown)())
                : (): Promise<unknown> => Promise.resolve({ dbPath: 'memory://internal' }),
        globalThis: shimMj,
        ...createBlockedAndTimerGlobals(activeTimers, executionLifecycle),
    }

    exposeApiMethodsOnSandbox(sandbox, mjApi)
    return Object.freeze(sandbox)
}
