import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as vm from 'node:vm'
import { z } from 'zod'
import { JournalApi } from '../../src/codemode/api/journal-api.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { createShimMjProxy } from '../../src/codemode/worker/mj-shim-proxy.js'
import { createGetReadFindInterceptor } from '../../src/codemode/worker/mj-shim-domains.js'
import { createContextProxy } from '../../src/codemode/worker/namespace-shims.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { FACTORY_SHIM_NAMES } from '../../src/codemode/worker/sandbox-process-shims.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { SafeFsShim } from '../../src/codemode/worker/node-shims.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: process.cwd(), project_number: 16 },
}

describe('Pass 67 Audit — Code Mode Recovery, SQL Binds, Proxies, Shims & Regex Safety', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('B-C1: extractAndRecoverEntryCode strips JS comments while preserving strings and uses exact match-span removal', () => {
        const defaultScopeCode = `mj.core.createEntry({ content: "default", workspace_id: "default", title: "default" })`
        const defaultRecovered = extractAndRecoverEntryCode(defaultScopeCode)
        expect(defaultRecovered).not.toBeNull()
        expect(defaultRecovered).toContain('"workspace_id":"default"')
        expect(defaultRecovered).toContain('"content":"default"')

        const commentedCode = [
            '// content: "commented-out"',
            '/* workspace_id: "evil-repo" */',
            'mj.core.createEntry({ content: "See https://example.com/a//b for details", workspace_id: "companion", tags: ["default"] })',
        ].join('\n')
        const urlRecovered = extractAndRecoverEntryCode(commentedCode)
        expect(urlRecovered).not.toBeNull()
        expect(urlRecovered).toContain('https://example.com/a//b')
        expect(urlRecovered).toContain('"workspace_id":"companion"')
        expect(urlRecovered).not.toContain('commented-out')
        expect(urlRecovered).not.toContain('evil-repo')
    })

    it('B-H1: parseSqlStatement rejects trailing record binds that conflict with SQL literal workspace/project scopes', () => {
        const updateWhereConflict = parseSqlStatement(
            "UPDATE memory_journal SET content = ? WHERE id = ? AND workspace_id = 'beta'",
            ['updated body', 42, { workspace_id: 'alpha' }]
        )
        expect(updateWhereConflict.action).toBe('unmapped')

        const updateSetTargetConflict = parseSqlStatement(
            "UPDATE memory_journal SET content = ?, workspace_id = 'beta' WHERE id = ?",
            ['updated body', 42, { target_workspace_id: 'alpha' }]
        )
        expect(updateSetTargetConflict.action).toBe('unmapped')

        const insertConflict = parseSqlStatement(
            "INSERT INTO memory_journal (content, workspace_id) VALUES (?, 'beta')",
            ['new body', { workspace_id: 'alpha' }]
        )
        expect(insertConflict.action).toBe('unmapped')

        const selectConflict = parseSqlStatement(
            "SELECT * FROM memory_journal WHERE id = ? AND workspace_id = 'beta'",
            [10, { workspace_id: 'alpha', project_number: 99 }]
        )
        expect(selectConflict.action).toBe('unmapped')

        const compatible = parseSqlStatement(
            "UPDATE memory_journal SET content = ? WHERE id = ? AND workspace_id = 'beta'",
            ['updated body', 42, { workspace_id: 'beta', tags: ['ok'] }]
        )
        expect(compatible.action).toBe('update')
        expect(compatible.params['workspace_id']).toBe('beta')
    })

    it('B-H3: isSafeUserRegex catches parenthesized complementary wildcard and ASCII case-folding ReDoS patterns', () => {
        expect(isSafeUserRegex('([\\s\\S]+)([\\s\\S]+)!')).toBe(false)
        expect(isSafeUserRegex('([\\d\\D]+)([\\d\\D]+)!')).toBe(false)
        expect(isSafeUserRegex('([\\w\\W]+)([\\w\\W]+)!')).toBe(false)
        expect(isSafeUserRegex('(a+)(a+)+')).toBe(false)
        expect(isSafeUserRegex('a+A+')).toBe(false)
        expect(isSafeUserRegex('^[a-z]+\\s+\\d+$')).toBe(true)
    })

    it('B-M2: buildApiProxy invokeRpc catches synchronous exceptions from applyArgInterceptions cleanly', async () => {
        const rpcCall = vi.fn().mockResolvedValue({ success: true, entries: [] })
        const api = buildApiProxy(rpcCall, { core: ['searchEntries'] })
        const core = api['core'] as Record<string, (...args: unknown[]) => Promise<unknown>>

        const hostileArg = new Proxy(
            {},
            {
                ownKeys(): string[] {
                    throw new Error('hostile proxy ownKeys boom')
                },
            }
        )
        const result = (await core['searchEntries']!(hostileArg)) as Record<string, unknown>
        expect(result['success']).toBe(false)
        expect(result['code']).toBe('EXECUTION_ERROR')
        expect(String(result['error'])).toContain('hostile proxy ownKeys boom')
        expect(rpcCall).not.toHaveBeenCalled()
    })

    it('B-M3: normalizeDispatchParams inherits effective session_id into batch entries missing or blanking session_id', async () => {
        const fakeTool: ToolDefinition = {
            name: 'batch_create_entries',
            description: 'batch create',
            group: 'admin',
            inputSchema: z.object({
                session_id: z.string().optional(),
                workspace_id: z.string().optional(),
                project_number: z.number().optional(),
                entries: z.array(
                    z.object({
                        content: z.string(),
                        session_id: z.string().optional(),
                        workspace_id: z.string().optional(),
                        project_number: z.number().optional(),
                    })
                ),
            }),
            handler: () => Promise.resolve({ success: true }),
        }
        const ctx: ToolContext = {
            db: new DatabaseAdapter(':memory:'),
            runtime: new ServerRuntime(),
            config: { projectRegistry: TEST_REGISTRY },
        }
        const res = await normalizeDispatchParams(
            fakeTool,
            {
                session_id: 'top-sess-1',
                entries: [
                    { content: 'one' },
                    { content: 'two', session_id: '   ' },
                    { content: 'three', session_id: 'item-sess-3' },
                ],
            },
            {
                sessionContext: ctx,
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                explicitWorkspace: true,
                sessionId: 'ctx-sess-fallback',
            }
        )
        expect('params' in res).toBe(true)
        if ('params' in res) {
            const items = (res.params as Record<string, unknown>)['entries'] as Record<string, unknown>[]
            expect(items[0]?.['session_id']).toBe('top-sess-1')
            expect(items[1]?.['session_id']).toBe('top-sess-1')
            expect(items[2]?.['session_id']).toBe('item-sess-3')
        }
    })

    it('B-M4: resolveCodeModeSessionContext treats whitespace-only workspace_id as unset before fallback', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const ctx: ToolContext = {
                db,
                runtime: new ServerRuntime(),
                config: {
                    defaultWorkspaceId: 'companion',
                    projectRegistry: TEST_REGISTRY,
                },
            }
            const resolved = await resolveCodeModeSessionContext(ctx, {
                code: 'return 1',
                workspace_id: '   ',
            })
            expect('errorResponse' in resolved).toBe(false)
            if (!('errorResponse' in resolved)) {
                expect(resolved.workspaceId).toBe('companion')
                expect(resolved.numericProjectId).toBe(16)
            }
        } finally {
            db.close()
        }
    })

    it('B-M5: JournalApi propagates wrapTeamAutoRoute and semanticSearch wrappers onto aliases', async () => {
        const dispatcher = vi.fn((toolName: string) => {
            if (toolName === 'get_entry_by_id') {
                return Promise.resolve({
                    success: false,
                    code: 'RESOURCE_NOT_FOUND',
                    suggestion: 'Try team_get_entry_by_id',
                })
            }
            if (toolName === 'team_get_entry_by_id') {
                return Promise.resolve({ success: true, entry: { id: 12 } })
            }
            if (toolName === 'semantic_search') {
                return Promise.resolve({ success: true, entries: [] })
            }
            return Promise.resolve({ success: true })
        })
        const emptySchema = z.looseObject({})
        const tools: ToolDefinition[] = [
            {
                name: 'get_entry_by_id',
                description: 'get entry',
                group: 'core',
                inputSchema: emptySchema,
                handler: () => Promise.resolve({}),
            },
            {
                name: 'team_get_entry_by_id',
                description: 'team get entry',
                group: 'team',
                inputSchema: emptySchema,
                handler: () => Promise.resolve({}),
            },
            {
                name: 'semantic_search',
                description: 'semantic search',
                group: 'search',
                inputSchema: emptySchema,
                handler: () => Promise.resolve({}),
            },
        ]
        const api = new JournalApi(tools, dispatcher)

        const aliasEntryRes = (await (
            api.core['getEntry'] as (args: Record<string, unknown>) => Promise<Record<string, unknown>>
        )({ entry_id: 12 }))
        expect(aliasEntryRes['success']).toBe(true)
        expect(aliasEntryRes['_healed']).toEqual({ routedTo: 'team' })

        const coreSemanticRes = (await (
            api.core['semanticSearch'] as (args: Record<string, unknown>) => Promise<Record<string, unknown>>
        )({ query: 'test' }))
        expect(coreSemanticRes['warning']).toBe('Semantic search returned no entries')
    })

    it('B-M6 & B-M7: shims omit create factory prop and forward ...args across saveMemory, executeCode, and get/find', async () => {
        expect((FACTORY_SHIM_NAMES as readonly string[]).includes('create')).toBe(false)

        const updateSpy = vi.fn().mockReturnValue({ ok: true })
        const getEntrySpy = vi.fn().mockReturnValue({ ok: 'get' })
        const execSpy = vi.fn().mockResolvedValue({ ok: 'exec' })
        const emptyFsShim = {} as unknown as SafeFsShim
        const mjApi = {
            core: { getEntryById: getEntrySpy },
            search: { searchEntries: vi.fn() },
        }
        const shimMj = createShimMjProxy({
            mjApi,
            safeFsShim: emptyFsShim,
            executeCodeFnRef: { current: execSpy },
            getUpdateMemoryFn: () => updateSpy,
        })

        expect(shimMj['create']).toBeUndefined()
        const noCoreShim = createShimMjProxy({
            mjApi: { search: { searchEntries: vi.fn() } },
            safeFsShim: emptyFsShim,
            executeCodeFnRef: { current: execSpy },
            getUpdateMemoryFn: () => updateSpy,
        })
        expect(noCoreShim['create']).toBeUndefined()
        ;(shimMj['saveMemory'] as (...a: unknown[]) => unknown)(12, { content: 'patched' })
        expect(updateSpy).toHaveBeenCalledWith(12, { content: 'patched' })

        await (shimMj['execute_code'] as (...a: unknown[]) => Promise<unknown>)('return 1', {
            readonly: true,
        })
        expect(execSpy).toHaveBeenCalledWith('return 1', { readonly: true })

        const getFn = createGetReadFindInterceptor(mjApi, shimMj)
        getFn(7, { include_relationships: true })
        expect(getEntrySpy).toHaveBeenCalledWith({ entry_id: 7 }, { include_relationships: true })

        const runIsolatedNested = vi.fn().mockResolvedValue({ success: true })
        const vmCtx = vm.createContext({})
        const executor = createSandboxExecutor({
            shimMj,
            vmContextRef: { current: vmCtx },
            timeoutMs: 1000,
            maxResultSize: 10000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            runIsolatedNestedCode: runIsolatedNested,
            activeTimers: new Set(),
        })
        const nlBlocked = (await executor('entry: blocked readonly note', {
            readonly: true,
        })) as Record<string, unknown>
        expect(nlBlocked['success']).toBe(false)
        expect(String(nlBlocked['error'])).toContain('readonly')

        await executor("await mj.core.createEntry({ content: 'blocked' })", {
            readonly: true,
        })
        expect(runIsolatedNested).toHaveBeenCalledWith(
            expect.any(String),
            true,
            false,
            false,
            undefined
        )
    })

    it('B-L8: createContextProxy freezes a shallow copy and rejects property mutations', () => {
        const backing = { repo: 'companion', my_key: 42 }
        const proxy = createContextProxy(backing)

        expect(Object.isFrozen(proxy)).toBe(true)
        expect(proxy['myKey']).toBe(42)
        expect(() => {
            'use strict'
            proxy['extra'] = 'mutated'
        }).toThrow(TypeError)
        expect('extra' in backing).toBe(false)
    })
})
