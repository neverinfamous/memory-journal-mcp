import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as vm from 'node:vm'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import {
    isInsideStringLiteral,
    isInsideStringOrComment,
} from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { createReadResourceInterceptor } from '../../src/codemode/proxy-helpers.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import {
    createSandboxExecutor,
} from '../../src/codemode/worker/nested-exec-scope.js'
import { extractNestedSessionId } from '../../src/codemode/worker/nested-exec-payload.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: process.cwd(), project_number: 16 },
    'other-repo': { path: process.cwd(), project_number: 99 },
}

describe('Pass 66 Audit — Code Mode Sandbox, Worker, Healers & Normalizers', () => {
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

    it('H2: unwrapNestedExecuteCode refuses multi-option isolation bypasses, sequential calls, and raw invalid fallthrough', async () => {
        const bypassPayload =
            `return await mj.executeCode({ code: "return await mj.core.createEntry({ content: 'bypass' }) //", readonly: true, dry_run: true, use_test_db: true, workspace_id: "other-repo" })`
        const healedBypass = healCodeModeScript(bypassPayload)
        expect(healedBypass).toContain('mj.executeCode(')
        expect(healedBypass).toContain('workspace_id: "other-repo"')

        const validMultiOpt = `return await mj.executeCode({ code: "return 1", workspace_id: "companion" })`
        expect(healCodeModeScript(validMultiOpt)).toContain('workspace_id: "companion"')

        const sequential = `await mj.executeCode("return 1"); await mj.executeCode("return 2")`
        expect(healCodeModeScript(sequential)).toContain('executeCode("return 2")')

        const invalidInner = `await mj.executeCode("not-valid ??? ;;;")`
        expect(healCodeModeScript(invalidInner)).not.toBe('not-valid ??? ;;;')

        const db = new DatabaseAdapter(':memory:')
        try {
            await db.initialize()
            const res = (await callTool(
                'mj_execute_code',
                {
                    code: bypassPayload,
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    timeout_ms: 15_000,
                },
                db,
                undefined,
                undefined,
                { runtime: new ServerRuntime(), codemodeEnabled: true, projectRegistry: TEST_REGISTRY }
            )) as { success: boolean; error?: string; result?: { success?: boolean; error?: string } }
            expect(res.success === false || res.result?.success === false).toBe(true)
            const msg = res.result?.error ?? res.error ?? ''
            expect(msg).not.toMatch(/SyntaxError/i)
            expect(msg).toMatch(/workspace|scope|mismatch|other-repo|denied/i)
            const rows = db.getRecentEntries(10, undefined, 'timestamp', undefined, false, '*')
            expect(rows.entries.length).toBe(0)
        } finally {
            db.close()
        }
    }, 25_000)

    it('H3: top-level global sandbox shims forward all rest args (preserving workspace_id and patch options)', async () => {
        const sandbox = new WorkerSandbox()
        try {
            const createStub = vi.fn().mockResolvedValue({ success: true, id: 1 })
            const updateStub = vi.fn().mockResolvedValue({ success: true, id: 42 })
            const deleteStub = vi.fn().mockResolvedValue({ success: true, deleted: [42] })
            const updateConfigStub = vi.fn().mockResolvedValue({ success: true })

            const res = await sandbox.execute(
                `await createEntry("note", { workspace_id: "companion", project_number: 16 });
                 await updateEntry(42, { content: "new", workspace_id: "companion" });
                 await deleteEntry(42, { workspace_id: "companion", permanent: true });
                 await saveMemory("saved", { workspace_id: "companion" });
                 await updateMemory(42, { content: "patched", workspace_id: "companion" });
                 await updateConfiguration({ workspace_id: "companion" }, { preserve: true });
                 return { ok: true };`,
                {
                    core: { createEntry: createStub },
                    admin: {
                        updateEntry: updateStub,
                        deleteEntry: deleteStub,
                        updateConfiguration: updateConfigStub,
                    },
                },
                undefined,
                15_000,
                {},
                false
            )
            expect(res.success).toBe(true)
            expect(createStub).toHaveBeenNthCalledWith(1, {
                content: 'note',
                workspace_id: 'companion',
                project_number: 16,
            })
            expect(createStub).toHaveBeenNthCalledWith(2, {
                content: 'saved',
                workspace_id: 'companion',
            })
            expect(updateStub).toHaveBeenNthCalledWith(1, {
                entry_id: 42,
                content: 'new',
                workspace_id: 'companion',
            })
            expect(updateStub).toHaveBeenNthCalledWith(2, {
                entry_id: 42,
                content: 'patched',
                workspace_id: 'companion',
            })
            expect(deleteStub).toHaveBeenCalledWith(42, {
                workspace_id: 'companion',
                permanent: true,
            })
            expect(updateConfigStub).toHaveBeenCalledWith({ workspace_id: 'companion' }, { preserve: true })
        } finally {
            sandbox.dispose()
        }
    }, 25_000)

    it('M1: timed-out WorkerSandbox detaches dying worker immediately before terminate resolves', async () => {
        const sandbox = new WorkerSandbox()
        try {
            const internal = sandbox as unknown as {
                worker: { terminate: () => Promise<number>; unref: () => void } | null
                terminateTimedOutExecution: (id: number) => void
                executionId: number
                currentExecution: {
                    resolve: (r: unknown) => void
                    timeoutHandle: NodeJS.Timeout
                    hostPort: { close: () => void }
                    startTime: number
                    startRss: number
                } | null
            }
            let settledTimeout = false
            internal.currentExecution = {
                resolve: () => {
                    settledTimeout = true
                },
                timeoutHandle: setTimeout(() => undefined, 5000),
                hostPort: { close: () => undefined },
                startTime: 0,
                startRss: 0,
            }
            const neverTerminates = new Promise<number>(() => undefined)
            const origWorker = internal.worker
            internal.worker = {
                terminate: () => neverTerminates,
                unref: () => undefined,
            }
            internal.terminateTimedOutExecution(internal.executionId)
            expect(settledTimeout).toBe(true)
            expect(internal.worker).toBeNull()
            await origWorker?.terminate().catch(() => undefined)
        } finally {
            sandbox.dispose()
        }
    })

    it('M4: nested execution validation, narrowing, and session_id extraction parse stringified JSON context', async () => {
        const strCtx = JSON.stringify({
            workspace_id: 'other-repo',
            project_number: 99,
            session_id: 'sess-p66',
        })
        expect(
            validateNestedExecScope({ context: strCtx }, 'memory-journal-mcp', 5, TEST_REGISTRY)
        ).not.toBeNull()
        expect(extractNestedSessionId({ context: strCtx })).toBe('sess-p66')

        const vmContextRef = { current: vm.createContext({ JSON }) }
        let capturedIsolation: { workspaceId?: string; projectNumber?: number } | undefined
        const exec = createSandboxExecutor({
            shimMj: {},
            vmContextRef,
            timeoutMs: 2000,
            maxResultSize: 4096,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode: async (_c, _r, _d, _t, iso) => {
                capturedIsolation = iso
                return { success: true, result: { isolated: true } }
            },
        })
        await exec({
            code: 'return 1',
            context: JSON.stringify({ workspace_id: 'companion', project_number: 16 }),
        })
        expect(capturedIsolation).toMatchObject({
            workspaceId: 'companion',
            projectNumber: 16,
        })
    })

    it('M10, L3, O3, O4, O5, O11, O12, O13, O14: key normalizer, proxies, auto-return, healer regex state, SQL & shims', async () => {
        // M10
        expect(
            convertKeysToSnakeCase(
                { filename: 'backup-2026.db', confirm: true, project_number: 5 },
                'restoreBackup'
            )
        ).toMatchObject({ filename: 'backup-2026.db', confirm: true, project_number: 5 })

        // L3
        const wrapped = wrapResult({
            at: new Date('2026-11-21T12:00:00.000Z'),
            pattern: /abc/i,
        }) as { at: Date; pattern: RegExp }
        expect(wrapped.at.toISOString()).toBe('2026-11-21T12:00:00.000Z')
        expect(wrapped.pattern.test('ABC')).toBe(true)

        // O3
        const teamMemberArgs = applyArgInterceptions('teamGetMember', [{ target_user: 'alice' }])
        expect('args' in teamMemberArgs).toBe(true)
        if ('args' in teamMemberArgs) {
            expect(teamMemberArgs.args[0]).toEqual({ author: 'alice' })
        }

        // O4
        expect(transformAutoReturn('const returned = 7;\nreturned')).toContain('return returned')
        expect(transformAutoReturn('returnValue')).toBe('return returnValue')
        expect(transformAutoReturn('thrown')).toBe('return thrown')

        // O5
        const rxLine = 'const r = /fs.existsSync("a")/'
        expect(isInsideStringOrComment(rxLine, 12)).toBe(true)
        expect(isInsideStringLiteral(rxLine, 12)).toBe(false)

        // O11
        const readResHint = (await createReadResourceInterceptor()('memory://agent-context/foo')) as {
            error?: string
        }
        expect(readResHint.error).not.toContain('getConfig()')
        expect(readResHint.error).toContain('listProjects()')

        // O12
        expect(parseSqlStatement('UPDATE memory_journal SET id = 99 WHERE id = 5', []).action).toBe('unmapped')
        expect(
            parseSqlStatement('UPDATE memory_journal SET entry_id = ? WHERE id = 5', [99]).action
        ).toBe('unmapped')

        // O13
        const rec = extractAndRecoverEntryCode(
            'createEntry({ content: "kept", auto_context: { workspace_id: "other", project_number: 99 } })'
        )
        const recMatch = /^return await mj\.createEntry\(([\s\S]*)\);$/.exec(rec ?? '')
        expect(recMatch).not.toBeNull()
        const recPayload = JSON.parse(recMatch?.[1] ?? '{}') as Record<string, unknown>
        expect(recPayload['workspace_id']).toBeUndefined()
        expect(recPayload['project_number']).toBeUndefined()
        expect(recPayload['auto_context']).toEqual({ workspace_id: 'other', project_number: 99 })

        // O14
        const sandbox = new WorkerSandbox()
        try {
            const getByIdStub = vi.fn().mockResolvedValue({ success: true, entry: { id: 42 } })
            const qRes = await sandbox.execute(
                `const a = await mj.query("SELECT * FROM memory_journal WHERE id = ?", 42);
                 const b = await mj.db.query("SELECT * FROM memory_journal WHERE id = ?", 42);
                 return { a, b };`,
                { core: { getEntryById: getByIdStub } },
                undefined,
                15_000,
                {},
                false
            )
            expect(qRes.success).toBe(true)
            expect(getByIdStub).toHaveBeenCalledTimes(2)
            expect(getByIdStub).toHaveBeenNthCalledWith(1, { entry_id: 42 })
            expect(getByIdStub).toHaveBeenNthCalledWith(2, { entry_id: 42 })
        } finally {
            sandbox.dispose()
        }
    }, 25_000)
})
