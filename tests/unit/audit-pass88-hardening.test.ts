/**
 * Pass 88 Audit — Remediations for Pass 9 Findings across Subsystems A–D.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { normalizeBatchDispatchItems } from '../../src/handlers/tools/codemode/dispatch-batch-scope.js'
import { matchesAuditFilters } from '../../src/audit/audit-query-helpers.js'
import { createAuditInterceptor, type AuditLogger } from '../../src/audit/index.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { getMiscTools } from '../../src/handlers/tools/admin/misc-tools.js'
import {
    BatchCreateEntriesSchema,
    BatchDeleteEntriesSchema,
    BatchUpdateEntriesSchema,
    UpdateEntrySchema,
} from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import {
    TeamBatchCreateEntriesSchema,
    TeamBatchCreateEntriesSchemaMcp,
    TeamBatchUpdateEntriesSchema,
} from '../../src/handlers/tools/team/schemas/admin-batch-schemas.js'
import { SearchByDateRangeSchema, SearchEntriesSchema } from '../../src/handlers/tools/search/schemas.js'
import { CrossTeamSearchSchema } from '../../src/handlers/tools/search/cross-team.js'
import { ExportEntriesSchema } from '../../src/handlers/tools/io/schemas.js'
import { TeamSearchByDateRangeSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { getGitHubMilestoneTools } from '../../src/handlers/tools/github/milestone-tools.js'
import { createVectorManagers } from '../../src/server/mcp-server/initialization-helpers.js'
import { buildHttpTransportConfig } from '../../src/server/mcp-server/core-helpers.js'
import { getBackupTools } from '../../src/handlers/tools/backup.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { CANONICAL_SERVER_ENV_KEYS } from '../../src/cli/server-options-groups.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import type { ToolDefinition } from '../../src/types/index.js'

function makeCliCommand(providedKeys: string[] = []): CliCommandLike {
    const provided = new Set(providedKeys)
    return {
        name: () => 'serve',
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    }
}

function withTempEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const saved: Record<string, string | undefined> = {}
    for (const key of Object.keys(vars)) {
        saved[key] = process.env[key]
        const nextVal = vars[key]
        if (nextVal === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = nextVal
    }
    try {
        fn()
    } finally {
        for (const [key, prev] of Object.entries(saved)) {
            if (prev === undefined) Reflect.deleteProperty(process.env, key)
            else process.env[key] = prev
        }
    }
}

describe('Pass 88 Audit — Pass 9 Remediations', () => {
    const tempDirs: string[] = []
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
        vi.restoreAllMocks()
    })

    it('P9-A-H1: rejects project_number: null in nested executeCode top-level and batch items', () => {
        const updateTool = { name: 'update_entry' } as ToolDefinition
        const batchTool = { name: 'batch_update_entries' } as ToolDefinition
        const overrides = { projectNumber: 5 }

        const topNull = validateRpcOverrideBounds(
            updateTool,
            { entry_id: 99, project_number: null, content: 'x' },
            overrides,
            undefined
        )
        expect(topNull?.['success']).toBe(false)
        expect(topNull?.['code']).toBe('VALIDATION_ERROR')

        const itemNull = validateRpcOverrideBounds(
            batchTool,
            { updates: [{ entry_id: 100, project_number: null, content: 'y' }] },
            overrides,
            undefined
        )
        expect(itemNull?.['success']).toBe(false)
        expect(itemNull?.['code']).toBe('VALIDATION_ERROR')
    })

    it('P9-A-M1: preserves concrete root scope and cross-workspace moves without session clobbering', () => {
        const ctx = {
            workspaceId: 'wsA',
            projectId: 5,
            explicitWorkspace: true,
            isDefaultWorkspaceName: (v: unknown) =>
                typeof v === 'string' && v.trim().toLowerCase() === 'default',
            coerceProjectNumberField: () => undefined,
        }
        const reg = { wsA: { project_number: 5 }, wsB: { project_number: 8 } }

        const blankWsUpdate = {
            workspace_id: 'wsB',
            updates: [{ entry_id: 42, workspace_id: '', content: 'b' }],
        }
        expect(normalizeBatchDispatchItems('updates', blankWsUpdate, reg, ctx)).toBeUndefined()
        expect('workspace_id' in (blankWsUpdate.updates[0] ?? {})).toBe(false)
        expect('project_number' in (blankWsUpdate.updates[0] ?? {})).toBe(false)

        const crossMoveIntoSession = {
            workspace_id: 'wsB',
            updates: [{ entry_id: 42, target_workspace_id: 'wsA', content: 'b->a' }],
        }
        expect(
            normalizeBatchDispatchItems('updates', crossMoveIntoSession, reg, ctx)
        ).toBeUndefined()
        expect('workspace_id' in (crossMoveIntoSession.updates[0] ?? {})).toBe(false)

        const rootProjOverride = { project_number: 8, entries: [{ content: 'for 8' }] }
        expect(normalizeBatchDispatchItems('entries', rootProjOverride, reg, ctx)).toBeUndefined()
        expect('workspace_id' in (rootProjOverride.entries[0] ?? {})).toBe(false)
        expect('project_number' in (rootProjOverride.entries[0] ?? {})).toBe(false)
    })

    it('P9-B-H1: search_audit_log and matchesAuditFilters compare timestamps numerically with full end-day inclusion', async () => {
        const entry: AuditEntry = {
            timestamp: '2026-11-24T18:00:00.000Z',
            requestId: 'req-1',
            tool: 'create_entry',
            category: 'write',
            scope: 'write',
            user: null,
            scopes: [],
            durationMs: 1,
            success: true,
        }
        expect(
            matchesAuditFilters(entry, { date_range: { start: '2026-11-24', end: '2026-11-24' } })
        ).toBe(true)
        expect(
            matchesAuditFilters(
                { ...entry, timestamp: '2026-11-24T14:00:00.000Z' },
                { date_range: { end: '2026-11-24T10:00:00-05:00' } }
            )
        ).toBe(true)
        expect(
            matchesAuditFilters(
                { ...entry, timestamp: '2026-11-24T16:00:00.000Z' },
                { date_range: { end: '2026-11-24T10:00:00-05:00' } }
            )
        ).toBe(false)

        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            const mockSearch = vi.fn().mockResolvedValue([])
            const tool = getMiscTools({
                db: adapter,
                config: { runtime: { auditLogger: { search: mockSearch } } },
            } as never).find((t) => t.name === 'search_audit_log')
            await tool?.handler({ start_date: '2026-11-24', end_date: '2026-11-24' })
            expect(mockSearch).toHaveBeenCalledWith(
                expect.objectContaining({
                    date_range: {
                        start: '2026-11-24T00:00:00.000Z',
                        end: '2026-11-24T23:59:59.999Z',
                    },
                })
            )
        } finally {
            adapter.close()
        }
    })

    it('P9-B-M1, M2 & L1..L3: normalizes batch/update aliases, rejects invalid calendar dates, and attributes view_file memory URIs', async () => {
        expect(
            BatchCreateEntriesSchema.parse({ workspaceId: 'alpha', entries: [{ content: 'x' }] })
                .workspace_id
        ).toBe('alpha')
        expect(
            BatchUpdateEntriesSchema.parse({
                projectNumber: 5,
                updates: [{ entry_id: 1, content: 'x' }],
            }).project_number
        ).toBe(5)
        expect(
            BatchDeleteEntriesSchema.parse({ repo: 'alpha', entry_ids: [1] }).workspace_id
        ).toBe('alpha')
        expect(
            TeamBatchCreateEntriesSchema.parse({
                workspaceId: 'alpha',
                entries: [{ content: 'x' }],
            }).workspace_id
        ).toBe('alpha')
        expect(
            TeamBatchCreateEntriesSchemaMcp.safeParse({ entries: [{ content: 'x' }], rogue: 1 })
                .success
        ).toBe(false)
        expect(
            TeamBatchUpdateEntriesSchema.parse({
                projectName: 'alpha',
                updates: [{ entry_id: 1, content: 'x' }],
            }).workspace_id
        ).toBe('alpha')
        expect(
            UpdateEntrySchema.parse({ entry_id: 1, targetWorkspaceId: 'alpha' }).target_workspace_id
        ).toBe('alpha')
        expect(
            CreateEntrySchema.parse({
                content: 'x',
                project_number: 5,
                workspaceId: 'alpha',
                workspace: 'alpha',
            }).workspace_id
        ).toBe('alpha')

        expect(SearchEntriesSchema.safeParse({ start_date: '2026-02-31T10:00:00Z' }).success).toBe(false)
        expect(SearchEntriesSchema.safeParse({ start_date: '2024-02-29' }).success).toBe(true)
        expect(
            SearchByDateRangeSchema.safeParse({ start_date: '2026-02-31', end_date: '2026-13-01' })
                .success
        ).toBe(false)
        expect(
            CrossTeamSearchSchema.safeParse({ query: 'x', start_date: '2026-04-31' }).success
        ).toBe(false)
        expect(ExportEntriesSchema.safeParse({ end_date: '2026-02-30' }).success).toBe(false)
        expect(
            TeamSearchByDateRangeSchema.safeParse({
                start_date: '2026-02-29',
                end_date: '2026-03-01',
            }).success
        ).toBe(false)

        const msCreateTool = getGitHubMilestoneTools({ db: {} } as never).find(
            (t) => t.name === 'create_github_milestone'
        )
        const msBadDate = (await msCreateTool?.handler({
            title: 'v1',
            due_on: '2026-02-31',
        })) as { success: boolean; code?: string }
        expect(msBadDate.success).toBe(false)
        expect(msBadDate.code).toBe('VALIDATION_ERROR')

        const logged: AuditEntry[] = []
        const mockLogger = {
            config: { auditReads: false, redact: false },
            log: (e: AuditEntry) => logged.push(e),
        } as unknown as AuditLogger
        const interceptor = createAuditInterceptor(mockLogger, new ServerRuntime())
        await interceptor.around(
            'view_file',
            { target_file: 'memory://team/entries?workspace_id=alpha&project_number=5' },
            async () => ({ ok: true })
        )
        await interceptor.around('view_file', { _AbsolutePath: 'memory://audit' }, async () => ({
            ok: true,
        }))
        expect(logged[0]?.category).toBe('team')
        expect(logged[0]?.workspaceId).toBe('alpha')
        expect(logged[0]?.projectNumber).toBe(5)
        expect(logged[1]?.category).toBe('audit')
    })

    it('P9-C-H1, M1 & M2: maintenance lock drains vector auto-rebuild, force rebuilds post-restore, serializes remove/rebuild, and disposes pipeline', async () => {
        const adapter = new DatabaseAdapter(':memory:')
        await adapter.initialize()
        try {
            let releaseInit!: () => void
            const initGate = new Promise<void>((r) => {
                releaseInit = r
            })
            vi.spyOn(VectorSearchManager.prototype, 'initialize').mockImplementation(() => initGate)
            const rebuildSpy = vi
                .spyOn(VectorSearchManager.prototype, 'rebuildIndex')
                .mockResolvedValue({ success: true, indexed: 0, failed: 0, firstError: null })

            const runtime = new ServerRuntime()
            const { pendingVectorInit, disposeVectorManagers } = createVectorManagers({
                options: { autoRebuildIndex: true } as never,
                primaryDb: adapter,
                testDb: undefined,
                primaryTeamDb: undefined,
                testTeamDb: undefined,
                maintenanceManager: runtime.maintenanceManager,
            })

            let lockResolved = false
            const lockPromise = runtime.maintenanceManager.withActiveJob(async () => {
                await runtime.maintenanceManager.acquireMaintenanceLock()
                lockResolved = true
            }, true)
            await Promise.resolve()
            expect(lockResolved).toBe(false)
            releaseInit()
            await lockPromise
            expect(lockResolved).toBe(true)
            await pendingVectorInit
            expect(rebuildSpy).not.toHaveBeenCalled()
            await disposeVectorManagers()
            runtime.maintenanceManager.releaseMaintenanceLock()
            vi.restoreAllMocks()

            const e1 = adapter.createEntry({ content: 'restore force check', projectNumber: 5 })
            const mockBackupMgr = {
                exportToFile: vi.fn().mockResolvedValue({ filename: 'pre.db', path: '/pre.db', sizeBytes: 10 }),
                restoreFromFile: vi.fn().mockResolvedValue({ restoredFrom: 'b.db', previousEntryCount: 1, newEntryCount: 1 }),
            }
            const mockVecMgr = {
                isInitialized: () => true,
                rebuildIndex: vi.fn().mockResolvedValue({ success: true, indexed: 1, failed: 0, firstError: null }),
            }
            const restoreTool = getBackupTools({
                db: mockBackupMgr,
                vectorManager: mockVecMgr,
                config: { runtime },
            } as never).find((t) => t.name === 'restore_backup')
            await restoreTool?.handler({ filename: 'b.db', confirm: true })
            expect(mockVecMgr.rebuildIndex).toHaveBeenCalledWith(undefined, { force: true })

            const vecMgr = new VectorSearchManager(adapter)
            const disposeSpy = vi.fn().mockResolvedValue(undefined)
            const internal = vecMgr as unknown as {
                pipeline: unknown
                ready: boolean
                dimensions: number | null
                generateEmbedding: (text: string) => Promise<Float32Array>
            }
            internal.generateEmbedding = async () => new Float32Array([1, 0, 0, 0])
            await vecMgr.initialize()
            internal.pipeline = { dispose: disposeSpy }
            let releaseEmbed!: () => void
            const embedGate = new Promise<void>((r) => {
                releaseEmbed = r
            })
            vi.spyOn(vecMgr, 'generateEmbeddingsSettled').mockImplementation(async (texts) => {
                await embedGate
                return texts.map(() => ({ status: 'fulfilled' as const, value: new Float32Array([1, 0, 0, 0]) }))
            })
            const rebuildPromise = vecMgr.rebuildIndex(undefined, { force: true })
            await Promise.resolve()
            await Promise.resolve()
            vecMgr.removeEntry(e1.id)
            releaseEmbed()
            await rebuildPromise
            expect(adapter.getVectorCount()).toBe(0)
            await vecMgr.dispose()
            expect(disposeSpy).toHaveBeenCalledTimes(1)
        } finally {
            adapter.close()
        }
    })

    it('P9-D-H1, H2 & M1: rejects whitespace env IO/team DBs, allows env>config default scope overrides, and isolates CORS origins', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p88-cli-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({
                allowedIoRoots: [tmpDir],
                projectRegistry: {
                    repoA: { path: tmpDir, project_number: 5 },
                    repoB: { path: tmpDir, project_number: 16 },
                },
                defaultWorkspaceId: 'repoA',
                defaultProjectNumber: 5,
                corsOrigin: '',
            }),
            'utf8'
        )

        withTempEnv(
            {
                ALLOWED_IO_ROOTS: '   ',
                ADDITIONAL_TEAM_DBS: '   ',
                DEFAULT_WORKSPACE_ID: 'repoB',
                MCP_CORS_ORIGIN: 'https://ambient.example,   ',
            },
            () => {
                const cmd = makeCliCommand([])
                const errs: string[] = []
                const built = buildServerOptions(new ConfigResolver(cmd, {}, cfgFile), {}, cmd, errs)
                expect(errs.some((e) => /ALLOWED_IO_ROOTS/i.test(e))).toBe(true)
                expect(errs.some((e) => /ADDITIONAL_TEAM_DBS/i.test(e))).toBe(true)
                expect(errs.every((e) => !/belongs to workspace|project_number/i.test(e))).toBe(true)
                expect(built.serverOptions.defaultWorkspaceId).toBe('repoB')
                expect(built.serverOptions.defaultProjectNumber).toBeUndefined()
                expect(built.serverOptions.corsOrigins).toEqual([])
            }
        )

        withTempEnv({ DEFAULT_PROJECT_NUMBER: '16' }, () => {
            const cmd = makeCliCommand([])
            const errs: string[] = []
            const built = buildServerOptions(new ConfigResolver(cmd, {}, cfgFile), {}, cmd, errs)
            expect(errs).toEqual([])
            expect(built.serverOptions.defaultWorkspaceId).toBeUndefined()
            expect(built.serverOptions.defaultProjectNumber).toBe(16)
        })

        withTempEnv({ MCP_CORS_ORIGIN: 'https://good.example,   ' }, () => {
            const cliCmd = makeCliCommand(['corsOrigin'])
            const errs: string[] = []
            buildServerOptions(
                new ConfigResolver(cliCmd, { corsOrigin: '' }, cfgFile),
                {},
                cliCmd,
                errs
            )
            expect(errs.some((e) => /--cors-origin/i.test(e))).toBe(true)
            expect(buildHttpTransportConfig({ transport: 'http' }).corsOrigins).toEqual([
                'https://good.example',
            ])
        })

        expect(CANONICAL_SERVER_ENV_KEYS).toContain('MCP_CORS_ORIGIN')
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
    })
})
