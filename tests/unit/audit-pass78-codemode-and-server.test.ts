import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { resolveMcpCreateWorkspaceScope } from '../../src/server/mcp-server/tool-registration/create-scope-interceptor.js'
import { healIncomingToolCallParams } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { ALREADY_HEALED_ARGS } from '../../src/server/mcp-server/tool-registration/healed-args-marker.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/project-alias-helpers.js'
import { assertSafeDirectoryPath, hasUnsafeAdsColon } from '../../src/utils/path-safety.js'
import {
    readProjectRegistryFile,
    resolveRegistryConfigPath,
    writeProjectRegistryFile,
} from '../../src/utils/registry-config-file.js'
import { pairStoredScope } from '../../src/utils/write-scope.js'
import { ValidationError } from '../../src/types/errors.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import {
    extractNestedTimeoutMs,
    mergeNestedArgAndOptions,
} from '../../src/codemode/worker/nested-exec-payload.js'
import {
    isSingleSqlStringLiteral,
    isSupportedWhereClause,
} from '../../src/codemode/sql-literal-scope.js'
import { parseLiteral, UNPARSEABLE } from '../../src/codemode/sql-record-bind-helpers.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { parsePositiveEntryId } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { createAppendInterceptor } from '../../src/codemode/worker/mj-shim-domains.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import * as vm from 'node:vm'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 78 Audit — Code Mode, Server Interceptor, Scope & Prompts', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEnc = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('A-H1, A-M1, A-M2, A-L1 & A-L2: preserves blank batch workspace_id, strips normalizer markers, guards leading-space ADS colons, clones config cache & blocks prototype keys', async () => {
        const dir = makeTempDir('mj-p78-srv-')
        const db = new DatabaseAdapter(path.join(dir, 'test.db'))
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            const projectRegistry = { 'repo-a': { path: dir, project_number: 5 } }
            const cfg = {
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry },
                projectRegistry,
                runtime,
            }

            const batchItemArgs: Record<string, unknown> = { entries: [{ content: 'note', workspace_id: '' }] }
            resolveMcpCreateWorkspaceScope('batch_create_entries', batchItemArgs, cfg)
            expect((batchItemArgs['entries'] as { workspace_id: unknown }[])[0]?.workspace_id).toBe('')

            const batchRootArgs: Record<string, unknown> = { workspace_id: '   ', entries: [{ content: 'note' }] }
            resolveMcpCreateWorkspaceScope('batch_create_entries', batchRootArgs, cfg)
            expect((batchRootArgs['entries'] as { workspace_id?: unknown }[])[0]?.workspace_id).toBeUndefined()

            const rejectedBatch = (await callTool(
                'batch_create_entries',
                { entries: [{ content: 'note', workspace_id: '' }] },
                db,
                undefined,
                undefined,
                cfg
            )) as { success?: boolean }
            expect(rejectedBatch.success).toBe(false)

            const prevReg = captureActiveProjectRegistryState()
            setActiveProjectRegistry({ outer: { project_number: 9 } })
            try {
                const callParams = {
                    name: 'create_entry',
                    arguments: { content: 'hello', metadata: { workspace_id: 'repo-a' } } as Record<string, unknown>,
                }
                const err = healIncomingToolCallParams(
                    callParams,
                    { name: 'test', version: '1.0.0', transport: 'stdio' },
                    cfg.briefingConfig
                )
                expect(err).toBeUndefined()
                expect('_alias_derived_workspace' in (callParams.arguments as Record<string, unknown>)).toBe(false)
                expect(ALREADY_HEALED_ARGS.has(callParams.arguments as object)).toBe(true)
                const created = (await callTool('create_entry', callParams.arguments, db, undefined, undefined, cfg)) as {
                    success?: boolean
                    entry?: { workspaceId?: string; projectNumber?: number }
                }
                expect(created.success).toBe(true)
                expect(created.entry?.workspaceId).toBe('repo-a')
                expect(created.entry?.projectNumber).toBe(5)
                expect(captureActiveProjectRegistryState().registry).toEqual({ outer: { project_number: 9 } })
            } finally {
                restoreActiveProjectRegistryState(prevReg)
            }

            expect(hasUnsafeAdsColon(' C:\\sub')).toBe(true)
            expect(() => assertSafeDirectoryPath(' C:\\sub', [dir])).toThrow()

            const cfgPath = resolveRegistryConfigPath(path.join(dir, 'reg.json'))
            const regObj = { projectRegistry: { 'repo-a': { project_number: 5 } } }
            writeProjectRegistryFile(cfgPath, regObj)
            regObj.projectRegistry['repo-a'] = { project_number: 99 }
            const loadedReg = readProjectRegistryFile(cfgPath)
            expect(
                (loadedReg.registry['repo-a'] as { project_number?: number } | undefined)?.project_number
            ).toBe(5)

            expect(() => pairStoredScope('__proto__', 5, {})).toThrow(ValidationError)
        } finally {
            db.close()
        }
    })

    it('C-H1..C-H4: narrows nested project_name/project, rejects compound SQL literals, keeps quoted + backtick JS untouched & fails closed on non-decimal entry_id', async () => {
        const regRaw = { 'repo-a': { project_number: 5 }, 'repo-b': { project_number: 9 } }
        let capturedOverrides: { workspaceId?: string; projectNumber?: number } | undefined
        const vmCtx = vm.createContext({ mj: {}, console })
        const execByProjName = createSandboxExecutor({
            shimMj: {
                core: {
                    createEntry: async () => ({ success: true }),
                },
            },
            vmContextRef: { current: vmCtx },
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: regRaw,
            runIsolatedNestedCode: async (_code, _ro, _dr, _td, overrides) => {
                capturedOverrides = {
                    workspaceId: overrides?.workspaceId,
                    projectNumber: overrides?.projectNumber,
                }
                return { ok: true }
            },
        })
        await execByProjName({ code: 'return 1', project_name: 'repo-a' })
        expect(capturedOverrides).toEqual({ workspaceId: 'repo-a', projectNumber: 5 })
        await execByProjName({ code: 'return 1', project: 'repo-a' })
        expect(capturedOverrides).toEqual({ workspaceId: 'repo-a', projectNumber: 5 })

        expect(validateNestedExecScope({ code: 'return 1', project_number: 5, context: { project_number: 9 } }, undefined, undefined, regRaw).error).toMatch(/Conflicting project_number/)
        expect('error' in mergeNestedArgAndOptions({ project_id: 5 }, { project_number: 9 })).toBe(true)

        expect(isSingleSqlStringLiteral("'other' || '-ws'")).toBe(false)
        expect(isSupportedWhereClause("WHERE id = 42 AND workspace_id = 'other' || '-ws'")).toBe(false)
        expect(parseLiteral("'a' || 'b'")).toBe(UNPARSEABLE)
        expect(extractAndRecoverSqlCode("DELETE FROM memory_journal WHERE id = 42 AND workspace_id = 'other' || '-ws'")).toBeNull()

        const validMixed = 'return await mj.core.createEntry({ title: "Fix `.env` handling", content: "hello " + context.repo + " world", workspace_id: "memory-journal-mcp", project_number: 5 })'
        expect(healCodeModeScript(validMixed)).toContain('"hello " + context.repo + " world"')

        expect(parsePositiveEntryId({ entry_id: '0x10' }, {})).toBe('0x10')
        const hexJson = resolveExecutionPayload(
            { code: '{"entry_id":"0x10","content":"patched"}' },
            undefined,
            true,
            0
        )
        expect('executionCode' in hexJson ? hexJson.executionCode : '').toContain('updateEntry')
        expect('executionCode' in hexJson ? hexJson.executionCode : '').not.toContain('createEntry')
        const sciJson = resolveExecutionPayload(
            { code: '{"entry_id":"1e2","content":"patched"}' },
            undefined,
            true,
            0
        )
        expect('executionCode' in sciJson ? sciJson.executionCode : '').toContain('updateEntry')
        const objId = resolveExecutionPayload(
            {} as never,
            { entry_id: '0x10', content: 'patched' },
            true,
            0
        )
        expect('executionCode' in objId ? objId.executionCode : '').toContain('updateEntry')
    })

    it('C-M1, C-M3..C-M5, C-L1..C-L5 & AP*: enforces proxy/normalizer/append/alias/timeout/worker/prompt contracts', async () => {
        const proxy = buildApiProxy(
            async () => ({ success: true }),
            { core: ['readQuery', 'read_query'] }
        )
        const coreProxy = proxy['core'] as Record<string, unknown>
        const spread = { ...coreProxy }
        expect(typeof spread['readQuery']).toBe('function')
        expect(spread['readQuery']).toBe(coreProxy['readQuery'])
        const callRes = await (coreProxy['readQuery'] as (args?: unknown) => Promise<{ success?: boolean }>)({ limit: 1 })
        expect(callRes.success).toBe(true)

        const snake = convertKeysToSnakeCase(
            { workspaceId: 'repo-b', entry: { workspace_id: 'repo-a', content: 'hi' } },
            'createEntry'
        )
        expect(snake['workspace_id']).toBe('repo-b')

        const recovered = extractAndRecoverEntryCode(
            "mj.core.createEntry({ content: 'Don\\'t break', auto_context: JSON.stringify({ workspace_id: 'wrong-ws', project_number: 9, type: 'bug_fix' }), workspace_id: 'real-ws', project_number: 5 })"
        )
        expect(recovered).toContain('"workspace_id":"real-ws"')
        expect(recovered).toContain('"project_number":5')
        expect(recovered).not.toContain('"type":"bug_fix"')

        const createdCalls: unknown[] = []
        const appendFn = createAppendInterceptor({
            core: { createEntry: (args: unknown) => { createdCalls.push(args); return { success: true } } },
        })
        expect(appendFn).toBeDefined()
        appendFn?.('My note', { workspace_id: 'repo-a', project_number: 5 })
        appendFn?.(['t'], 'Body', { entryType: 'project_decision', significanceType: 'decision' })
        expect(createdCalls[0]).toEqual({ workspace_id: 'repo-a', project_number: 5, content: 'My note' })
        expect(createdCalls[1]).toMatchObject({
            entryType: 'project_decision',
            significanceType: 'decision',
            content: 'Body',
            tags: ['t'],
        })

        const teamCalls: unknown[] = []
        const coreGrp: Record<string, unknown> = {
            getEntryById: async () => ({
                success: false,
                code: 'RESOURCE_NOT_FOUND',
                suggestion: 'Try team_get_entry_by_id',
            }),
        }
        const relGrp: Record<string, unknown> = {
            visualizeRelationships: async () => ({
                success: false,
                code: 'RESOURCE_NOT_FOUND',
                suggestion: 'Try team_visualize_relationships',
            }),
        }
        const teamGrp: Record<string, unknown> = {
            teamGetEntryById: async (a: unknown) => { teamCalls.push(a); return { success: true } },
            teamVisualizeRelationships: async (a: unknown) => { teamCalls.push(a); return { success: true } },
        }
        wireProjectAndTeamAliasesHelper({
            core: coreGrp,
            search: {},
            admin: {},
            relationships: relGrp,
            team: teamGrp,
            hasDispatcher: true,
            registryProvider: undefined,
            copyFnSchema: () => {},
        })
        await (coreGrp['getEntryById'] as (a: unknown) => Promise<unknown>)({ entry_id: 9, session_id: 's1', workspace_id: 'repo-a' })
        await (relGrp['visualizeRelationships'] as (a: unknown) => Promise<unknown>)({ entry_id: 9, limit: 5, session_id: 's1', workspace_id: 'repo-a' })
        expect(teamCalls[0]).toMatchObject({ entry_id: 9, session_id: 's1', workspace_id: 'repo-a' })
        expect(teamCalls[1]).toMatchObject({ entry_id: 9, limit: 5, session_id: 's1', workspace_id: 'repo-a' })

        const aliased: Record<string, unknown> = { max_bytes: '50 kb', workspace_id: 'repo-a' }
        normalizeExecuteCodeAliases(aliased)
        expect(aliased['code']).toBeUndefined()
        const maxBytesPayload = resolveExecutionPayload(
            aliased as never,
            aliased,
            true,
            0
        )
        expect('executionCode' in maxBytesPayload).toBe(false)
        expect('earlyReturn' in maxBytesPayload).toBe(true)

        const wrapped = wrapResult({ entries: [{ id: 1, tags: ['a'] }] }) as {
            entries: { tags: string[]; content?: string }[]
        }
        const first = wrapped.entries[0]
        expect(first).toBeDefined()
        if (first !== undefined) {
            expect(() => { first.tags.push('x') }).toThrow()
            expect(() => { first.content = 'y' }).toThrow()
        }

        const parsedSchema = ExecuteCodeSchema.safeParse({ code: 'return 1', timeout: '0x100' })
        expect(parsedSchema.success && parsedSchema.data.timeout === undefined).toBe(true)
        expect(extractNestedTimeoutMs({ timeout: '0x100' }, 5000)).toBeUndefined()
        const badScore = applyArgInterceptions('create_entry', [{ content: 'x', confidence: '0x1' }])
        expect('args' in badScore && (badScore.args[0] as Record<string, unknown>)['trust_score']).toBe('0x1')

        const sandbox = new WorkerSandbox({ timeoutMs: 2000 })
        try {
            vi.spyOn(sandbox as unknown as { dispatchWorkerMessage: () => void }, 'dispatchWorkerMessage').mockImplementationOnce(() => {
                throw new Error('simulated setup failure')
            })
            const failed = await sandbox.execute('return 1', {}, {})
            expect(failed.success).toBe(false)
            expect(failed.error).toContain('simulated setup failure')
            expect((sandbox as unknown as { isBusy: boolean }).isBusy).toBe(false)
        } finally {
            sandbox.dispose()
        }

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-23-audit-pass78')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-23-audit-pass78')
        const cqDef = getCodeQualityAuditPromptDefinition()
        const cqRendered = await cqDef.handler(
            { target: 'src', copilot: 'false' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof cqDef.handler>[1]
        )
        const cqText =
            (cqRendered as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(cqText).toContain('Prompt revision: 2026-11-23-audit-pass78')
        expect(cqText).toContain('hasUnsafeAdsColon')
        expect(cqText).toContain('_alias_derived_workspace')
        expect(cqText).toContain('isSingleSqlStringLiteral')
        expect(cqText).toContain('getOwnPropertyDescriptor')
    })
})
