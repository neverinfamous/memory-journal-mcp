import * as vm from 'node:vm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getCoreTools } from '../../src/handlers/tools/core/index.js'
import { getSearchTools } from '../../src/handlers/tools/search/index.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import {
    resolveEffectiveRpcScope,
    validateRpcOverrideBounds,
} from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { findWildcardProjectMismatches } from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { freezeInnerVmContext } from '../../src/codemode/worker/prototype-hardening.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { validateSandboxCode, stripCommentsAndStrings } from '../../src/codemode/security.js'
import { exceedsMaxToolInputElements } from '../../src/utils/tool-input-bounds.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { rewriteModuleImportsAndExports } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { resolveGithubHost } from '../../src/utils/github-helpers.js'
import type { ProjectRegistryEntry, ToolContext, ToolDefinition } from '../../src/types/index.js'

const TEST_REGISTRY: Record<string, ProjectRegistryEntry> = {
    'proj-alpha': { path: '/repos/proj-alpha', project_number: 5 },
    'proj-beta': { path: '/repos/proj-beta', project_number: 9 },
    'unnumbered-ws': { path: '/repos/unnumbered' },
}

function buildTestToolDefinitions(ctx: ToolContext): ToolDefinition[] {
    return [
        ...getCoreTools(ctx),
        ...getSearchTools(ctx),
        ...getAdminTools(ctx),
        ...getGitTools(ctx),
    ]
}

describe('Pass 43 Audit — Code Mode Sandbox, Scope Bounds, Lexer & ReDoS/DoS Caps', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let db: DatabaseAdapter

    beforeEach(async () => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('H2: derives unique workspace from project_number-only nested scope and blocks default/unnumbered/foreign cwd', async () => {
        const runIsolatedNestedCode = vi.fn(() => Promise.resolve({ success: true }))
        const nestedExecutor = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: null },
            timeoutMs: 1000,
            maxResultSize: 1024,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode,
            activeTimers: new Set(),
        })
        await nestedExecutor({ project_number: 5, code: 'return 1', readonly: true })
        expect(runIsolatedNestedCode).toHaveBeenCalledWith(
            '(async () => {\nreturn 1\n})()',
            true,
            false,
            false,
            expect.objectContaining({
                workspaceId: 'proj-alpha',
                projectNumber: 5,
            })
        )

        const rpcScope = resolveEffectiveRpcScope(
            {
                workspaceId: undefined,
                projectId: undefined,
                explicitWorkspace: false,
                sessionId: undefined,
            },
            { projectNumber: 5 },
            TEST_REGISTRY
        )
        expect('errorResult' in rpcScope).toBe(false)
        if (!('errorResult' in rpcScope)) {
            expect(rpcScope.effectiveWorkspaceId).toBe('proj-alpha')
            expect(rpcScope.effectiveExplicitWorkspace).toBe(true)
        }

        const tools = buildTestToolDefinitions({
            db,
            config: {
                runtime: new ServerRuntime(),
                projectRegistry: TEST_REGISTRY,
            },
        })
        const getRecentTool = tools.find((t) => t.name === 'get_recent_entries')
        const gitHistTool = tools.find((t) => t.name === 'get_commit_history')
        expect(getRecentTool).toBeDefined()
        expect(gitHistTool).toBeDefined()

        if (getRecentTool) {
            expect(
                validateRpcOverrideBounds(
                    getRecentTool,
                    { workspace_id: 'default' },
                    { projectNumber: 5 },
                    TEST_REGISTRY
                )
            ).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(
                validateRpcOverrideBounds(
                    getRecentTool,
                    { workspace_id: 'unnumbered-ws' },
                    { projectNumber: 5 },
                    TEST_REGISTRY
                )
            ).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        }
        if (gitHistTool) {
            expect(
                validateRpcOverrideBounds(
                    gitHistTool,
                    { cwd: '/repos/proj-beta' },
                    { projectNumber: 5 },
                    TEST_REGISTRY
                )
            ).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(
                validateRpcOverrideBounds(
                    gitHistTool,
                    { cwd: '/repos/proj-alpha/sub' },
                    { projectNumber: 5 },
                    TEST_REGISTRY
                )
            ).toBeUndefined()
        }
    })

    it('H2: wildcard update_entry and batch_update_entries reject cross-project source entries when moving to default', async () => {
        const foreign = db.createEntry({
            content: 'Foreign beta entry',
            workspaceId: 'proj-beta',
            projectNumber: 9,
        })
        const owned = db.createEntry({
            content: 'Owned alpha entry',
            workspaceId: 'proj-alpha',
            projectNumber: 5,
        })

        const mismatches = findWildcardProjectMismatches(
            db,
            [{ entry_id: foreign.id, workspace_id: '*', target_workspace_id: 'default' }],
            '*',
            5,
            { projectRegistry: TEST_REGISTRY }
        )
        expect(mismatches).toEqual([foreign.id])

        const sessionCtx: ToolContext = {
            db,
            config: {
                runtime: new ServerRuntime(),
                projectRegistry: TEST_REGISTRY,
            },
        }
        const tools = buildTestToolDefinitions(sessionCtx)
        const dispatch = createSecureDispatcher({
            tools,
            sessionContext: sessionCtx,
            projectId: 5,
            workspaceId: '*',
            explicitWorkspace: false,
            autoVersion: true,
        })

        const wildUpdateErr = (await dispatch('update_entry', {
            entry_id: foreign.id,
            workspace_id: '*',
            target_workspace_id: 'default',
        })) as Record<string, unknown>
        expect(wildUpdateErr['success']).toBe(false)

        const wildBatchErr = (await dispatch('batch_update_entries', {
            workspace_id: '*',
            updates: [
                { entry_id: owned.id, target_workspace_id: 'default' },
                { entry_id: foreign.id, target_workspace_id: 'default' },
            ],
        })) as Record<string, unknown>
        expect(wildBatchErr['success']).toBe(false)
    })

    it('M1: blocks fullwidth NFKC delimiter synthesis, ++ division regex confusion, \\uXXXX escapes, and catch/class block regex confusion', () => {
        const fullwidthRegex = '/\uFF0F/; return Object.getPrototypeOf(mj)'
        expect(stripCommentsAndStrings(fullwidthRegex)).toContain('Object.getPrototypeOf')
        expect(validateSandboxCode(fullwidthRegex).valid).toBe(false)

        const fullwidthQuoteEscape = '"\uFF3C";\nconst p = Object.getPrototypeOf(mj);\n""'
        expect(validateSandboxCode(fullwidthQuoteEscape).valid).toBe(false)

        const postIncDiv = 'let x = 1; x++ / 2; Object.getPrototypeOf(mj); const s = "/";'
        expect(validateSandboxCode(postIncDiv).valid).toBe(false)

        const unicodeReturnRegex =
            'function f() { r\\u0065turn /"/; } Object.getPrototypeOf(mj); // "'
        expect(validateSandboxCode(unicodeReturnRegex).valid).toBe(false)

        const catchBlockRegex = 'try {} catch {} /"/; Object.getPrototypeOf(mj); // "'
        expect(validateSandboxCode(catchBlockRegex).valid).toBe(false)

        const classBlockRegex = 'class C {} /"/; Object.getPrototypeOf(mj); // "'
        expect(validateSandboxCode(classBlockRegex).valid).toBe(false)

        expect(validateSandboxCode('const msg = "hello \uFF0F world"; return msg;').valid).toBe(true)
    })

    it('M2: blocks shared/sparse array explosions in O(1), caps worker RPC args before normalize, and finishes healer/SQL scans quickly', async () => {
        const sharedObj = { x: 1 }
        const sharedArr = new Array<typeof sharedObj>(30_000).fill(sharedObj)
        expect(exceedsMaxToolInputElements({ items: sharedArr }, 25_000)).toBe(true)

        const sparseArr: number[] = []
        sparseArr[50_000_000] = 1
        expect(exceedsMaxToolInputElements(sparseArr, 25_000)).toBe(true)

        const m2Context: ToolContext = {
            db,
            config: {
                runtime: new ServerRuntime(),
                projectRegistry: TEST_REGISTRY,
                maxToolInputElements: 100,
            },
        }
        const tools = buildTestToolDefinitions(m2Context)
        const dispatch = createSecureDispatcher({
            tools,
            sessionContext: m2Context,
            projectId: 5,
            workspaceId: 'proj-alpha',
            explicitWorkspace: true,
            autoVersion: false,
        })
        const rpcRes = (await dispatch('search_entries', {
            tags: Array.from({ length: 150 }, (_, i) => `t${String(i)}`),
        })) as Record<string, unknown>
        expect(rpcRes['success']).toBe(false)
        expect(rpcRes['code']).toBe('VALIDATION_ERROR')

        const start = Date.now()
        const longAdversarialExport = `export default async function f(${'('.repeat(20_000)}${'a'.repeat(5_000)}`
        rewriteModuleImportsAndExports(longAdversarialExport)
        healCodeModeScript(`fs.readFileSync(${'('.repeat(20_000)}${'x'.repeat(5_000)}`)
        parseSqlStatement(
            `UPDATE entries SET ${Array.from({ length: 300 }, (_, i) => `c${String(i)} = ?`).join(', ')} WHERE id = 1`,
            []
        )
        expect(Date.now() - start).toBeLessThan(1500)
    })

    it('L3 & L4: freezes newer Node intrinsics, bounds nested executeCode payloads, and parses GITHUB_HOST strictly', async () => {
        const globals = buildSandboxGlobals({
            mjApi: {},
            shimMj: {},
            safeFsShim: createSafeFsShim(),
            frozenContext: Object.freeze({}),
            executeCodeFn: () => Promise.resolve(undefined),
            updateMemoryFn: () => undefined,
        })
        expect(globals['SharedArrayBuffer']).toBeUndefined()
        expect(globals['FinalizationRegistry']).toBeUndefined()

        const vmCtx = vm.createContext({ ...globals })
        freezeInnerVmContext(vmCtx)
        const suppressedFrozen = vm.runInContext(
            'typeof SuppressedError !== "undefined" ? Object.isFrozen(SuppressedError.prototype) : true',
            vmCtx
        ) as boolean
        const disposableFrozen = vm.runInContext(
            'typeof DisposableStack !== "undefined" ? Object.isFrozen(DisposableStack.prototype) : true',
            vmCtx
        ) as boolean
        expect(suppressedFrozen).toBe(true)
        expect(disposableFrozen).toBe(true)

        const nestedExec = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: null },
            timeoutMs: 1000,
            maxResultSize: 1024,
            pinnedWorkspaceRaw: 'proj-alpha',
            pinnedProjectRaw: 5,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode: vi.fn(() => Promise.resolve({ success: true })),
            activeTimers: new Set(),
        })
        const oversizedNested = (await nestedExec({ code: 'x'.repeat(52 * 1024) })) as Record<
            string,
            unknown
        >
        expect(oversizedNested['success']).toBe(false)
        expect(oversizedNested['code']).toBe('SECURITY_VIOLATION')

        expect(resolveGithubHost('https://user:secret@ghe.corp.local/api/v3')).toBe('ghe.corp.local')
        expect(resolveGithubHost('ftp://bad-scheme.example')).toBe('github.com')
        expect(resolveGithubHost(undefined)).toBe('github.com')
    })
})
