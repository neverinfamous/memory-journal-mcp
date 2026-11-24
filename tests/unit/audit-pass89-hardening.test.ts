/**
 * Pass 89 Audit — Remediations for Pass 10 Findings across Subsystems A–D.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { createScopedRpcCall } from '../../src/codemode/worker/nested-exec-runner.js'
import { applyBatchAndMutationInterceptions } from '../../src/codemode/normalizers/batch-mutation-interceptions.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'
import { prepareBatchDispatch } from '../../src/handlers/tools/codemode/dispatch-batch-scope.js'
import { validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import {
    findWildcardProjectMismatches,
    safeDeleteVectors,
} from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import {
    BatchCreateEntriesSchema,
    BatchDeleteEntriesSchema,
    BatchUpdateEntriesSchema,
} from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { TeamBatchDeleteEntriesSchema } from '../../src/handlers/tools/team/schemas/admin-batch-schemas.js'
import { sanitizeRemoteUrl } from '../../src/utils/security-utils.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import { createGitHubContextTool } from '../../src/handlers/tools/github/context-tool.js'
import { getMiscSearchTools } from '../../src/handlers/tools/search/misc-tools.js'
import { resolveWorkspaceId } from '../../src/utils/workspace-resolver.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { createVectorManagers } from '../../src/server/mcp-server/initialization-helpers.js'
import { createServer } from '../../src/server/mcp-server/core.js'
import { HttpTransport } from '../../src/transports/http/index.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { execAction } from '../../src/cli/commands/exec.js'
import { importExternalAction, importMarkdownAction } from '../../src/cli/commands/io.js'
import { searchAction } from '../../src/cli/commands/search.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import type { ToolDefinition } from '../../src/types/index.js'

function makeCliCommand(name: string, providedKeys: string[] = []): Command {
    const provided = new Set(providedKeys)
    return {
        name: () => name,
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    } as unknown as Command
}

describe('Pass 89 Audit — Pass 10 Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
        process.exitCode = undefined
        vi.restoreAllMocks()
    })

    it('P10-A-H1: nested executeCode fast-path and shortcut propagate rpcOverrides to enforce validateRpcOverrideBounds', async () => {
        const sentPayloads: {
            group: string
            method: string
            args: unknown[]
            workspaceId?: string
            projectNumber?: number
        }[] = []
        const sendRpcRequest = vi.fn(async (payload) => {
            sentPayloads.push(payload)
            return { success: true }
        })
        const rpcFn = createScopedRpcCall(sendRpcRequest)
        const shimMj = {
            core: {
                createEntry: (...args: unknown[]) => rpcFn('core', 'createEntry', args),
            },
            search: {
                searchEntries: (...args: unknown[]) => rpcFn('search', 'searchEntries', args),
            },
        }
        const vmContextRef: { current?: vm.Context } = {}
        vmContextRef.current = vm.createContext({ mj: shimMj })

        const executor = createSandboxExecutor({
            shimMj,
            vmContextRef,
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'alpha',
            pinnedProjectRaw: 5,
            projectRegistryRaw: {
                alpha: { project_number: 5 },
                beta: { project_number: 9 },
            },
            runIsolatedNestedCode: vi.fn().mockResolvedValue({ isolated: true }),
        })

        // Fast-path: already pinned to { alpha, 5 } -> must STILL attach rpcOverrides
        await executor({
            code: "return await mj.core.createEntry({ content: 'escaped', workspace_id: 'beta', project_number: 9 })",
        })
        // Shortcut path: query-only nested call uses pinned scope + propagates rpcOverrides;
        // explicit cross-workspace query is rejected up front by validateNestedExecScope
        await executor({ query: 'findme' })
        const shortcutReject = (await executor({
            query: 'findme',
            workspace_id: 'beta',
        })) as Record<string, unknown>
        expect(shortcutReject['success']).toBe(false)
        expect(shortcutReject['code']).toBe('VALIDATION_ERROR')

        expect(sentPayloads).toHaveLength(2)
        expect(sentPayloads[0]?.workspaceId).toBe('alpha')
        expect(sentPayloads[0]?.projectNumber).toBe(5)
        expect(sentPayloads[1]?.workspaceId).toBe('alpha')
        expect(sentPayloads[1]?.projectNumber).toBe(5)

        const createTool = { name: 'create_entry' } as ToolDefinition
        const reg = { alpha: { project_number: 5 }, beta: { project_number: 9 } }
        const firstPayload = sentPayloads[0]
        const boundsErr = validateRpcOverrideBounds(
            createTool,
            firstPayload?.args[0],
            {
                ...(firstPayload?.workspaceId !== undefined ? { workspaceId: firstPayload.workspaceId } : {}),
                ...(firstPayload?.projectNumber !== undefined ? { projectNumber: firstPayload.projectNumber } : {}),
            },
            reg
        )
        expect(boundsErr?.['success']).toBe(false)
        expect(boundsErr?.['code']).toBe('VALIDATION_ERROR')

        // Wildcard workspace + pinned projectNumber fast-path retains projectNumber
        const projOnlyPayloads: { projectNumber?: number; workspaceId?: string }[] = []
        const projSendRpc = vi.fn(async (p) => {
            projOnlyPayloads.push(p)
            return { success: true }
        })
        const projRpcFn = createScopedRpcCall(projSendRpc)
        const projShim = { core: { createEntry: (...args: unknown[]) => projRpcFn('core', 'createEntry', args) } }
        const projVmRef: { current?: vm.Context } = {}
        projVmRef.current = vm.createContext({ mj: projShim })
        const projExec = createSandboxExecutor({
            shimMj: projShim,
            vmContextRef: projVmRef,
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: '*',
            pinnedProjectRaw: 5,
            projectRegistryRaw: { alpha: { project_number: 5 }, alpha2: { project_number: 5 }, beta: { project_number: 9 } },
            runIsolatedNestedCode: vi.fn(),
        })
        await projExec({ code: "return await mj.core.createEntry({ content: 'x', project_number: 9 })" })
        expect(projOnlyPayloads[0]?.workspaceId).toBeUndefined()
        expect(projOnlyPayloads[0]?.projectNumber).toBe(5)
    })

    it('P10-A-H2: normalizes and bounds-checks batch payloads when canonical keys are explicitly undefined', () => {
        const workerCreate = applyBatchAndMutationInterceptions('batchCreateEntries', [
            { entries: undefined, items: [{ content: 'x', workspace_id: 'beta' }] },
        ])
        expect('args' in workerCreate && (workerCreate.args[0] as Record<string, unknown>)['entries']).toEqual([
            { content: 'x', workspace_id: 'beta' },
        ])

        const workerUpdate = applyBatchAndMutationInterceptions('batchUpdateEntries', [
            { updates: undefined, items: [{ entry_id: 1, workspace_id: 'beta', project_number: 9 }] },
        ])
        expect('args' in workerUpdate && (workerUpdate.args[0] as Record<string, unknown>)['updates']).toEqual([
            { entry_id: 1, workspace_id: 'beta', project_number: 9 },
        ])

        const batchUpdateTool = { name: 'batch_update_entries' } as ToolDefinition
        const reg = { alpha: { project_number: 5 }, beta: { project_number: 9 } }
        const directBounds = validateRpcOverrideBounds(
            batchUpdateTool,
            { updates: undefined, entries: [{ entry_id: 1, workspace_id: 'beta', project_number: 9 }] },
            { workspaceId: 'alpha', projectNumber: 5 },
            reg
        )
        expect(directBounds?.['success']).toBe(false)
        expect(directBounds?.['code']).toBe('VALIDATION_ERROR')

        const paramsObj: Record<string, unknown> = {
            updates: undefined,
            items: [{ entry_id: 1, workspace_id: 'beta', project_number: 9 }],
        }
        const prepared = prepareBatchDispatch(batchUpdateTool, paramsObj, reg, {
            workspaceId: 'alpha',
            projectId: 5,
            explicitWorkspace: true,
            isDefaultWorkspaceName: (v) => typeof v === 'string' && v.trim().toLowerCase() === 'default',
            coerceProjectNumberField: () => undefined,
        })
        expect('errorResult' in prepared).toBe(false)
        expect(Array.isArray(paramsObj['updates'])).toBe(true)
        const postPrepBounds = validateRpcOverrideBounds(
            batchUpdateTool,
            paramsObj,
            { workspaceId: 'alpha', projectNumber: 5 },
            reg
        )
        expect(postPrepBounds?.['success']).toBe(false)
    })

    it('P10-A-H3: wildcard batch_update_entries enforces rootProjectNumber on non-move items', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const e5 = adapter.createEntry({ content: 'proj 5 entry', workspaceId: 'alpha', projectNumber: 5 })
            const e9 = adapter.createEntry({ content: 'proj 9 entry', workspaceId: 'default', projectNumber: 9 })

            const mismatches = findWildcardProjectMismatches(
                adapter,
                [
                    { entry_id: e5.id },
                    { entry_id: e9.id, project_number: 9 },
                    { entry_id: e9.id, project_number: null },
                    { entry_id: e9.id, workspace_id: 'default' },
                ],
                '*',
                5
            )
            expect(mismatches).toEqual([e9.id, e9.id, e9.id])
        } finally {
            adapter.close()
        }
    })

    it('P10-A-M1: checks target_dir/targetDir and DIR_ALIAS_KEYS in IO RPC directory bounds', () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p89-io-'))
        tempDirs.push(tmpRoot)
        const alphaDir = path.join(tmpRoot, 'alpha')
        const betaDir = path.join(tmpRoot, 'beta')
        fs.mkdirSync(alphaDir)
        fs.mkdirSync(betaDir)

        const mapped = applyDomainToolInterceptions('exportMarkdown', [{ targetDir: betaDir }])
        expect('args' in mapped && (mapped.args[0] as Record<string, unknown>)['output_dir']).toBe(betaDir)

        const reg = {
            alpha: { path: alphaDir, project_number: 5 },
            beta: { path: betaDir, project_number: 9 },
        }
        const exportTool = { name: 'export_markdown' } as ToolDefinition
        const importTool = { name: 'import_markdown' } as ToolDefinition

        for (const payload of [
            { target_dir: betaDir },
            { path: betaDir },
            { filepath: betaDir },
            { dir: betaDir },
        ]) {
            const err = validateRpcOverrideBounds(
                exportTool,
                payload,
                { workspaceId: 'alpha', projectNumber: 5 },
                reg
            )
            expect(err?.['success']).toBe(false)
            expect(err?.['code']).toBe('VALIDATION_ERROR')
        }
        const ok = validateRpcOverrideBounds(
            importTool,
            { target_dir: alphaDir },
            { workspaceId: 'alpha', projectNumber: 5 },
            reg
        )
        expect(ok).toBeUndefined()
    })

    it('P10-B-H1: batch preprocessors block project_name wildcard/invalid numbers and promote project strings', () => {
        expect(BatchDeleteEntriesSchema.safeParse({ project_name: '*', entry_ids: [1] }).success).toBe(false)
        expect(BatchDeleteEntriesSchema.safeParse({ projectName: '*', entry_ids: [1] }).success).toBe(false)
        expect(TeamBatchDeleteEntriesSchema.safeParse({ project_name: '*', entry_ids: [1] }).success).toBe(false)
        expect(BatchUpdateEntriesSchema.safeParse({ project_name: '*', updates: [{ entry_id: 1, content: 'x' }] }).success).toBe(false)

        expect(BatchDeleteEntriesSchema.safeParse({ project_name: '-5', entry_ids: [1] }).success).toBe(false)
        expect(BatchDeleteEntriesSchema.safeParse({ project_name: '0', entry_ids: [1] }).success).toBe(false)
        expect(BatchCreateEntriesSchema.safeParse({ project: '-1', entries: [{ content: 'x' }] }).success).toBe(false)

        const parsedDelete = BatchDeleteEntriesSchema.parse({ project: 'alpha', entry_ids: [1] })
        expect(parsedDelete.workspace_id).toBe('alpha')
        const parsedCreate = BatchCreateEntriesSchema.parse({ project: 'alpha', entries: [{ content: 'x' }] })
        expect(parsedCreate.workspace_id).toBe('alpha')
    })

    it('P10-B-H2: strips Git remote URL userinfo before caching and in get_github_context', async () => {
        expect(sanitizeRemoteUrl('https://x-access-token:ghp_secretTokenValue123456@github.com/o/r.git')).toBe(
            'https://github.com/o/r.git'
        )
        expect(sanitizeRemoteUrl('https://ghp_secretTokenValue123456@github.com/o/r.git')).toBe(
            'https://github.com/o/r.git'
        )
        expect(sanitizeRemoteUrl('ssh://git:supersecret@github.com/o/r.git')).toBe(
            'ssh://git@github.com/o/r.git'
        )
        expect(sanitizeRemoteUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')

        const cache = new Map<string, unknown>()
        const mockClient = {
            git: {
                branch: async () => ({ current: 'main' }),
                getRemotes: async () => [
                    { name: 'origin', refs: { fetch: 'https://bot:ghp_supersecret123@github.com/o/r.git' } },
                ],
            },
            getCached: (k: string) => cache.get(k) ?? null,
            setCache: (k: string, v: unknown) => cache.set(k, v),
        }
        const repoMgr = new RepositoryManager(mockClient as never)
        const info = await repoMgr.getRepoInfo()
        expect(info.owner).toBe('o')
        expect(info.repo).toBe('r')
        expect(info.remoteUrl).toBe('https://github.com/o/r.git')
        expect(JSON.stringify(cache.get('repoInfo'))).not.toContain('ghp_supersecret123')

        const ctxTool = createGitHubContextTool({
            db: {} as never,
            github: {
                isApiAvailable: () => true,
                getRepoInfo: async () => ({
                    owner: 'o',
                    repo: 'r',
                    branch: 'main',
                    remoteUrl: 'https://user:ghp_leak999@github.com/o/r.git',
                }),
                getRepoContext: async () => ({
                    repoName: 'r',
                    branch: 'main',
                    commit: 'abc123',
                    remoteUrl: 'https://user:ghp_leak999@github.com/o/r.git',
                    issues: [],
                    pullRequests: [],
                }),
            } as never,
        })
        const res = (await ctxTool.handler({ owner: 'o', repo: 'r' })) as Record<string, unknown>
        expect(String(res['remoteUrl'])).toContain('https://github.com/o/r.git')
        expect(String(res['remoteUrl'])).not.toContain('ghp_leak999')
    })

    it('P10-B-M1: list_deleted_entries rejects null/blank/conflicting params and trims wildcard in resolver', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const e1 = adapter.createEntry({ content: 'del 1', workspaceId: 'alpha', projectNumber: 5 })
            const e2 = adapter.createEntry({ content: 'del 2', workspaceId: 'beta', projectNumber: 9 })
            adapter.deleteEntry(e1.id, false, 'alpha')
            adapter.deleteEntry(e2.id, false, 'beta')

            const tool = getMiscSearchTools({
                db: adapter,
                config: { defaultWorkspaceId: 'alpha' },
            } as never).find((t) => t.name === 'list_deleted_entries')

            expect(tool?.inputSchema.safeParse({ unknown_key: 1 }).success).toBe(false)

            const nullProj = (await tool?.handler({ project_number: null })) as { success: boolean; code?: string }
            expect(nullProj.success).toBe(false)
            expect(nullProj.code).toBe('VALIDATION_ERROR')

            const blankProj = (await tool?.handler({ project_number: '   ' })) as { success: boolean; code?: string }
            expect(blankProj.success).toBe(false)
            expect(blankProj.code).toBe('VALIDATION_ERROR')

            const wsConflict = (await tool?.handler({
                workspace_id: 'alpha',
                workspaceId: 'beta',
            })) as { success: boolean; code?: string }
            expect(wsConflict.success).toBe(false)
            expect(wsConflict.code).toBe('VALIDATION_ERROR')

            const projConflict = (await tool?.handler({
                project_number: 5,
                projectNumber: 9,
            })) as { success: boolean; code?: string }
            expect(projConflict.success).toBe(false)
            expect(projConflict.code).toBe('VALIDATION_ERROR')

            const trimmedWildcard = (await tool?.handler({ workspace_id: ' * ' })) as {
                success: boolean
                count: number
            }
            expect(trimmedWildcard.success).toBe(true)
            expect(trimmedWildcard.count).toBe(2)

            expect(resolveWorkspaceId(' * ', undefined, { defaultWorkspaceId: 'alpha' })).toBe('*')
        } finally {
            adapter.close()
        }
    })

    it('P10-C-M1 & P10-C-M2: prevents deleted vector resurrection, drains dispose() latch, and cancels queued secondary init', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const vecMgr = new VectorSearchManager(adapter)
            const disposeSpy = vi.fn().mockResolvedValue(undefined)
            const internal = vecMgr as unknown as {
                pipeline: unknown
                generateEmbedding: (text: string) => Promise<Float32Array>
            }
            let releaseEmbed!: () => void
            const embedGate = new Promise<void>((r) => {
                releaseEmbed = r
            })
            let gateInitTest = false
            internal.generateEmbedding = async (text: string) => {
                if (gateInitTest && text !== 'test') {
                    await embedGate
                }
                return new Float32Array([1, 0, 0, 0])
            }
            await vecMgr.initialize()
            internal.pipeline = { dispose: disposeSpy }
            gateInitTest = true

            // Concurrent addEntry vs deleteEntry + safeDeleteVectors
            const e1 = adapter.createEntry({ content: 'race single', projectNumber: 5 })
            const addPromise = vecMgr.addEntry(e1)
            await Promise.resolve()
            adapter.deleteEntry(e1.id, true, 'default')
            safeDeleteVectors(adapter, [e1.id], vecMgr)
            releaseEmbed()
            await addPromise
            expect(adapter.getVectorCount()).toBe(0)

            // rebuildIndex cleans stale vectors even when errorsCount > 0
            gateInitTest = false
            const e2 = adapter.createEntry({ content: 'keep or stale', projectNumber: 5 })
            adapter.upsertVector(e2.id, new Float32Array([1, 0, 0, 0]))
            adapter.deleteEntry(e2.id, true, 'default')
            const eErr = adapter.createEntry({ content: 'err item', projectNumber: 5 })
            internal.generateEmbedding = async () => {
                throw new Error('embed fail')
            }
            const reb = await vecMgr.rebuildIndex(undefined, { force: true })
            expect(reb.failed).toBeGreaterThanOrEqual(1)
            expect(adapter.getVector(e2.id)).toBeNull()
            adapter.deleteEntry(eErr.id, true, 'default')
            internal.generateEmbedding = async () => new Float32Array([1, 0, 0, 0])

            // Dispose latch rejects subsequent work & disposes pipeline
            const searchInFlight = vecMgr.search('query').catch((err: unknown) => err)
            const disposePromise = vecMgr.dispose()
            expect(vecMgr.isDisposed()).toBe(true)
            expect(vecMgr.isInitialized()).toBe(false)
            await expect(vecMgr.initialize()).rejects.toThrow(/disposed/i)
            await expect(vecMgr.addEntry(adapter.createEntry({ content: 'after dispose' }))).rejects.toThrow(
                /disposed/i
            )
            await expect(vecMgr.search('after dispose')).rejects.toThrow(/disposed/i)
            const inFlightErr = await searchInFlight
            expect(inFlightErr).toBeInstanceOf(Error)
            await disposePromise
            expect(disposeSpy).toHaveBeenCalledTimes(1)

            // createVectorManagers cancellation stops secondary init chain
            let releasePrimary!: () => void
            const primaryGate = new Promise<void>((r) => {
                releasePrimary = r
            })
            const testAdapter = new DatabaseAdapter(':memory:')
            await testAdapter.initialize()
            try {
                const initCalls = vi
                    .spyOn(VectorSearchManager.prototype, 'initialize')
                    .mockImplementationOnce(() => primaryGate)
                    .mockResolvedValue(undefined)
                const { pendingVectorInit, disposeVectorManagers } = createVectorManagers({
                    options: { autoRebuildIndex: false } as never,
                    primaryDb: adapter,
                    testDb: testAdapter,
                    primaryTeamDb: undefined,
                    testTeamDb: undefined,
                })
                const cleanupPromise = disposeVectorManagers()
                releasePrimary()
                await Promise.all([pendingVectorInit, cleanupPromise])
                expect(initCalls).toHaveBeenCalledTimes(1)
            } finally {
                testAdapter.close()
            }
        } finally {
            adapter.close()
        }
    })

    it('P10-D-M1, M2 & L1: startup failure cleanup and CLI search/io/exec actions dispose vector managers and close DBs', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p89-cli-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')
        const importDir = path.join(tmpDir, 'import-empty')
        fs.mkdirSync(importDir)
        fs.writeFileSync(cfgFile, JSON.stringify({ allowedIoRoots: [tmpDir] }), 'utf8')
        const scriptFile = path.join(tmpDir, 'exec-test.js')
        fs.writeFileSync(scriptFile, 'return { ok: true };', 'utf8')

        const stderrLog: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
            stderrLog.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
            return true
        })
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`UNEXPECTED_EXIT_${String(code ?? 0)}: ${stderrLog.join('')}`)
        }) as never)

        vi.spyOn(VectorSearchManager.prototype, 'initialize').mockResolvedValue(undefined)
        const disposeSpy = vi.spyOn(VectorSearchManager.prototype, 'dispose').mockResolvedValue(undefined)
        const dbCloseSpy = vi.spyOn(DatabaseAdapter.prototype, 'close')

        // P10-D-M2: createServer cleanupFailedStartup disposes vectors and survives configManager.close throw
        vi.spyOn(HttpTransport.prototype, 'start').mockRejectedValueOnce(new Error('bind failed'))
        vi.spyOn(ConfigManager.prototype, 'close').mockImplementationOnce(() => {
            throw new Error('close boom')
        })
        await expect(
            createServer({
                transport: 'http',
                port: 0,
                host: '127.0.0.1',
                dbPath: ':memory:',
                authToken: 'test-token-123456',
                allowedIoRoots: [tmpDir],
                configFilePath: cfgFile,
            })
        ).rejects.toThrow('bind failed')
        expect(disposeSpy).toHaveBeenCalled()
        expect(dbCloseSpy).toHaveBeenCalled()

        // P10-D-L1: searchAction (semantic), importMarkdownAction, importExternalAction dispose vectorManager before db.close()
        disposeSpy.mockClear()
        dbCloseSpy.mockClear()
        vi.spyOn(VectorSearchManager.prototype, 'search').mockResolvedValueOnce([])
        await searchAction(
            'hello',
            { mode: 'semantic', db: path.join(tmpDir, 'search.db'), config: cfgFile, json: true },
            makeCliCommand('search', ['mode', 'db', 'config', 'json'])
        )
        expect(disposeSpy).toHaveBeenCalledTimes(1)
        expect(dbCloseSpy).toHaveBeenCalledTimes(1)

        disposeSpy.mockClear()
        dbCloseSpy.mockClear()
        await importMarkdownAction(
            { dir: importDir, db: path.join(tmpDir, 'md.db'), config: cfgFile, json: true },
            makeCliCommand('import-markdown', ['dir', 'db', 'config', 'json'])
        )
        expect(disposeSpy).toHaveBeenCalledTimes(1)
        expect(dbCloseSpy).toHaveBeenCalledTimes(1)

        disposeSpy.mockClear()
        dbCloseSpy.mockClear()
        await importExternalAction(
            {
                dir: importDir,
                format: 'notion',
                db: path.join(tmpDir, 'ext.db'),
                config: cfgFile,
                json: true,
            },
            makeCliCommand('import-external', ['dir', 'format', 'db', 'config', 'json'])
        )
        expect(disposeSpy).toHaveBeenCalledTimes(1)
        expect(dbCloseSpy).toHaveBeenCalledTimes(1)

        // P10-D-M1: execAction closes BOTH db & testDb and disposes vector managers before exiting
        disposeSpy.mockClear()
        dbCloseSpy.mockClear()
        const exitCodes: (number | undefined)[] = []
        exitSpy.mockImplementation(((code?: number) => {
            exitCodes.push(code)
            return undefined as never
        }) as never)
        const configCloseSpy = vi.spyOn(ConfigManager.prototype, 'close')
        await execAction(
            scriptFile,
            {
                db: path.join(tmpDir, 'exec.db'),
                testDb: path.join(tmpDir, 'exec-test.db'),
                config: cfgFile,
                json: true,
            },
            makeCliCommand('exec', ['db', 'testDb', 'config', 'json'])
        )
        expect(configCloseSpy).toHaveBeenCalled()
        expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(dbCloseSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(exitCodes).toEqual([0])

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass89')
    })
})
