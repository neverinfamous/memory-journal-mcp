/**
 * Pass 84 Audit — Code Mode Synthesis/Worker Isolation, CLI Input Guards,
 * Vector Validation, Schema Bounds & Revision Regression Suite.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { synthesizeEntryMutationFields } from '../../src/codemode/normalizers/entry-mutation-synthesis.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import { normalizeParams } from '../../src/codemode/api/param-normalizer.js'
import { extractNestedContextRecord } from '../../src/codemode/worker/nested-exec-payload.js'
import { createIsolatedNestedRunner } from '../../src/codemode/worker/nested-exec-runner.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { readBoundedCliInputFile } from '../../src/cli/commands/cli-input-reader.js'
import { updateEntryOptionsSchema } from '../../src/cli/schemas.js'
import { parseAutoContext } from '../../src/types/auto-context.js'
import { matchesAuditFilters, parseAuditLine } from '../../src/audit/audit-query-helpers.js'
import { parseGitProjectNumber, resolveGitWorkingDir } from '../../src/handlers/tools/git-workdir.js'
import { GitHistoryOptionsSchema } from '../../src/handlers/tools/git-schemas.js'
import { handleListDir } from '../../src/handlers/tools/core/dummy-healing/fs-fallbacks.js'
import { GetEntryByIdSchema, GetRecentEntriesSchema } from '../../src/handlers/tools/core/schemas.js'
import { SearchEntriesSchema, SemanticSearchSchema } from '../../src/handlers/tools/search/schemas.js'
import { TeamSemanticSearchSchema } from '../../src/handlers/tools/team/schemas/analytics-vector-schemas.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

afterEach(() => {
    vi.useRealTimers()
})

describe('Pass 84 Audit — High & Moderate Security/Correctness Regressions', () => {
    it('H1-H2: preserves stored content on partial updates and excludes internal/flag keys from create synthesis', () => {
        const partialUpdate: Record<string, unknown> = {
            entry_id: 5,
            resolution: 'Fixed',
            focus: 'auth',
            notes: 'partial note',
            findings: ['one'],
            context: { content: 'wrapped note' },
            tags: ['bugfix'],
        }
        synthesizeEntryMutationFields(partialUpdate, true)
        expect(partialUpdate['content']).toBeUndefined()
        expect(partialUpdate['tags']).toEqual(['bugfix'])

        const interceptedUpdate = applyGenericInterceptions('teamUpdateEntry', [
            { entry_id: 9, resolution: 'Fixed', summary: 'Summary only', tags: ['ops'] },
        ])
        expect('args' in interceptedUpdate).toBe(true)
        if ('args' in interceptedUpdate) {
            const first = interceptedUpdate.args[0] as Record<string, unknown>
            expect(first['content']).toBeUndefined()
        }

        const createObj: Record<string, unknown> = {
            context: { content: 'Create body' },
            resolution: 'Done',
        }
        synthesizeEntryMutationFields(createObj, false)
        expect(createObj['content']).toBe('Create body\n\n**Resolution:** Done')

        const normInternal = normalizeParams('createEntry', [
            { project_name: 'memory-journal-mcp', _alias_derived_workspace: true, use_test_db: true, _internal: 1 },
        ]) as Record<string, unknown>
        expect(normInternal['content']).toBeUndefined()
    })

    it('H3: enforces nested recursion depth, fast-path egress cap, snapshot bytes, and child timeout timer/RPC isolation', async () => {
        const vmCtx = vm.createContext(Object.create(null) as Record<string, unknown>)
        const executorAtDepthCap = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: vmCtx },
            timeoutMs: 1000,
            maxResultSize: 1024,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'memory-journal-mcp',
            pinnedProjectRaw: 5,
            projectRegistryRaw: undefined,
            nestedDepth: 4,
            runIsolatedNestedCode: async () => ({ ok: true }),
        })
        await expect(executorAtDepthCap('return 1')).rejects.toThrow(/maximum recursion depth/i)

        const executorLargeResult = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: vmCtx },
            timeoutMs: 1000,
            maxResultSize: 32,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'memory-journal-mcp',
            pinnedProjectRaw: 5,
            projectRegistryRaw: undefined,
            nestedDepth: 0,
            runIsolatedNestedCode: async () => ({ ok: true }),
        })
        await expect(executorLargeResult(`return "${'a'.repeat(128)}";`)).rejects.toThrow(
            /Output limit exceeded/i
        )

        const oversizedSnapRes = await executorLargeResult({
            code: 'return 1',
            context: { large: 'x'.repeat(140_000) },
        })
        expect(oversizedSnapRes).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(() => extractNestedContextRecord({ context: 'z'.repeat(140_000) })).toThrow(/exceeds maximum/i)

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        const rpcSpy = vi.fn(async () => ({ ok: true }))
        const parentTimers = new Set<NodeJS.Timeout>()
        const isolatedRunner = createIsolatedNestedRunner(
            {
                rpcFn: async () => ({}),
                sendRpcRequest: rpcSpy,
                methodList: { core: [] },
                schemaList: undefined,
                timeoutMs: 25,
                maxResultSize: 4096,
                contextObj: undefined,
                readonlyMode: false,
                dryRunMode: false,
                useTestDbMode: false,
                pinnedWorkspaceRaw: 'memory-journal-mcp',
                pinnedProjectRaw: 5,
                projectRegistryRaw: undefined,
                activeTimers: parentTimers,
                executionLifecycle: { ended: false, postCloseActivity: false },
            },
            rpcSpy,
            (opts) => {
                const timers = opts.activeTimers
                return vm.createContext({
                    scheduleLateRpc: () => {
                        const t = setTimeout(() => {
                            void opts.sendRpcRequest({ group: 'core', method: 'createEntry', args: [] }).catch(() => undefined)
                        }, 80)
                        timers.add(t)
                    },
                    hangForever: () => new Promise<void>(() => undefined),
                })
            }
        )
        const pendingRun = isolatedRunner(
            '(async () => { scheduleLateRpc(); return await hangForever(); })()',
            false,
            false,
            false
        )
        const outcomePromise = pendingRun.then(
            () => 'resolved',
            (err: unknown) => (err instanceof Error ? err.message : String(err))
        )
        await vi.advanceTimersByTimeAsync(30)
        expect(await outcomePromise).toMatch(/timed out after 25ms/i)
        await vi.advanceTimersByTimeAsync(200)
        expect(rpcSpy).not.toHaveBeenCalled()
        expect(parentTimers.size).toBe(0)
    })

    it('H4-H5 & A-M1: recovers source tool args, preserves blank update errors, flags, null clears, sibling args, and autoContext camelCase', () => {
        const importTool = resolveExecutionPayload(
            { tool: 'import_external', source: 'notion', source_dir: './imp' } as never,
            { tool: 'import_external', source: 'notion', source_dir: './imp' },
            true,
            0
        )
        expect('executionCode' in importTool).toBe(true)
        if ('executionCode' in importTool) {
            expect(importTool.executionCode).toContain('import_external')
            expect(importTool.executionCode).not.toBe('notion')
        }

        const blankUpdateId = resolveExecutionPayload(
            {} as never,
            { entry_id: '', title: 'T', content: 'C' },
            true,
            0
        )
        expect('executionCode' in blankUpdateId).toBe(true)
        if ('executionCode' in blankUpdateId) {
            expect(blankUpdateId.executionCode).toContain('updateEntry')
            expect(blankUpdateId.executionCode).toContain('"entry_id":""')
        }

        const flagsNl = resolveExecutionPayload(
            { content: 'Body' } as never,
            { content: 'Body', entry_id: 7, expected_version: '3', is_archived: true, auto_link: false },
            true,
            0
        )
        expect('executionCode' in flagsNl).toBe(true)
        if ('executionCode' in flagsNl) {
            expect(flagsNl.executionCode).toContain('"expected_version":3')
            expect(flagsNl.executionCode).toContain('"is_archived":true')
            expect(flagsNl.executionCode).toContain('"auto_link":false')
        }

        const delOps = resolveExecutionPayload(
            {} as never,
            { operation: 'delete', entry_id: 9, permanent: true, expected_version: 4 },
            true,
            0
        )
        expect('executionCode' in delOps).toBe(true)
        if ('executionCode' in delOps) {
            expect(delOps.executionCode).toContain('"permanent":true')
            expect(delOps.executionCode).toContain('"expected_version":4')
        }

        const readOps = resolveExecutionPayload(
            {} as never,
            { operation: 'get_entry_by_id', entry_id: 9, include_relationships: false, session_id: 's-1' },
            true,
            0
        )
        expect('executionCode' in readOps).toBe(true)
        if ('executionCode' in readOps) {
            expect(readOps.executionCode).toContain('"include_relationships":false')
            expect(readOps.executionCode).toContain('"session_id":"s-1"')
        }

        const archiveUpdate = resolveExecutionPayload({} as never, { entry_id: 9, is_archived: true }, true, 0)
        expect('executionCode' in archiveUpdate).toBe(true)
        if ('executionCode' in archiveUpdate) {
            expect(archiveUpdate.executionCode).toContain('mj.admin.updateEntry')
            expect(archiveUpdate.executionCode).toContain('"is_archived":true')
        }

        const nullClear = resolveExecutionPayload(
            {} as never,
            { operation: 'update', entry_id: 9, content: 'x', significance_type: null, session_id: null, auto_context: null },
            true,
            0
        )
        expect('executionCode' in nullClear).toBe(true)
        if ('executionCode' in nullClear) {
            expect(nullClear.executionCode).toContain('"significance_type":null')
            expect(nullClear.executionCode).toContain('"session_id":null')
            expect(nullClear.executionCode).toContain('"auto_context":null')
        }

        const namedSiblings = resolveExecutionPayload(
            {} as never,
            { tool: 'search.searchEntries', params: { query: 'abc' }, limit: 5 },
            true,
            0
        )
        expect('executionCode' in namedSiblings).toBe(true)
        if ('executionCode' in namedSiblings) {
            expect(namedSiblings.executionCode).toContain('"query":"abc"')
            expect(namedSiblings.executionCode).toContain('"limit":5')
        }

        const fuzzyCamel = extractAndRecoverEntryCode(
            'mj.admin.updateEntry({ entry_id: 3, content: "ok" expected_version: 2, isArchived: true, autoLink: true, autoContext: { commits: ["abcdef1"] } })'
        )
        expect(fuzzyCamel).not.toBeNull()
        if (fuzzyCamel !== null) {
            expect(fuzzyCamel).toContain('"expected_version":2')
            expect(fuzzyCamel).toContain('"is_archived":true')
            expect(fuzzyCamel).toContain('"auto_link":true')
            expect(fuzzyCamel).toContain('"commits":["abcdef1"]')
        }
    })

    it('H6 & D-M3/B-M1-M6/C-M1-M2/Revision: enforces CLI path bounds, strict schemas, vector pre-guards, and Pass 84 revision', async () => {
        expect(() => readBoundedCliInputFile('', 'script')).toThrow(/non-empty script path/i)
        expect(() => readBoundedCliInputFile('CON', 'script')).toThrow(/Unsafe script path/i)
        expect(() => readBoundedCliInputFile('foo.js:ads', 'script')).toThrow(/Unsafe script path/i)
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass84-'))
        try {
            const bigFile = path.join(tmpDir, 'big.js')
            fs.writeFileSync(bigFile, 'x'.repeat(256), 'utf8')
            expect(() => readBoundedCliInputFile(bigFile, 'script', 64)).toThrow(/exceeds maximum allowed size/i)
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }

        expect(updateEntryOptionsSchema.safeParse({ id: '0' }).success).toBe(false)
        expect(updateEntryOptionsSchema.safeParse({ expectedVersion: '-1' }).success).toBe(false)

        expect(parseAutoContext(JSON.stringify({ customKey: 'ok' }))).toEqual({ customKey: 'ok' })
        expect(parseAutoContext(JSON.stringify({ commits: new Array(501).fill('abcdef1') }))).toBeDefined()
        expect(parseAuditLine('{"tool":"x","timestamp":"2026-01-01","success":true,"workspaceId":123}')).toBeNull()
        expect(
            matchesAuditFilters(
                { tool: 'x', timestamp: '2026-01-01', success: true, requestId: 'r', category: 'read', scope: 'read', user: null, scopes: [], durationMs: 1 },
                { workspace_id: 'ws' }
            )
        ).toBe(false)

        expect(() => parseGitProjectNumber('')).toThrow(/Invalid project_number/i)
        expect(() => resolveGitWorkingDir({ cwd: '   ' })).toThrow(/Invalid cwd/i)
        await expect(handleListDir({ dir_path: '   ' }, 'list_dir')).resolves.toMatchObject({
            success: false,
            code: 'VALIDATION_ERROR',
        })

        const healedUnknownVs = healAgentHallucinations({
            entry_type: 'technical_note',
            content: 'ok',
            validation_status: 'typo',
        }) as Record<string, unknown>
        expect(healedUnknownVs['validation_status']).toBe('typo')

        expect(SearchEntriesSchema.safeParse({ project_number: 0 }).success).toBe(false)
        expect(SearchEntriesSchema.safeParse({ fts_weight: -1 }).success).toBe(false)
        expect(SemanticSearchSchema.safeParse({ similarity_threshold: 2 }).success).toBe(false)
        expect(TeamSemanticSearchSchema.safeParse({ similarity_threshold: -0.1 }).success).toBe(false)
        expect(GetEntryByIdSchema.safeParse({ entry_id: 0 }).success).toBe(false)
        expect(GetEntryByIdSchema.safeParse({ entry_id: 1, extraField: 1 }).success).toBe(false)
        expect(GetRecentEntriesSchema.safeParse({ limit: 5, extraField: 1 }).success).toBe(false)
        expect(GitHistoryOptionsSchema.safeParse({ maxCount: 5, extraField: 1 }).success).toBe(false)

        const memDb = new DatabaseAdapter(':memory:')
        await memDb.initialize()
        try {
            const vmMgr = new VectorSearchManager(memDb)
            const initSpy = vi.spyOn(vmMgr, 'initialize')
            const spySearch = vi.spyOn(memDb, 'searchVectors')
            expect(await vmMgr.search('   ')).toEqual([])
            expect(await vmMgr.search('ok', 10, Number.NaN)).toEqual([])
            expect(await vmMgr.searchByEntryId(1, 0)).toEqual([])
            expect(await vmMgr.searchByEntryId(1, 10, Number.POSITIVE_INFINITY)).toEqual([])
            await expect(vmMgr.searchByEntryId(0)).rejects.toThrow(/Entry 0 not found/i)
            expect(spySearch).not.toHaveBeenCalled()
            expect(initSpy).not.toHaveBeenCalled()

            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass84')
            expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass84')
            const def = getCodeQualityAuditPromptDefinition()
            const msg = await def.handler({}, memDb)
            expect(msg.messages[0]?.content.text).toContain(
                'defer full unit/E2E test suites until after two consecutive clean passes'
            )
        } finally {
            memDb.close()
        }
    })
})
