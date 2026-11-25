/**
 * Pass 90 Audit — Remediations for Pass 11 Findings across Subsystems A–D.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getSearchTools } from '../../src/handlers/tools/search/index.js'
import { getBackupTools } from '../../src/handlers/tools/backup.js'
import { getGitHubTools } from '../../src/handlers/tools/github.js'
import { runCheckEntryStaleness } from '../../src/handlers/tools/git-staleness.js'
import { executeTeamBatchDelete } from '../../src/handlers/tools/team/admin-tools/batch-delete-helpers.js'
import { teardownVectorManagers } from '../../src/server/mcp-server/core-helpers.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { rebuildIndex } from '../../src/vector/vector-search-manager/rebuild.js'
import { execAction } from '../../src/cli/commands/exec.js'
import {
    LinkEntriesSchema,
    LinkEntriesSchemaMcp,
    VisualizeInputSchema,
    VisualizeInputSchemaMcp,
} from '../../src/handlers/tools/relationship-schemas.js'
import {
    GitAnalyzePatternsOptionsSchema,
    GitHistoryOptionsSchemaMcp,
    GitReleaseInfoOptionsSchema,
    GitReleaseInfoOptionsSchemaMcp,
    GitSearchOptionsSchemaMcp,
    GitUnreleasedOptionsSchema,
} from '../../src/handlers/tools/git-schemas.js'
import {
    GetEntryHistorySchema,
    ListTagsSchema,
    TestSimpleSchema,
} from '../../src/handlers/tools/core/schemas.js'
import { GetProjectSchemaMcp } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { TeamLinkEntriesSchema } from '../../src/handlers/tools/team/schemas/analytics-vector-schemas.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

function makeCliCommand(name: string, providedKeys: string[] = []): Command {
    const provided = new Set(providedKeys)
    return {
        name: () => name,
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    } as unknown as Command
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) {
        throw new Error(`Expected tool '${name}' to be registered`)
    }
    return found
}

function createScopedTestContext(db: DatabaseAdapter): ToolContext {
    const runtime = new ServerRuntime()
    const registry = {
        alpha: { path: os.tmpdir(), project_number: 5 },
        beta: { path: os.tmpdir(), project_number: 9 },
        pathonly: { path: os.tmpdir() },
    }
    return {
        db,
        vectorManager: undefined,
        github: undefined,
        config: {
            projectRegistry: registry,
            defaultWorkspaceId: 'alpha',
            defaultProjectNumber: 5,
            runtime,
        },
    }
}

describe('Pass 90 Audit — Pass 11 Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('P11-A-H1: blocks get_project alias bypasses across project_name, project, id, and path-only project_number', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const sessionContext = createScopedTestContext(db)
            const dispatcher = createSecureDispatcher({
                tools: [...getAdminTools(sessionContext), ...getCoreTools(sessionContext)],
                sessionContext,
                projectId: undefined,
                workspaceId: '*',
                autoVersion: false,
                dryRun: false,
            })

            await runWithRpcExecutionOverrides({ workspaceId: 'alpha', projectNumber: 5 }, async () => {
                for (const params of [
                    { project_name: 'beta' },
                    { project: 'beta' },
                    { projectName: 'beta' },
                    { id: 9 },
                    { project_number: 9 },
                ]) {
                    const res = (await dispatcher('get_project', params)) as { success: boolean; code?: string }
                    expect(res.success).toBe(false)
                    expect(res.code).toBe('VALIDATION_ERROR')
                }
                const allowed = (await dispatcher('get_project', { project_name: 'alpha' })) as {
                    success: boolean
                    project?: { name?: string }
                }
                expect(allowed.success).toBe(true)
                expect(allowed.project?.name).toBe('alpha')
            })

            await runWithRpcExecutionOverrides({ workspaceId: 'pathonly' }, async () => {
                const blockedNum = (await dispatcher('get_project', { project_number: 9 })) as {
                    success: boolean
                    code?: string
                }
                expect(blockedNum.success).toBe(false)
                expect(blockedNum.code).toBe('VALIDATION_ERROR')

                const blockedId = (await dispatcher('get_project', { id: 9 })) as {
                    success: boolean
                    code?: string
                }
                expect(blockedId.success).toBe(false)
                expect(blockedId.code).toBe('VALIDATION_ERROR')
            })
        } finally {
            db.close()
        }
    })

    it('P11-A-H2: blocks post-bounds entry/filters/filter unpacking and workspace/project aliases in nested executeCode', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const sessionContext = createScopedTestContext(db)
            const created = db.createEntry({ content: 'alpha entry', workspaceId: 'alpha', projectNumber: 5 })
            const dispatcher = createSecureDispatcher({
                tools: [
                    ...getAdminTools(sessionContext),
                    ...getCoreTools(sessionContext),
                    ...getSearchTools(sessionContext),
                ],
                sessionContext,
                projectId: undefined,
                workspaceId: '*',
                autoVersion: false,
                dryRun: false,
            })

            await runWithRpcExecutionOverrides({ workspaceId: 'pathonly' }, async () => {
                const singleEscape = (await dispatcher('update_entry', {
                    entry_id: created.id,
                    content: 'moved',
                    entry: { target_workspace_id: 'beta' },
                })) as { success: boolean; code?: string }
                expect(singleEscape.success).toBe(false)
                expect(singleEscape.code).toBe('VALIDATION_ERROR')

                const batchEscape = (await dispatcher('batch_update_entries', {
                    updates: [{ entry_id: created.id, content: 'moved', entry: { target_workspace_id: 'beta' } }],
                })) as { success: boolean; code?: string }
                expect(batchEscape.success).toBe(false)
                expect(batchEscape.code).toBe('VALIDATION_ERROR')
            })

            await runWithRpcExecutionOverrides({ projectNumber: 5 }, async () => {
                const filterDefaultEscape = (await dispatcher('search_entries', {
                    query: 'alpha',
                    filters: { workspace_id: 'default' },
                })) as { success: boolean; code?: string }
                expect(filterDefaultEscape.success).toBe(false)
                expect(filterDefaultEscape.code).toBe('VALIDATION_ERROR')

                const filterProjEscape = (await dispatcher('search_entries', {
                    query: 'alpha',
                    filter: { project_number: '9' },
                })) as { success: boolean; code?: string }
                expect(filterProjEscape.success).toBe(false)
                expect(filterProjEscape.code).toBe('VALIDATION_ERROR')

                const projectAliasEscape = (await dispatcher('create_entry', {
                    content: 'x',
                    filters: { project: 'beta' },
                })) as { success: boolean; code?: string }
                expect(projectAliasEscape.success).toBe(false)
                expect(projectAliasEscape.code).toBe('VALIDATION_ERROR')

                const matchingFilter = (await dispatcher('search_entries', {
                    query: 'alpha',
                    filters: { workspace_id: 'alpha', project_number: 5 },
                })) as { success: boolean; entries?: unknown[] }
                expect(matchingFilter.success).toBe(true)
            })
        } finally {
            db.close()
        }
    })

    it('P11-C-H1 & P11-C-M1: Code Mode restore_backup drains sibling RPCs and holds lock across vector rebuild', async () => {
        const runtime = new ServerRuntime()
        const mm = runtime.maintenanceManager
        const order: string[] = []
        const siblingResolvers: Array<() => void> = []
        let notifySiblingEntered: () => void = () => undefined
        const siblingEntered = new Promise<void>((resolve) => {
            notifySiblingEntered = resolve
        })

        const slowReadTool: ToolDefinition = {
            name: 'slow_read',
            description: 'slow read mock',
            group: 'core',
            inputSchema: TestSimpleSchema,
            annotations: { readOnlyHint: true },
            handler: async () => {
                order.push('sibling-start')
                notifySiblingEntered()
                await new Promise<void>((resolve) => {
                    siblingResolvers.push(resolve)
                })
                order.push('sibling-end')
                return { success: true }
            },
        }

        let lockHeldDuringRebuild = false
        const fakeVectorManager = {
            isInitialized: () => true,
            rebuildIndex: vi.fn().mockImplementation(async () => {
                await Promise.resolve()
                lockHeldDuringRebuild = mm.isMaintenanceModeActive()
                order.push('vector-rebuild')
                return { success: true, indexed: 1, failed: 0, firstError: null }
            }),
        } as unknown as NonNullable<ToolContext['vectorManager']>

        const fakeBackupDb = {
            exportToFile: vi.fn().mockImplementation(async () => {
                await Promise.resolve()
                order.push('backup-export')
                return { filename: 'pre.db', path: '/tmp/pre.db', sizeBytes: 128 }
            }),
            restoreFromFile: vi.fn().mockImplementation(async () => {
                await Promise.resolve()
                order.push('db-restore')
                return { restoredFrom: 'snap.db', previousEntryCount: 1, newEntryCount: 1 }
            }),
        } as unknown as DatabaseAdapter

        const sessionContext: ToolContext = {
            db: fakeBackupDb,
            vectorManager: fakeVectorManager,
            config: { runtime },
        }
        const dispatcher = createSecureDispatcher({
            tools: [slowReadTool, ...getBackupTools(sessionContext)],
            sessionContext,
            projectId: undefined,
            workspaceId: 'alpha',
            autoVersion: false,
            dryRun: false,
        })

        let notifyLockEntered: () => void = () => undefined
        const lockEntered = new Promise<void>((resolve) => {
            notifyLockEntered = resolve
        })
        const origAcquire = mm.acquireMaintenanceLock.bind(mm)
        vi.spyOn(mm, 'acquireMaintenanceLock').mockImplementation(() => {
            const p = origAcquire()
            notifyLockEntered()
            return p
        })

        await mm.withActiveJob(async () => {
            const siblingPromise = dispatcher('slow_read', {})
            await siblingEntered
            const restorePromise = dispatcher('restore_backup', { filename: 'snap.db', confirm: true })
            await lockEntered
            expect(mm.isMaintenanceModeActive()).toBe(true)
            await expect(dispatcher('slow_read', {})).rejects.toThrow(/Maintenance Mode/i)
            siblingResolvers.forEach((resolve) => resolve())
            const [siblingRes, restoreRes] = (await Promise.all([siblingPromise, restorePromise])) as [
                { success: boolean },
                { success: boolean },
            ]
            expect(siblingRes.success).toBe(true)
            expect(restoreRes.success).toBe(true)
        })

        expect(lockHeldDuringRebuild).toBe(true)
        expect(mm.isMaintenanceModeActive()).toBe(false)
        expect(order).toEqual(['sibling-start', 'sibling-end', 'backup-export', 'db-restore', 'vector-rebuild'])
    })

    it('P11-D-H1, P11-C-M2 & P11-C-L1: cancels vectors before wait, aborts rebuild pages on dispose, bounds drain, and checks cold dims', async () => {
        // 1. teardownVectorManagers calls disposeVectorManagers before awaitPendingVectorInit
        const callOrder: string[] = []
        let releaseInit: () => void = () => undefined
        const pendingVectorInit = new Promise<void>((resolve) => {
            releaseInit = () => {
                callOrder.push('init-settled')
                resolve()
            }
        })
        await teardownVectorManagers({
            pendingVectorInit,
            disposeVectorManagers: vi.fn().mockImplementation(() => {
                callOrder.push('dispose-first')
                releaseInit()
                return Promise.resolve()
            }),
        })
        expect(callOrder[0]).toBe('dispose-first')

        // 2. rebuildIndex stops page/batch iteration immediately on dispose without logging errors
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const e1 = db.createEntry({ content: 'one', workspaceId: 'alpha', projectNumber: 5 })
            const e2 = db.createEntry({ content: 'two', workspaceId: 'alpha', projectNumber: 5 })
            const e3 = db.createEntry({ content: 'three', workspaceId: 'alpha', projectNumber: 5 })
            expect(e1.id).toBeGreaterThan(0)
            expect(e2.id).toBeGreaterThan(0)
            expect(e3.id).toBeGreaterThan(0)

            const mgr = new VectorSearchManager(db)
            let genCalls = 0
            vi.spyOn(mgr, 'initialize').mockResolvedValue(undefined)
            Object.assign(mgr, { ready: true, dimensions: 4 })
            vi.spyOn(mgr, 'generateEmbedding').mockImplementation(() => {
                genCalls++
                if (genCalls === 1) {
                    void mgr.dispose()
                }
                return Promise.reject(new Error('VectorSearchManager has been disposed'))
            })
            const rebuildRes = await rebuildIndex(mgr, db, undefined, { force: true, batchSize: 1, pageSize: 1 })
            expect(rebuildRes.success).toBe(false)
            expect(genCalls).toBe(1)

            // 3. Cold-start searchByEntryId checks dimension mismatch after initialize()
            const coldMgr = new VectorSearchManager(db)
            vi.spyOn(coldMgr, 'initialize').mockImplementation(() => {
                Object.assign(coldMgr, { ready: true, dimensions: 4 })
                return Promise.resolve()
            })
            vi.spyOn(coldMgr, 'generateEmbedding').mockResolvedValue(new Float32Array([1, 0]))
            await expect(coldMgr.searchByEntryId(e1.id, 10, 0.0, 'alpha')).rejects.toThrow(/Embedding dimension mismatch: expected 4, got 2/)
        } finally {
            db.close()
        }

        // 4. VectorSearchManager.dispose(timeoutMs) completes cleanly when initialization hangs
        vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
        const hangDb = new DatabaseAdapter(':memory:')
        await hangDb.initialize()
        try {
            const hangMgr = new VectorSearchManager(hangDb)
            Object.assign(hangMgr, {
                initializationPromise: new Promise<void>(() => undefined),
            })
            let drained = false
            const disposePromise = hangMgr.dispose(150).then(() => {
                drained = true
            })
            await vi.advanceTimersByTimeAsync(200)
            await disposePromise
            expect(drained).toBe(true)
        } finally {
            vi.useRealTimers()
            hangDb.close()
        }
    })

    it('P11-B-M1, P11-B-M2 & P11-D-M1: handles untrimmed wildcard *, teamVectorManager markRemoved fallback, and exec project propagation', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const eA = db.createEntry({ content: 'wild alpha', workspaceId: 'alpha', projectNumber: 5 })
            const ctx = createScopedTestContext(db)
            const adminTools = getAdminTools(ctx)
            const updateTool = requireTool(adminTools, 'update_entry')
            const batchUpdateTool = requireTool(adminTools, 'batch_update_entries')
            const batchDeleteTool = requireTool(adminTools, 'batch_delete_entries')

            const upRes = (await updateTool.handler({
                entry_id: eA.id,
                workspace_id: ' * ',
                content: 'updated via untrimmed wildcard',
            })) as { success: boolean }
            expect(upRes.success).toBe(true)

            const batchUpRes = (await batchUpdateTool.handler({
                workspace_id: ' * ',
                updates: [{ entry_id: eA.id, content: 'batch updated', target_workspace_id: 'alpha' }],
            })) as { success: boolean; count?: number }
            expect(batchUpRes.success).toBe(true)
            expect(batchUpRes.count).toBe(1)

            const stalenessRes = (await runCheckEntryStaleness(
                { entry_id: eA.id, workspace_id: ' * ' },
                ctx,
                () => Promise.resolve(0)
            )) as { success: boolean; checkedCount?: number }
            expect(stalenessRes.success).toBe(true)

            const batchDelRes = (await batchDeleteTool.handler({
                entry_ids: [eA.id],
                workspace_id: ' * ',
            })) as { success: boolean; deleted?: number[] }
            expect(batchDelRes.success).toBe(true)
            expect(batchDelRes.deleted).toEqual([eA.id])
        } finally {
            db.close()
        }

        // P11-B-M2: team_batch_delete_entries invokes teamVectorManager.markRemoved when deleteVectors is absent
        const markRemoved = vi.fn()
        const mockTeamDb = {
            isTeamRbacActive: () => false,
            getEntriesByIds: () => new Map([[10, { id: 10, workspaceId: 'alpha', projectNumber: 5 }]]),
            getEntriesByIdsIncludeDeleted: () => new Map([[10, { id: 10, workspaceId: 'alpha', projectNumber: 5 }]]),
            getEntryById: () => ({ id: 10, workspaceId: 'alpha', projectNumber: 5 }),
            getAuthorsForEntries: () => new Map([[10, 'test-author']]),
            deleteEntries: () => ({ deleted: [10], notFound: [], errors: [] }),
            deleteVector: vi.fn(),
        } as unknown as NonNullable<ToolContext['teamDb']>
        const teamDelRes = await executeTeamBatchDelete(
            {
                db: {} as DatabaseAdapter,
                teamVectorManager: { markRemoved } as unknown as NonNullable<ToolContext['teamVectorManager']>,
                config: { projectRegistry: { alpha: { path: os.tmpdir(), project_number: 5 } } },
            },
            mockTeamDb,
            { entry_ids: [10], workspace_id: 'alpha', project_number: 5, permanent: false }
        )
        expect(teamDelRes['success']).toBe(true)
        expect(markRemoved).toHaveBeenCalledWith([10])

        // P11-D-M1: cli exec --workspace <unreg> preserves resolved defaultProjectNumber
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p90-exec-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')
        const scriptFile = path.join(tmpDir, 'check-proj.js')
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({ defaultWorkspaceId: 'unreg', defaultProjectNumber: 42 }),
            'utf8'
        )
        fs.writeFileSync(
            scriptFile,
            "const r = await mj.core.createEntry({ content: 'exec-proj' }); return { pn: r.entry?.projectNumber, ws: r.entry?.workspaceId };",
            'utf8'
        )
        const stdoutChunks: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
            return true
        })
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const exitCodes: (number | undefined)[] = []
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            exitCodes.push(code)
            return undefined as never
        }) as never)
        vi.spyOn(VectorSearchManager.prototype, 'initialize').mockResolvedValue(undefined)
        await execAction(
            scriptFile,
            {
                db: path.join(tmpDir, 'exec.db'),
                config: cfgFile,
                workspace: 'unreg',
                json: true,
            },
            makeCliCommand('exec', ['db', 'config', 'workspace', 'json'])
        )
        expect(exitCodes).toEqual([0])
        const parsedOut = JSON.parse(stdoutChunks.join('')) as {
            success?: boolean
            result?: { pn?: number; ws?: string }
        }
        expect(parsedOut.success).toBe(true)
        expect(parsedOut.result).toEqual({ pn: 42, ws: 'unreg' })
    })

    it('P11-B-L1 & P11-B-L2: enforces .strict() inner schemas and rejects conflicting canonical/alias parameters', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const ctx = createScopedTestContext(db)
            const extra = { extra_unknown_field: 'nope' }
            const strictRejectCases: Array<[ { parse: (v: unknown) => unknown }, Record<string, unknown> ]> = [
                [LinkEntriesSchema, { from_entry_id: 1, to_entry_id: 2, ...extra }],
                [LinkEntriesSchemaMcp, { from_entry_id: 1, to_entry_id: 2, ...extra }],
                [VisualizeInputSchema, { entry_id: 1, ...extra }],
                [VisualizeInputSchemaMcp, { entry_id: 1, ...extra }],
                [GetEntryHistorySchema, { entry_id: 1, ...extra }],
                [ListTagsSchema, extra],
                [TestSimpleSchema, extra],
                [GitReleaseInfoOptionsSchema, extra],
                [GitReleaseInfoOptionsSchemaMcp, extra],
                [GitUnreleasedOptionsSchema, extra],
                [GitAnalyzePatternsOptionsSchema, extra],
            ]
            for (const [schema, payload] of strictRejectCases) {
                expect(() => schema.parse(payload)).toThrow()
            }
            expect(LinkEntriesSchema.parse(LinkEntriesSchemaMcp.parse({ source_id: 1, target_id: 2, rel: 'resolves' })).relationship_type).toBe('resolved')
            expect(VisualizeInputSchema.parse(VisualizeInputSchemaMcp.parse({ q: 'tagA', keep: 15 })).tags).toEqual(['tagA'])

            for (const [schema, payload] of [
                [LinkEntriesSchemaMcp, { from_entry_id: 1, source_id: 2, to_entry_id: 3 }],
                [VisualizeInputSchemaMcp, { entry_id: 1, id: 2 }],
                [VisualizeInputSchemaMcp, { limit: 5, keep: 10 }],
                [GitHistoryOptionsSchemaMcp, { maxCount: 5, limit: 10 }],
                [GitSearchOptionsSchemaMcp, { query: 'a', sortBy: 'date', sort_by: 'impact' }],
                [GetProjectSchemaMcp, { name: 'alpha', project_name: 'beta' }],
                [TeamLinkEntriesSchema, { from_entry_id: 1, source_id: 2, to_entry_id: 3 }],
            ] as Array<[ { parse: (v: unknown) => unknown }, Record<string, unknown> ]>) {
                expect(() => schema.parse(payload)).toThrow()
            }

            const restoreConflict = (await requireTool(getAdminTools(ctx), 'restore_entry').handler({ entry_id: 1, id: 2 })) as { success: boolean }
            expect(restoreConflict.success).toBe(false)
            const issueConflict = (await requireTool(getGitHubTools(ctx), 'create_github_issue_with_entry').handler({
                title: 't', project_number: 5, entry_content: 'A', journal_content: 'B',
            })) as { success: boolean }
            expect(issueConflict.success).toBe(false)
            const staleConflict = (await runCheckEntryStaleness({ entry_id: 1, entryId: 2 }, ctx, () => Promise.resolve(0))) as { success: boolean; code?: string }
            expect(staleConflict.success).toBe(false)
            expect(staleConflict.code).toBe('VALIDATION_ERROR')
            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass94')
        } finally {
            db.close()
        }
    })
})
