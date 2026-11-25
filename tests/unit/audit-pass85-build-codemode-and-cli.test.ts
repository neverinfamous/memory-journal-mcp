/**
 * Pass 85 Audit — Build Clean Race, Strict Code Mode Scope & Source Routing,
 * Nested Worker Lifecycle & Depth, Vector NaN Guards, CLI Validation & Host Guards.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import {
    createIsolatedNestedRunner,
    type VmExecutionContextOptions,
} from '../../src/codemode/worker/nested-exec-runner.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import type { ExecutionLifecycleState } from '../../src/codemode/worker/sandbox-globals.js'
import { extractAndRecoverRecordCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import {
    CreateEntrySchema,
    GetEntryByIdSchema,
} from '../../src/handlers/tools/core/schemas.js'
import { TeamDeleteEntrySchema } from '../../src/handlers/tools/team/schemas/admin-batch-schemas.js'
import { TeamGetEntryByIdSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { runPipelineBatchEmbeddingsSettled } from '../../src/vector/vector-search-manager/candidate-search.js'
import { clearSharedEmbeddingCache } from '../../src/vector/vector-search-manager/embedding-cache.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import {
    extractHealedEntryOptions,
    normalizeValidationStatus,
    resolveExplicitProjectAndWorkspace,
} from '../../src/cli/commands/entry-payload-helpers.js'
import {
    extractUpdateEntryCliOptions,
    validateCliUpdateArgsAndTarget,
} from '../../src/cli/commands/entry-update-helpers.js'
import { resolveImportWriteScope } from '../../src/cli/commands/io.js'
import { safeCoerceValidationStatus } from '../../src/cli/schemas.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import type { CliCommandLike } from '../../src/utils/config-resolver.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

function parseCallArgs(code: string, fnPrefix?: string): Record<string, unknown> {
    const trimmed = code.trim()
    if (fnPrefix !== undefined) {
        const re = new RegExp(`^return await ${fnPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(([\\s\\S]*)\\);$`)
        const m = re.exec(trimmed)
        expect(m, `Expected ${fnPrefix}(...) in: ${code}`).not.toBeNull()
        return JSON.parse(m?.[1] ?? '{}') as Record<string, unknown>
    }
    const openParen = trimmed.indexOf('(')
    const closeSuffix = ');'
    expect(openParen).toBeGreaterThan(-1)
    expect(trimmed.endsWith(closeSuffix)).toBe(true)
    return JSON.parse(trimmed.slice(openParen + 1, -closeSuffix.length)) as Record<string, unknown>
}

function makeCliCommand(providedKeys: string[] = []): CliCommandLike {
    const provided = new Set(providedKeys)
    return {
        name: () => 'serve',
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    }
}

afterEach(() => {
    clearSharedEmbeddingCache()
})

describe('Pass 85 Audit — Build, Code Mode, Worker, Vector & CLI Hardening', () => {
    it('P6-D-H1: pre-cleans dist once before tsup and sets clean: false across multi-config bundles', async () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.resolve('package.json'), 'utf8')
        ) as { scripts: Record<string, string> }
        expect(pkg.scripts['build:js']).toContain('rmSync')
        expect(pkg.scripts['build:js']).toContain('tsup')

        const mod = (await import('../../tsup.config.js')) as {
            default: { clean?: boolean; splitting?: boolean; entry?: Record<string, string> }[]
        }
        expect(Array.isArray(mod.default)).toBe(true)
        for (const cfg of mod.default) {
            expect(cfg.clean).toBe(false)
        }
    })

    it('P6-A-H1: aligns get/teamDelete extra fields to strict schemas and routes { entry_id, source } safely', () => {
        const getPersonalWithSess = extractAndRecoverRecordCode({
            operation: 'get_entry_by_id',
            entry_id: 9,
            include_relationships: false,
            source: 'team',
            session_id: 's-1',
        })
        expect(getPersonalWithSess).not.toBeNull()
        const getParams = parseCallArgs(getPersonalWithSess ?? '', 'mj.core.getEntryById')
        expect(getParams).toEqual({
            entry_id: 9,
            include_relationships: false,
            source: 'team',
        })
        expect(GetEntryByIdSchema.safeParse(getParams).success).toBe(true)

        const teamGet = extractAndRecoverRecordCode({
            operation: 'team_get_entry_by_id',
            entry_id: 12,
            include_relationships: false,
            session_id: 's-1',
            source: 'team',
        })
        const teamGetParams = parseCallArgs(teamGet ?? '', 'mj.team.teamGetEntryById')
        expect(teamGetParams).toEqual({
            entry_id: 12,
            include_relationships: false,
        })
        expect(TeamGetEntryByIdSchema.safeParse(teamGetParams).success).toBe(true)

        const teamDel = extractAndRecoverRecordCode({
            operation: 'team_delete_entry',
            entry_id: 14,
            expected_version: 2,
            permanent: true,
        })
        const teamDelParams = parseCallArgs(teamDel ?? '', 'mj.team.teamDeleteEntry')
        expect(teamDelParams).toEqual({
            entry_id: 14,
            expected_version: 2,
        })
        expect(TeamDeleteEntrySchema.safeParse(teamDelParams).success).toBe(true)

        const flatSourceRead = resolveExecutionPayload(
            { source: 'team' } as never,
            { entry_id: 5, source: 'team' },
            true,
            0
        )
        expect('executionCode' in flatSourceRead).toBe(true)
        if ('executionCode' in flatSourceRead) {
            const parsed = parseCallArgs(flatSourceRead.executionCode, 'mj.core.getEntryById')
            expect(parsed).toEqual({ entry_id: 5, source: 'team' })
        }

        const aliasObj: Record<string, unknown> = { entry_id: 5, source: 'team' }
        normalizeExecuteCodeAliases(aliasObj)
        expect(aliasObj['code']).toBeUndefined()
    })

    it('P6-A-H2: cleans up nested child lifecycles before egress/parent teardown and tracks concurrent/escalated depth cleanly', async () => {
        const outerTimers = new Set<NodeJS.Timeout>()
        const outerLifecycle: ExecutionLifecycleState = {
            ended: false,
            postCloseActivity: false,
            childCleanups: new Set<() => void>(),
        }
        const rpcSpy = vi.fn().mockResolvedValue({ ok: true })
        const makeOpts = (
            sendRpcRequest: VmExecutionContextOptions['sendRpcRequest'],
            nestedDepth = 0
        ): VmExecutionContextOptions => ({
            rpcFn: (group, method, args) => sendRpcRequest({ group, method, args }),
            sendRpcRequest,
            methodList: { core: ['getStatistics'] },
            schemaList: undefined,
            timeoutMs: 1000,
            maxResultSize: 10_000,
            contextObj: undefined,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'memory-journal-mcp',
            pinnedProjectRaw: 5,
            projectRegistryRaw: undefined,
            activeTimers: outerTimers,
            executionLifecycle: outerLifecycle,
            nestedDepth,
        })

        // 1. Unawaited child timer/RPC is cleaned up when parent tears down
        let releaseChild: (() => void) | undefined
        const pendingRpc = vi.fn(
            () =>
                new Promise<unknown>((resolve) => {
                    releaseChild = () => resolve({ ok: true })
                })
        )
        let capturedSendRpc: VmExecutionContextOptions['sendRpcRequest'] | undefined
        const isolatedPendingRunner = createIsolatedNestedRunner(
            makeOpts(pendingRpc),
            pendingRpc,
            (vmOpts) => {
                capturedSendRpc = vmOpts.sendRpcRequest
                return vm.createContext({
                    setTimeout: (cb: () => void, ms: number) => {
                        const t = setTimeout(cb, ms)
                        vmOpts.activeTimers.add(t)
                        return t
                    },
                    waitForever: () =>
                        vmOpts.sendRpcRequest({ group: 'core', method: 'getStatistics', args: [] }),
                })
            }
        )
        const danglingPromise = isolatedPendingRunner(
            '"use strict";\n(async () => {\nsetTimeout(() => {}, 5000); return await waitForever();\n})()',
            false,
            false,
            false
        )
        await Promise.resolve()
        expect(outerLifecycle.childCleanups?.size).toBe(1)
        for (const fn of outerLifecycle.childCleanups ?? []) fn()
        outerLifecycle.ended = true
        expect(outerLifecycle.childCleanups?.size).toBe(0)
        await expect(
            capturedSendRpc?.({ group: 'core', method: 'getStatistics', args: [] })
        ).rejects.toThrow(/already ended/i)
        releaseChild?.()
        await danglingPromise.catch(() => undefined)

        // 2. [M11] Child lifecycle closes BEFORE enforceNestedResultLimit runs untrusted toJSON()
        outerLifecycle.ended = false
        outerLifecycle.childCleanups?.clear()
        let toJsonRpcError = ''
        const egressRunner = createIsolatedNestedRunner(
            makeOpts(rpcSpy),
            rpcSpy,
            (vmOpts) =>
                vm.createContext({
                    callAfterEnd: () => {
                        void vmOpts
                            .sendRpcRequest({ group: 'core', method: 'getStatistics', args: [] })
                            .catch((err: unknown) => {
                                toJsonRpcError = err instanceof Error ? err.message : String(err)
                            })
                    },
                })
        )
        const egressRes = await egressRunner(
            '"use strict";\n(async () => {\nreturn { toJSON() { callAfterEnd(); return { safe: true }; } };\n})()',
            false,
            false,
            false
        )
        await Promise.resolve()
        expect(egressRes).toEqual({ safe: true })
        expect(rpcSpy).not.toHaveBeenCalled()
        expect(toJsonRpcError).toContain('already ended')

        // 3. Parallel Promise.all fast-path siblings succeed while true depth recursion & escalation caps fail
        const runEscalated = vi.fn().mockResolvedValue('escalated-ok')
        const vmCtx = vm.createContext(Object.create(null) as Record<string, unknown>)
        const exec = createSandboxExecutor({
            shimMj: {},
            vmContextRef: { current: vmCtx },
            timeoutMs: 1000,
            maxResultSize: 10_000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: undefined,
            runIsolatedNestedCode: runEscalated,
            activeTimers: new Set(),
        })
        vmCtx['nestedExec'] = exec
        const parallelResults = await Promise.all([
            exec('return 1'),
            exec('return 2'),
            exec('return 3'),
            exec('return 4'),
            exec('return 5'),
        ])
        expect(parallelResults).toEqual([1, 2, 3, 4, 5])

        await exec(
            'return await nestedExec("return await nestedExec(\\"return await nestedExec({ code: \'return 1\', readonly: true })\\")")'
        )
        expect(runEscalated).toHaveBeenCalledWith(
            expect.any(String),
            true,
            false,
            false,
            expect.objectContaining({ nestedDepth: 3 })
        )

        await expect(
            exec(
                'return await nestedExec("return await nestedExec(\\"return await nestedExec(\\\\\\"return await nestedExec(\\\\\\\\\\\\\\"return 99\\\\\\\\\\\\\\")\\\\\\")\\")")'
            )
        ).rejects.toThrow(/maximum recursion depth/i)
    })

    it('P6-A-M3/M4/M5/L6: isolates named-call outer scope, preserves auto_context/significance clear, rejects bad validation_status, keeps compound SQL, and recovers description', () => {
        const named = extractAndRecoverRecordCode({
            tool: 'core.getEntryById',
            workspace_id: 'repo-outer',
            project_number: 5,
            params: { entry_id: 7, workspace_id: 'repo-inner' },
        })
        const namedParams = parseCallArgs(
            named ?? '',
            '(mj.core.getEntryById || mj.core.core.getEntryById)'
        )
        expect(namedParams['workspace_id']).toBe('repo-inner')
        expect(namedParams['project_number']).toBeUndefined()

        const nlBadVal = resolveExecutionPayload(
            {
                code: 'Document the release notes clearly',
                entry_id: 4,
                significance_type: null,
                validation_status: 'bogus_val',
                auto_context: { sha: 'abc1234' },
                component: 'auth',
            } as never,
            {
                code: 'Document the release notes clearly',
                entry_id: 4,
                significance_type: null,
                validation_status: 'bogus_val',
                auto_context: { sha: 'abc1234' },
                component: 'auth',
            },
            true,
            0
        )
        expect('executionCode' in nlBadVal).toBe(true)
        if ('executionCode' in nlBadVal) {
            const parsed = parseCallArgs(nlBadVal.executionCode, 'mj.updateEntry')
            expect(parsed['significance_type']).toBeNull()
            expect(parsed['validation_status']).toBe('bogus_val')
            expect(parsed['auto_context']).toEqual({ component: 'auth', sha: 'abc1234' })
            expect(CreateEntrySchema.safeParse({ content: 'x', validation_status: parsed['validation_status'] }).success).toBe(false)
        }

        const genericBadVal = applyGenericInterceptions('other_tool', [{ validation_status: 'not_real' }])
        if ('args' in genericBadVal) {
            expect((genericBadVal.args[0] as Record<string, unknown>)['validation_status']).toBe('not_real')
        }

        expect(
            extractAndRecoverSqlCode("SELECT * FROM memory_journal WHERE id = 5 AND content LIKE '%foo%'")
        ).toBeNull()

        const descPayload = resolveExecutionPayload(
            {} as never,
            { title: 'Title Only', description: 'Recovered description text' },
            true,
            0
        )
        expect('executionCode' in descPayload).toBe(true)
        if ('executionCode' in descPayload) {
            const parsed = parseCallArgs(descPayload.executionCode, 'mj.createEntry')
            expect(parsed['title']).toBe('Title Only')
            expect(parsed['content']).toBe('Recovered description text')
        }
    })

    it('P6-C-M1/L2: rejects non-finite batch tensors and never caches non-finite or mismatched embeddings', async () => {
        const goodFallback = vi.fn(async () => new Float32Array([0.1, 0.2, 0.3]))
        const nanBatchPipeline = vi.fn(async () => ({
            data: new Float32Array([0.1, Number.NaN, 0.3, 0.4, 0.5, 0.6]),
            dims: [2, 3],
        }))
        const settledBatch = await runPipelineBatchEmbeddingsSettled(
            nanBatchPipeline,
            ['first', 'second'],
            3,
            goodFallback
        )
        expect(goodFallback).toHaveBeenCalledTimes(2)
        expect(settledBatch.every((r) => r.status === 'fulfilled' && r.value.every(Number.isFinite))).toBe(true)

        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const vmMgr = new VectorSearchManager(adapter, { modelName: 'test-model-p85' })
            vi.spyOn(vmMgr, 'initialize').mockResolvedValue(undefined)
            let callCount = 0
            const fakePipeline = vi.fn(async () => {
                callCount++
                return {
                    data: callCount === 1
                        ? new Float32Array([Number.NaN, 0.5, 0.5])
                        : new Float32Array([0.2, 0.4, 0.8]),
                }
            })
            Reflect.set(vmMgr, 'ready', true)
            Reflect.set(vmMgr, 'dimensions', 3)
            Reflect.set(vmMgr, 'pipeline', fakePipeline)
            Reflect.set(vmMgr, 'transformers', { pipeline: vi.fn(), env: {} })

            await expect(vmMgr.generateEmbedding('cache-poison-query')).rejects.toThrow(/non-finite/i)
            const secondVec = await vmMgr.generateEmbedding('cache-poison-query')
            expect(callCount).toBe(2)
            expect(Array.from(secondVec).map((n) => Math.round(n * 10))).toEqual([2, 4, 8])
        } finally {
            adapter.close()
        }
    })

    it('P6-D-M2/M3/M4: fails closed on blank --workspace/--server-host and invalid CLI validationStatus', () => {
        expect(() =>
            resolveExplicitProjectAndWorkspace({ workspace: '   ' } as never, {})
        ).toThrow(/cannot be blank/i)
        expect(() =>
            validateCliUpdateArgsAndTarget({ id: 1, expectedVersion: 1, workspace: '  ' } as never)
        ).toThrow(/cannot be blank/i)
        expect(() =>
            resolveImportWriteScope({ dir: os.tmpdir(), workspace: '   ' }, { projectRegistry: {} })
        ).toThrow(/cannot be blank/i)

        expect(safeCoerceValidationStatus.safeParse('bogus').success).toBe(false)
        expect(() => normalizeValidationStatus('bogus')).toThrow(/Invalid validation_status/i)
        expect(() => extractHealedEntryOptions({ validationStatus: 'bogus' })).toThrow(
            /Invalid validation_status/i
        )
        expect(() =>
            extractUpdateEntryCliOptions({ id: 1, expectedVersion: 1, validationStatus: 'bogus' })
        ).toThrow(/Invalid validation_status/i)

        const tmpCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p85-host-'))
        const tmpCfgPath = path.join(tmpCfgDir, 'config.json')
        fs.writeFileSync(tmpCfgPath, '{}', 'utf8')
        try {
            const blankHostCmd = makeCliCommand(['serverHost'])
            const blankHostResolver = new ConfigResolver(
                blankHostCmd,
                { serverHost: '   ' },
                tmpCfgPath
            )
            const configErrors: string[] = []
            buildServerOptions(blankHostResolver, {}, blankHostCmd, configErrors)
            expect(configErrors.some((e) => /blank --server-host/i.test(e))).toBe(true)

            process.env['HOST'] = '   '
            const emptyEnvCmd = makeCliCommand([])
            const emptyEnvResolver = new ConfigResolver(emptyEnvCmd, {}, tmpCfgPath)
            const envErrs: string[] = []
            const built = buildServerOptions(emptyEnvResolver, {}, emptyEnvCmd, envErrs)
            expect(envErrs).toEqual([])
            expect(built.host).toBeUndefined()
        } finally {
            fs.rmSync(tmpCfgDir, { recursive: true, force: true })
        }
    })

    it('bumps AUDIT_PROMPT_REVISION to Pass 85', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
        const def = getCodeQualityAuditPromptDefinition()
        expect(def.name).toBe('adversarial-audit-code-quality')
    })
})
