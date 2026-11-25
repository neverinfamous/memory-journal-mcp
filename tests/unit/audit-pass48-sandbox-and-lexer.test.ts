import * as vm from 'node:vm'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { validateSandboxCode, stripCommentsAndStrings } from '../../src/codemode/security.js'
import { hasUnbalancedClosingDelimiter } from '../../src/codemode/security-stripper-delimiters.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { rewriteContextJsonParseCalls } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { pathShim } from '../../src/codemode/worker/node-shims.js'
import { freezeInnerVmContext } from '../../src/codemode/worker/prototype-hardening.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { extractNestedMaxResultSize } from '../../src/codemode/worker/nested-exec-payload.js'
import {
    createSchemaProxy,
    createProjectsProxy,
    createTagsProxy,
    createSystemProxy,
    createContextNamespaceProxy,
} from '../../src/codemode/proxy-namespaces.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import { validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import type { ToolDefinition } from '../../src/types/index.js'

describe('Audit Pass 48 — Lexer, Auto-Return & Rewriter Hardening (H3, H4, L6)', () => {
    it('does not reset class pending state on method name `of()` or `=`/`, ` pending classes (H3)', () => {
        const classWithOf = 'class C { of() { return 1 } }\nconst r = process.exit()'
        const res1 = validateSandboxCode(classWithOf)
        expect(res1.valid).toBe(false)

        const classAssigned = 'const A = class { m() {} }, B = class { n() {} };\nprocess.exit()'
        const res2 = validateSandboxCode(classAssigned)
        expect(res2.valid).toBe(false)

        const forOfRegex = 'for (const x of arr) {}\nconst m = /hello/i.test("hello")'
        expect(validateSandboxCode(forOfRegex).valid).toBe(true)
    })

    it('distinguishes division from regex after closing parens/braces using stmtInterior (H4)', () => {
        const stmtHeaderRegex = 'if ({ a: 1 }) /abc/.test("abc")'
        const strippedStmt = stripCommentsAndStrings(stmtHeaderRegex)
        expect(strippedStmt).toContain('"')
        expect(validateSandboxCode(stmtHeaderRegex).valid).toBe(true)

        const divAfterParen = 'const x = (10) / 2; const y = "ok"; process.exit()'
        expect(validateSandboxCode(divAfterParen).valid).toBe(false)
    })

    it('detects unbalanced closing delimiters and preserves valid auto-return transforms (H3, L6)', () => {
        expect(hasUnbalancedClosingDelimiter(stripCommentsAndStrings('} catch {} process.exit()'))).toBe(true)
        expect(hasUnbalancedClosingDelimiter(stripCommentsAndStrings('(() => ({ a: 1 }))()'))).toBe(false)

        const transformed = transformAutoReturn('const a = 1;\nawait mj.core.getRecentEntries()')
        expect(transformed).toContain('return await mj.core.getRecentEntries()')
        expect(rewriteContextJsonParseCalls('const a = JSON.parse(context); const b = "JSON.parse(context)"')).toContain(
            '(typeof context === "string" ? JSON.parse(context) : context)'
        )
        expect(rewriteContextJsonParseCalls('const b = "JSON.parse(context)"')).toBe('const b = "JSON.parse(context)"')
    })
})

describe('Audit Pass 48 — Worker Sandbox Prototypes, Shims & Egress Bridge (H5, M11, M14, M15, L8)', () => {
    const sandbox = new WorkerSandbox({ timeoutMs: 15000 })

    afterAll(() => {
        sandbox.dispose()
    })

    it('coerces non-string pathShim extensions safely and freezes worker error & Intl prototypes (H5, M14)', async () => {
        expect(pathShim.basename('dir/file.txt', 123)).toBe('file.txt')
        expect(() => pathShim.join(null, 'sub')).not.toThrow()

        const probeCode = `
            let urlProtoFrozen = false;
            let urlCtorProto = null;
            try {
                new URL('invalid://[');
            } catch (err) {
                const proto = Object.getPrototypeOf(err);
                urlProtoFrozen = Object.isFrozen(proto);
                urlCtorProto = typeof proto.constructor;
            }
            let bufFrozen = false;
            try {
                Buffer.alloc(1).writeInt8(0, 99);
            } catch (err) {
                bufFrozen = Object.isFrozen(Object.getPrototypeOf(err));
            }
            const segFrozen = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
                ? Object.isFrozen(Object.getPrototypeOf(new Intl.Segmenter().segment('ab')))
                : true;
            return {
                urlProtoFrozen,
                urlCtorProto,
                bufFrozen,
                segFrozen,
                weakRefType: typeof WeakRef,
            };
        `
        const res = await sandbox.execute(probeCode, {})
        expect(res.success).toBe(true)
        const val = res.result as Record<string, unknown>
        expect(val['urlProtoFrozen']).toBe(true)
        expect(val['bufFrozen']).toBe(true)
        expect(val['segFrozen']).toBe(true)
        expect(val['weakRefType']).toBe('undefined')
    })

    it('closes the RPC bridge before result egress serialization and evicts tainted workers on post-close getter RPCs (M11)', async () => {
        const rpcSpy = vi.fn().mockResolvedValue({ leaked: true })
        const m11Sandbox = new WorkerSandbox({ timeoutMs: 3000 })
        const code = `
            return {
                get evil() {
                    Promise.resolve(mj.core.getRecentEntries()).catch(() => undefined);
                    return 'done';
                }
            };
        `
        try {
            const res = await m11Sandbox.execute(code, { core: { getRecentEntries: rpcSpy } })
            expect(res.success).toBe(true)
            expect(rpcSpy).not.toHaveBeenCalled()
            expect(m11Sandbox.isDisposed).toBe(true)
        } finally {
            m11Sandbox.dispose()
        }
    })

    it('sanitizes secret tokens in worker execution errors (L8)', async () => {
        const res = await sandbox.execute('throw new Error("auth failed Bearer sk-secret-token-abcdef123456")', {})
        expect(res.success).toBe(false)
        expect(res.error).toContain('[REDACTED]')
        expect(res.error).not.toContain('sk-secret-token-abcdef123456')
    })

    it('freezes SegmentsPrototype in inner VM and enforces immutable mirror & virtual namespace proxies (M14, M15)', () => {
        const ctx = vm.createContext({ Intl }, { codeGeneration: { strings: false, wasm: false } })
        freezeInnerVmContext(ctx)
        const segFrozen = vm.runInContext(
            'Object.isFrozen(Object.getPrototypeOf(new Intl.Segmenter().segment("hi")))',
            ctx
        ) as boolean
        expect(segFrozen).toBe(true)

        const globals = buildSandboxGlobals({
            mjApi: {},
            shimMj: { help: () => 'ok' },
            safeFsShim: {
                existsSync: () => false,
                statSync: () => ({ size: 0, isFile: () => false, isDirectory: () => false, mtime: new Date(), birthtime: new Date() }),
                stat: async () => ({}),
                lstatSync: () => ({ size: 0, isFile: () => false, isDirectory: () => false, mtime: new Date(), birthtime: new Date() }),
                readFileSync: () => '',
                readFile: async () => '',
                writeFileSync: () => undefined,
                writeFile: async () => undefined,
                mkdirSync: () => undefined,
                appendFileSync: () => undefined,
                unlinkSync: () => undefined,
                readdirSync: () => [],
                promises: {
                    stat: async () => ({ size: 0, isFile: () => false, isDirectory: () => false, mtime: new Date(), birthtime: new Date() }),
                    readFile: async () => '',
                    writeFile: async () => undefined,
                },
            },
            frozenContext: Object.freeze({}),
            executeCodeFn: async () => ({}),
            updateMemoryFn: () => ({}),
        })
        expect(globals['WeakRef']).toBeUndefined()
        const servicesProxy = globals['services'] as object
        expect(Reflect.set(servicesProxy, 'hijack', 1)).toBe(false)
        expect(Reflect.setPrototypeOf(servicesProxy, {})).toBe(false)

        const invokeRpc = async (): Promise<unknown> => ({ success: true })
        const proxies = [
            createSchemaProxy(invokeRpc),
            createProjectsProxy({ admin: ['list_projects'] }, invokeRpc),
            createTagsProxy({ core: ['list_tags'] }, invokeRpc),
            createSystemProxy({ analytics: ['get_statistics'] }, invokeRpc),
            createContextNamespaceProxy({ workspace_id: 'repo-a' }).contextProxy,
        ]
        for (const proxy of proxies) {
            expect(typeof proxy).toBe('function')
            expect('name' in proxy).toBe(true)
            expect('length' in proxy).toBe(true)
            expect(Reflect.set(proxy, 'tamper', 123)).toBe(false)
            expect(Reflect.deleteProperty(proxy, 'name')).toBe(false)
            expect(Reflect.setPrototypeOf(proxy, null)).toBe(false)
        }
    })
})

describe('Audit Pass 48 — Nested Exec Snapshot, Result Bounds & Alias Parity (M12, M13, L7, L9)', () => {
    it('snapshots nested args into null-prototype clones and rejects cyclic/getter tampering (M13)', async () => {
        const vmCtxRef: { current?: vm.Context } = {
            current: vm.createContext({ Object }, { codeGeneration: { strings: false, wasm: false } }),
        }
        const executor = createSandboxExecutor({
            shimMj: {},
            vmContextRef: vmCtxRef,
            timeoutMs: 1000,
            maxResultSize: undefined,
            readonlyMode: true,
            dryRunMode: false,
            pinnedWorkspaceRaw: 'repo-a',
            pinnedProjectRaw: 5,
            projectRegistryRaw: { 'repo-a': { project_number: 5, path: '/tmp/repo-a' } },
            runIsolatedNestedCode: async (wrapped) => wrapped,
        })

        let getterReads = 0
        const maliciousArg: Record<string, unknown> = { nested: { nestedProj: 5 } }
        Object.defineProperty(maliciousArg, 'code', {
            enumerable: true,
            get() {
                getterReads += 1
                return getterReads === 1 ? 'return 1' : 'process.exit()'
            },
        })
        const res = await executor(maliciousArg)
        expect(getterReads).toBe(1)
        expect(res).toBe(1)

        const cyclic: Record<string, unknown> = { code: 'return 1' }
        cyclic['self'] = cyclic
        const cyclicRes = (await executor(cyclic)) as Record<string, unknown>
        expect(cyclicRes['success']).toBe(false)
        expect(cyclicRes['code']).toBe('VALIDATION_ERROR')
    })

    it('clamps nested max_result_size to DEFAULT_NESTED_MAX_RESULT_SIZE when outer limit is unset (L7)', () => {
        expect(extractNestedMaxResultSize({ max_result_size: 9_000_000 }, undefined)).toBe(100 * 1024)
        expect(extractNestedMaxResultSize({ max_result_size: 50_000 }, 8_192)).toBe(8_192)
    })

    it('normalizes repository alias parity across executeCode, batch create, and RPC bounds (M12, L9)', () => {
        const schemaParsed = ExecuteCodeSchema.parse({ repository: 'neverinfamous/repo-a', query: 'audit' })
        expect(schemaParsed.repository).toBe('neverinfamous/repo-a')

        const aliasObj: Record<string, unknown> = { repository: 'neverinfamous/repo-a', query: 'audit' }
        normalizeExecuteCodeAliases(aliasObj)
        expect(aliasObj['repo']).toBe('neverinfamous/repo-a')
        expect(aliasObj['repository']).toBeUndefined()
        expect(aliasObj['code']).toBeUndefined()

        const intercepted = applyGenericInterceptions('batch_create_entries', [
            {
                workspace_id: 'repo-a',
                project_number: 5,
                entries: [
                    { content: 'same', repository: 'repo-a' },
                    { content: 'foreign', repository: 'repo-b' },
                ],
            },
        ])
        expect('args' in intercepted).toBe(true)
        if ('args' in intercepted) {
            const payload = intercepted.args[0] as { entries: Record<string, unknown>[] }
            expect(payload.entries[0]?.['project_number']).toBe(5)
            expect(payload.entries[1]?.['project_number']).toBeUndefined()
        }

        const dummyTool = { name: 'create_entry' } as ToolDefinition
        const conflict = validateRpcOverrideBounds(
            dummyTool,
            { repository: 'other-owner/repo-b' },
            { workspaceId: 'repo-a', projectNumber: 5 },
            {
                'repo-a': { project_number: 5, path: '/tmp/repo-a' },
                'repo-b': { project_number: 9, path: '/tmp/repo-b' },
            }
        )
        expect(conflict?.['code']).toBe('VALIDATION_ERROR')
    })
})
