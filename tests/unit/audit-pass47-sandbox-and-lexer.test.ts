/**
 * Pass 47 Adversarial Security Regression Suite — Part 1:
 * Post-Close Timer Latches, Lexer Regex/Division Alignment, Cross-Realm Wasm/Atomics/Intl
 * Hardening, Getter-TOCTOU Snapshot, and Sandbox Handler Bounds (H1, M1–M3, L1–L4).
 */

import * as vm from 'node:vm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import {
    buildSandboxGlobals,
    type ExecutionLifecycleState,
} from '../../src/codemode/worker/sandbox-globals.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { createChildProcessShims } from '../../src/codemode/worker/sandbox-process-shims.js'
import { freezeInnerVmContext } from '../../src/codemode/worker/prototype-hardening.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { stripCommentsAndStrings } from '../../src/codemode/security-stripper.js'
import { validateSandboxCode } from '../../src/codemode/security.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { resolveEffectiveRpcScope } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { setActiveProjectRegistry } from '../../src/codemode/normalizers/project-alias-helpers.js'

const origEncryptionKey = process.env['DB_ENCRYPTION_KEY']
const origMjEncryptionKey = process.env['MJ_DB_ENCRYPTION_KEY']

beforeEach(() => {
    process.env['DB_ENCRYPTION_KEY'] = ''
    process.env['MJ_DB_ENCRYPTION_KEY'] = ''
})

afterEach(() => {
    vi.restoreAllMocks()
    setActiveProjectRegistry(undefined)
    if (origEncryptionKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
    else process.env['DB_ENCRYPTION_KEY'] = origEncryptionKey
    if (origMjEncryptionKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
    else process.env['MJ_DB_ENCRYPTION_KEY'] = origMjEncryptionKey
})

describe('Pass 47 Security Audit — Sandbox Lifecycle, Lexer & Bounds', () => {
    it('H1: latches sandbox timers on execution end and evicts workers with post-close activity', async () => {
        const lifecycle: ExecutionLifecycleState = { ended: false, postCloseActivity: false }
        const globals = buildSandboxGlobals({
            mjApi: {},
            shimMj: {},
            safeFsShim: createSafeFsShim(),
            frozenContext: Object.freeze({}),
            executeCodeFn: () => Promise.resolve({ success: true }),
            updateMemoryFn: () => undefined,
            activeTimers: new Set<NodeJS.Timeout>(),
            executionLifecycle: lifecycle,
        })
        const setTimeoutFn = globals['setTimeout'] as (cb: () => void, ms: number) => number
        let lateFired = false
        lifecycle.ended = true
        const timerId = setTimeoutFn(() => {
            lateFired = true
        }, 0)
        expect(timerId).toBe(0)
        expect(lifecycle.postCloseActivity).toBe(true)
        await new Promise<void>((r) => setTimeout(r, 25))
        expect(lateFired).toBe(false)

        const sandbox = new WorkerSandbox({ timeoutMs: 3000, memoryLimitMb: 64 })
        try {
            const res = await sandbox.execute(
                'return { toJSON() { Promise.resolve().then(() => { setTimeout(() => {}, 0); }); return { ok: true }; } };',
                {},
                undefined,
                3000
            )
            expect(res.success).toBe(true)
            expect(sandbox.isDisposed).toBe(true)
        } finally {
            sandbox.dispose()
        }
    })

    it('M1: aligns regex vs division across private fields, switch-only default, class-field fn expr, nested case objects, and keyword-of', () => {
        // 1) Private field after member access is an expression operand so `/` is division, never regex-start
        const privField = 'const x = obj.#return /eval("bad")/g;'
        const optPrivField = 'const x = obj?.#return /eval("bad")/g;'
        expect(validateSandboxCode(privField).valid).toBe(false)
        expect(validateSandboxCode(optPrivField).valid).toBe(false)
        expect(validateSandboxCode('const x = o.#of /process.exit()/g;').valid).toBe(false)

        // 2) Object literal `default:` outside switch should not force regex-start for `/`
        expect(
            validateSandboxCode('const o = { default: 1 / eval("x") / 2 };').valid
        ).toBe(false)
        // Positive switch default case still parses regex safely
        expect(stripCommentsAndStrings('switch (0) { default: /eval/.test("x"); }')).not.toContain(
            'eval'
        )

        // 3) Class-field function expression vs class method regex start
        expect(
            validateSandboxCode('class C { f = function() {} / eval("x") / 2 }').valid
        ).toBe(false)
        expect(stripCommentsAndStrings('class C { m() {} /eval/g }')).not.toContain('eval')

        // 4) Nested object literal inside switch `case` test expression
        expect(
            stripCommentsAndStrings('switch (x) { case ({ a: 1 }): /eval/g; break; }')
        ).not.toContain('eval')

        // 5) Expression-keyword preceding `of` (`return of /.../g` is division, not `for-of`)
        expect(validateSandboxCode('function f() { return of / eval("x") / 2; }').valid).toBe(
            false
        )
    })

    it('M2: blocks WebAssembly/Atomics globals and freezes Intl/Temporal namespace sub-constructors', async () => {
        const ctx = vm.createContext({
            Intl,
            ...(typeof Temporal !== 'undefined' ? { Temporal } : {}),
        })
        freezeInnerVmContext(ctx)
        const intlFrozen = Boolean(
            vm.runInContext(
                'Object.isFrozen(Intl) && Object.isFrozen(Intl.Segmenter) && Object.isFrozen(Object.getPrototypeOf(new Intl.Segmenter().segment("a")[Symbol.iterator]()))',
                ctx
            )
        )
        expect(intlFrozen).toBe(true)

        const sandbox = new WorkerSandbox({ timeoutMs: 3000, memoryLimitMb: 64 })
        try {
            const res = await sandbox.execute(
                'return { hasWasm: typeof WebAssembly, hasAtomics: typeof Atomics, segFrozen: Object.isFrozen(Object.getPrototypeOf(new Intl.Segmenter().segment("a")[Symbol.iterator]())) };',
                {},
                undefined,
                3000
            )
            expect(res.success).toBe(true)
            expect(res.result).toEqual({
                hasWasm: 'undefined',
                hasAtomics: 'undefined',
                segFrozen: true,
            })
        } finally {
            sandbox.dispose()
        }
    })

    it('M3: snapshots untrusted nested executeCode argument objects once against getter TOCTOU', async () => {
        let reads = 0
        const maliciousArg: Record<string, unknown> = {}
        Object.defineProperty(maliciousArg, 'code', {
            enumerable: true,
            get() {
                reads++
                return reads === 1 ? 'return 1;' : 'return process.env;'
            },
        })
        const nestedCtx = vm.createContext({})
        const executor = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: nestedCtx },
            timeoutMs: 1000,
            maxResultSize: 1024,
            readonlyMode: true,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'ws-m3',
            pinnedProjectRaw: 1,
            projectRegistryRaw: undefined,
            runIsolatedNestedCode: (wrapped) =>
                Promise.resolve(vm.runInContext(wrapped, nestedCtx)),
            activeTimers: new Set<NodeJS.Timeout>(),
        })
        const result = (await executor(maliciousArg)) as { success?: boolean }
        expect(reads).toBe(1)
        expect(result).toBe(1)
    })

    it('L1/L2/L3/L4: excludes update_configuration without filterConfig, pre-scans mj_* healer aliases, sanitizes spawn stderr, and rejects conflicting projectId', async () => {
        // L1: filterToolsForSandbox excludes update_configuration even when filterConfig is undefined
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            const codeModeTool = getCodeModeTools({
                db,
                runtime,
                config: {
                    codemodeEnabled: true,
                    codemodeInternalFullAccess: false,
                    filterConfig: null,
                    projectRegistry: {},
                },
            })[0]
            expect(codeModeTool).toBeDefined()
            const checkRes = (await codeModeTool?.handler({
                code: 'const updateRes = await mj.admin.updateConfiguration({}); const rootRes = typeof update_configuration === "function" ? await update_configuration({}) : { success: false }; return { updateSuccess: updateRes.success, rootSuccess: rootRes.success };',
            })) as { success: boolean; result?: unknown }
            expect(checkRes.success).toBe(true)
            expect(checkRes.result).toEqual({
                updateSuccess: false,
                rootSuccess: false,
            })
        } finally {
            db.close()
        }

        // L2: code-healer candidate cap includes mj_* calls when > 16 candidates exist
        const manyAliasCalls = Array.from(
            { length: 20 },
            (_, i) => `await mj_create_entry({ content: "item ${String(i)} ` + '`x`' + `" });`
        ).join('\n')
        const untouched = healCodeModeScript(`${manyAliasCalls}\nconst broken = (`)
        expect(untouched.trimEnd()).toBe(`${manyAliasCalls}\nconst broken = (`)

        // L3: spawn/exec callback error stderr is stripped of control characters and capped
        const stderrChunks: string[] = []
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
            stderrChunks.push(String(chunk))
            return true
        })
        const procShims = createChildProcessShims()
        const execFn = procShims['exec'] as (cmd: string, cb: () => void) => void
        execFn('echo test', () => {
            throw new Error(`boom\x1b[31m\u2028secret\n${'x'.repeat(700)}`)
        })
        expect(writeSpy).toHaveBeenCalledTimes(1)
        const logged = stderrChunks.join('')
        expect(logged).not.toContain('\x1b')
        expect(logged).not.toContain('\u2028')
        expect(logged.length).toBeLessThanOrEqual(580)

        // L4: numeric projectId mismatch fails even when outer Workspace is wildcard/undefined
        const rpcConflict = resolveEffectiveRpcScope(
            { workspaceId: '*', projectId: 5 },
            { projectNumber: 9 },
            undefined
        )
        expect('errorResult' in rpcConflict).toBe(true)
    })
})
