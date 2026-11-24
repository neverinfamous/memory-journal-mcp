/**
 * Pass 87 Audit — Linear Recovery Scanners, Code Mode Scope Isolation, Nested Lifecycle,
 * Git Schema Alias Stripping, Audit/Lifecycle Guards, SQLite/Vector Concurrency, & CLI Precedence.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    extractAndRecoverEntryCode,
    extractAndRecoverRecordCode,
} from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/project-alias-helpers.js'
import { enrichEntryRecord } from '../../src/codemode/api/cross-group-aliases.js'
import { createIsolatedNestedRunner } from '../../src/codemode/worker/nested-exec-runner.js'
import type { ExecutionLifecycleState } from '../../src/codemode/worker/sandbox-globals.js'
import {
    GitHistoryOptionsSchema,
    GitHistoryOptionsSchemaMcp,
    GitSearchOptionsSchema,
    GitSearchOptionsSchemaMcp,
} from '../../src/handlers/tools/git-schemas.js'
import { buildUnverifiedSnippet } from '../../src/handlers/prompts/optimizer-snippets.js'
import { fenceEnrichedCommits } from '../../src/handlers/resources/template-helpers.js'
import { getMiscTools } from '../../src/handlers/tools/admin/misc-tools.js'
import { getLifecycleTools } from '../../src/handlers/tools/admin/lifecycle-tools.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { upsertEntryChunksSequentially } from '../../src/vector/vector-search-manager/candidate-search.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/manager.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { resolveAuthTokenOption } from '../../src/cli/server-options-groups.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'

function makeCliCommand(providedKeys: string[] = []): CliCommandLike {
    const provided = new Set(providedKeys)
    return {
        name: () => 'serve',
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    }
}

function withScopedRegistry(
    registry: Record<string, { project_number: number }>,
    fn: () => void
): void {
    const snap = captureActiveProjectRegistryState()
    setActiveProjectRegistry(registry)
    try {
        fn()
    } finally {
        restoreActiveProjectRegistryState(snap)
    }
}

describe('Pass 87 Audit — High, Moderate & Low Regressions', () => {
    const tempDirs: string[] = []
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
        vi.restoreAllMocks()
    })

    it('P8-A-H1: scans unclosed content fields linearly without ReDoS stall', () => {
        const adversarial = `mj.createEntry({ content: "${' '.repeat(32000)}abc`
        const start = performance.now()
        const recoveredNull = extractAndRecoverEntryCode(adversarial)
        const elapsedMs = performance.now() - start
        expect(recoveredNull).toBeNull()
        expect(elapsedMs).toBeLessThan(100)

        const recoverable = 'mj.createEntry({ content: "hello world   , workspace_id: "ws-recovered" })'
        const recovered = extractAndRecoverEntryCode(recoverable)
        expect(recovered).toContain('"content":"hello world"')
        expect(recovered).toContain('"workspace_id":"ws-recovered"')
    })

    it('P8-A-M1 & P8-A-L1: context structured recovery isolates outer scope, strips outer target_workspace_id, and keeps unregistered repo', () => {
        const reg = { wsA: { project_number: 5 }, repoB: { project_number: 8 } }
        withScopedRegistry(reg, () => {
            const ctxPayload = resolveExecutionPayload(
                {
                    workspace_id: 'wsA',
                    project_number: 5,
                    context: { repo: 'repoB', operation: 'search', query: 'audit' },
                } as never,
                {
                    workspace_id: 'wsA',
                    project_number: 5,
                    context: { repo: 'repoB', operation: 'search', query: 'audit' },
                },
                true,
                performance.now()
            )
            expect('executionCode' in ctxPayload).toBe(true)
            const code = 'executionCode' in ctxPayload ? ctxPayload.executionCode : ''
            expect(code).toContain('"workspace_id":"repoB"')
            expect(code).not.toContain('"workspace_id":"wsA"')
            expect(code).not.toContain('"project_number":5')
        })

        const noTargetLeak = extractAndRecoverRecordCode({
            workspace_id: 'wsA',
            target_workspace_id: 'wsB',
            payload: {
                tool: 'updateEntry',
                params: { entry_id: 5, workspace_id: 'wsC', content: 'x' },
            },
        })
        expect(noTargetLeak).not.toContain('target_workspace_id')
        expect(noTargetLeak).not.toContain('wsB')

        const keepUnregRepo = extractAndRecoverRecordCode({
            tool: 'github.getRepoInfo',
            repo: 'owner/unregistered-repo',
            params: { branch: 'main' },
        })
        expect(keepUnregRepo).toContain('"repo":"owner/unregistered-repo"')
    })

    it('P8-A-M2: nested child postCloseActivity propagates to parent executionLifecycle', async () => {
        const parentLifecycle: ExecutionLifecycleState = {
            ended: false,
            postCloseActivity: false,
            childCleanups: new Set(),
        }
        const capturedLifecycles: ExecutionLifecycleState[] = []
        const runner = createIsolatedNestedRunner(
            {
                mjApi: {},
                shimMj: {},
                safeFsShim: {} as never,
                frozenContext: {},
                executeCodeFn: async () => undefined,
                updateMemoryFn: () => undefined,
                timeoutMs: 2000,
                maxResultSizeBytes: 65536,
                registry: {},
                executionLifecycle: parentLifecycle,
                nestedDepth: 0,
            } as never,
            async () => ({ ok: true }),
            (opts) => {
                if (opts.executionLifecycle !== undefined) {
                    capturedLifecycles.push(opts.executionLifecycle)
                }
                return vm.createContext({})
            }
        )
        const val = await runner('1 + 1', false, false, false)
        expect(val).toBe(2)
        expect(capturedLifecycles).toHaveLength(1)
        const child = capturedLifecycles[0]
        expect(child?.ended).toBe(true)
        if (child !== undefined) child.postCloseActivity = true
        expect(parentLifecycle.postCloseActivity).toBe(true)
    })

    it('P8-A-M3, M4 & M5: batch item repo isolation, fuzzy repo alias recovery, and balanced bracket arrays', () => {
        const itemReg: Record<string, unknown> = { repo: 'repoB', content: 'for B' }
        enrichEntryRecord(itemReg, () => ({ repoB: { project_number: 8 } }), 'wsA', 5)
        expect(itemReg['workspace_id']).toBe('repoB')
        expect(itemReg['project_number']).toBe(8)

        const itemUnreg: Record<string, unknown> = { repo: 'repoUnreg', content: 'for U' }
        enrichEntryRecord(itemUnreg, () => ({ wsA: { project_number: 5 } }), 'wsA', 5)
        expect(itemUnreg['workspace_id']).toBeUndefined()
        expect(itemUnreg['project_number']).toBeUndefined()

        withScopedRegistry({ repoB: { project_number: 8 } }, () => {
            const recovered = extractAndRecoverEntryCode(
                `mj.createEntry({ repo: 'repoB', content: 'unclosed prose   , anchors: [{"anchor_path":"src/foo[0].ts","anchor_type":"file"}] })`
            )
            expect(recovered).not.toBeNull()
            expect(recovered).toContain('"workspace_id":"repoB"')
            expect(recovered).toContain('src/foo[0].ts')
        })
    })

    it('P8-B-M1: git history/search MCP transforms strip alias keys cleanly for inner .strict() schemas', () => {
        const histParsed = GitHistoryOptionsSchemaMcp.parse({
            maxCount: 10,
            limit: 10,
            sort_by: 'impact',
            tech_debt_audit: true,
        })
        const histStrict = GitHistoryOptionsSchema.parse(histParsed)
        expect(histStrict.maxCount).toBe(10)
        expect(histStrict.sortBy).toBe('impact')
        expect(histStrict.techDebtAudit).toBe(true)

        const searchParsed = GitSearchOptionsSchemaMcp.parse({
            query: 'fix',
            max_count: 5,
            sort_by: 'date',
            tech_debt_audit: false,
        })
        const searchStrict = GitSearchOptionsSchema.parse(searchParsed)
        expect(searchStrict.query).toBe('fix')
        expect(searchStrict.maxCount).toBe(5)
        expect(searchStrict.sortBy).toBe('date')
    })

    it('P8-B-M2: optimizer snippets and commit resources truncate untrusted text before fencing', () => {
        const fakeDb = {
            getRecentEntries: () => ({
                entries: [
                    {
                        id: 1,
                        entryType: 'technical_note',
                        tags: ['t'],
                        trustScore: 0.2,
                        impactScore: 0.5,
                        validationStatus: 'none',
                        content: 'a'.repeat(3000),
                    },
                ],
            }),
        } as unknown as Parameters<typeof buildUnverifiedSnippet>[0]
        const snippet = buildUnverifiedSnippet(fakeDb, 10)
        expect(snippet.length).toBeLessThan(1500)
        expect(snippet).toContain('... [truncated]')

        const fenced = fenceEnrichedCommits([
            {
                hash: 'abc1234',
                subject: 'subj',
                body: 'b'.repeat(6000),
                authorName: 'alice',
                authorEmail: 'a@example.com',
                date: '2026-01-01',
                references: [],
            },
        ])
        expect(fenced[0]?.body?.length ?? 0).toBeLessThan(4300)
        expect(fenced[0]?.body).toContain('... [truncated]')
    })

    it('P8-B-M3 & P8-B-L1: search_audit_log validates dates/scope and run_auto_prune rejects blank workspace_id', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const mockSearch = vi.fn().mockResolvedValue([])
            const ctx = {
                db: adapter,
                config: {
                    projectRegistry: { wsA: { project_number: 5 } },
                    runtime: { auditLogger: { search: mockSearch } },
                },
            } as unknown as Parameters<typeof getMiscTools>[0]
            const auditTool = getMiscTools(ctx).find((t) => t.name === 'search_audit_log')

            const badCal = (await auditTool?.handler({
                date_range: { start: '2026-02-31' },
            })) as { success: boolean; code?: string }
            expect(badCal.success).toBe(false)
            expect(badCal.code).toBe('VALIDATION_ERROR')

            const reversed = (await auditTool?.handler({
                start_date: '2026-12-01',
                end_date: '2026-01-01',
            })) as { success: boolean; code?: string }
            expect(reversed.success).toBe(false)
            expect(reversed.code).toBe('VALIDATION_ERROR')

            const mismatch = (await auditTool?.handler({
                workspace_id: 'wsA',
                project_number: 99,
            })) as { success: boolean; code?: string }
            expect(mismatch.success).toBe(false)
            expect(mismatch.code).toBe('VALIDATION_ERROR')

            const pruneTool = getLifecycleTools(ctx).find((t) => t.name === 'run_auto_prune')
            const blankPrune = (await pruneTool?.handler({
                workspace_id: '   ',
                dry_run: true,
            })) as { success: boolean; code?: string }
            expect(blankPrune.success).toBe(false)
            expect(blankPrune.code).toBe('VALIDATION_ERROR')
        } finally {
            adapter.close()
        }
    })

    it('P8-C-M1, M2, M3 & P8-C-L2: NativeConnectionManager epoch guard, chunked addEntries, serialized rebuildIndex, and self-loop rejection', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p87-db-'))
        tempDirs.push(tmpDir)
        const nestedDbPath = path.join(tmpDir, 'nonexistent-sub', 'test.db')
        let resolveMkdir!: (v: string | undefined) => void
        const mkdirGate = new Promise<string | undefined>((resolve) => {
            resolveMkdir = resolve
        })
        const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockImplementation(async () => mkdirGate)
        const connMgr = new NativeConnectionManager(nestedDbPath)
        const initPromise = connMgr.initialize()
        await Promise.resolve()
        connMgr.close()
        resolveMkdir(undefined)
        await expect(initPromise).rejects.toThrow(/closed during initialization/i)
        mkdirSpy.mockRestore()

        const batchSizes: number[] = []
        const upsertedCounts: number[] = []
        const fakeEntries = Array.from({ length: 120 }, (_, i) => ({
            id: i + 1,
            entryType: 'technical_note' as const,
            content: `item ${String(i + 1)}`,
            timestamp: '2026-01-01T00:00:00Z',
            isPersonal: true,
        }))
        await upsertEntryChunksSequentially(
            fakeEntries,
            50,
            async (texts) => {
                batchSizes.push(texts.length)
                return texts.map(() => ({ status: 'fulfilled' as const, value: new Float32Array(4) }))
            },
            (items) => {
                upsertedCounts.push(items.length)
            },
            () => undefined
        )
        expect(batchSizes).toEqual([50, 50, 20])
        expect(upsertedCounts).toEqual([50, 50, 20])

        const events: string[] = []
        let releaseFirst!: () => void
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const fakeAdapter = new DatabaseAdapter(':memory:')
        await fakeAdapter.initialize()
        try {
            const vmMgr = new VectorSearchManager(fakeAdapter)
            let calls = 0
            vi.spyOn(vmMgr, 'initialize').mockImplementation(async () => {
                calls++
                events.push(`start-${String(calls)}`)
                if (calls === 1) await firstGate
                events.push(`end-${String(calls)}`)
            })
            const r1 = vmMgr.rebuildIndex()
            const r2 = vmMgr.rebuildIndex()
            await Promise.resolve()
            expect(events).toEqual(['start-1'])
            releaseFirst()
            await Promise.all([r1, r2])
            expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])

            expect(() => fakeAdapter.linkEntries(1, 1, 'references')).toThrow(
                /self-referential/i
            )
        } finally {
            fakeAdapter.close()
        }
    })

    it('P8-D-M1..M4: enforces CLI > Env > Config for defaultWorkspaceId and fails closed on blank authToken/toolFilter/IO/DB/JWKS', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p87-cli-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')

        fs.writeFileSync(cfgFile, JSON.stringify({ workspace: 'projA' }), 'utf8')
        const cliOverCfgCmd = makeCliCommand(['defaultWorkspaceId'])
        const cliErrs: string[] = []
        const cliBuilt = buildServerOptions(
            new ConfigResolver(cliOverCfgCmd, { defaultWorkspaceId: 'wsB' }, cfgFile),
            {},
            cliOverCfgCmd,
            cliErrs
        )
        expect(cliErrs).toEqual([])
        expect(cliBuilt.serverOptions.defaultWorkspaceId).toBe('wsB')

        process.env['DEFAULT_WORKSPACE_ID'] = 'wsEnv'
        try {
            const envCmd = makeCliCommand([])
            const envErrs: string[] = []
            const envBuilt = buildServerOptions(
                new ConfigResolver(envCmd, {}, cfgFile),
                {},
                envCmd,
                envErrs
            )
            expect(envErrs).toEqual([])
            expect(envBuilt.serverOptions.defaultWorkspaceId).toBe('wsEnv')
        } finally {
            delete process.env['DEFAULT_WORKSPACE_ID']
        }

        fs.writeFileSync(cfgFile, JSON.stringify({ workspace: '   ', authToken: '   ' }), 'utf8')
        const blankCfgCmd = makeCliCommand([])
        const blankCfgErrs: string[] = []
        buildServerOptions(new ConfigResolver(blankCfgCmd, {}, cfgFile), {}, blankCfgCmd, blankCfgErrs)
        expect(blankCfgErrs.some((e) => /workspace/i.test(e))).toBe(true)
        expect(blankCfgErrs.some((e) => /Authentication token/i.test(e))).toBe(true)
        expect(() => resolveAuthTokenOption(new ConfigResolver(blankCfgCmd, {}, cfgFile))).toThrow(
            /cannot be empty or whitespace-only/i
        )

        fs.writeFileSync(cfgFile, JSON.stringify({ authToken: '' }), 'utf8')
        expect(resolveAuthTokenOption(new ConfigResolver(blankCfgCmd, {}, cfgFile))).toBeUndefined()
        const emptyCliTokenCmd = makeCliCommand(['authToken'])
        expect(() =>
            resolveAuthTokenOption(new ConfigResolver(emptyCliTokenCmd, { authToken: '' }, cfgFile))
        ).toThrow(/cannot be empty/i)

        fs.writeFileSync(cfgFile, '{}', 'utf8')
        const blankCliCmd = makeCliCommand([
            'toolFilter',
            'allowedIoRoots',
            'additionalTeamDbs',
            'oauthJwksUri',
        ])
        const blankCliErrs: string[] = []
        buildServerOptions(
            new ConfigResolver(
                blankCliCmd,
                {
                    toolFilter: '   ',
                    allowedIoRoots: ' , ',
                    additionalTeamDbs: '',
                    oauthJwksUri: '   ',
                },
                cfgFile
            ),
            {},
            blankCliCmd,
            blankCliErrs
        )
        expect(blankCliErrs.some((e) => /--tool-filter/i.test(e))).toBe(true)
        expect(blankCliErrs.some((e) => /ALLOWED_IO_ROOTS/i.test(e))).toBe(true)
        expect(blankCliErrs.some((e) => /ADDITIONAL_TEAM_DBS/i.test(e))).toBe(true)
        expect(blankCliErrs.some((e) => /--oauth-jwks-uri/i.test(e))).toBe(true)
    })

    it('bumps AUDIT_PROMPT_REVISION to Pass 87', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass89')
    })
})
