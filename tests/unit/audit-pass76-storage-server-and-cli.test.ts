import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { applyLegacyCommitNormalization } from '../../src/database/migrations/legacy-commit-normalization.js'
import { VisualizeInputSchemaMcp } from '../../src/handlers/tools/relationship-schemas.js'
import { baseEntryOptionsSchema } from '../../src/cli/schemas.js'
import { getGitHubMilestoneTools } from '../../src/handlers/tools/github/milestone-tools.js'
import { getStalenessTools } from '../../src/handlers/tools/core/staleness-tools.js'
import { GetEntryHistorySchema } from '../../src/handlers/tools/core/schemas.js'
import { validateOAuthTransportConfig } from '../../src/transports/http/security.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { assertSafeJwksUri } from '../../src/auth/jwks-ssrf-guard.js'
import { resolveRegistryConfigPath } from '../../src/utils/registry-config-file.js'
import { createRegisterProjectFn } from '../../src/codemode/api/project-registry-ops.js'
import { getAdminTools } from '../../src/handlers/tools/admin/index.js'
import { executeTeamRebuildVectorIndex } from '../../src/handlers/tools/team/vector-helpers.js'
import { logger } from '../../src/utils/logger.js'
import { RepositoryManager } from '../../src/github/github-integration/repository.js'
import type { GitHubClient } from '../../src/github/github-integration/client.js'
import type { ToolContext } from '../../src/types/index.js'

describe('Pass 76 Audit — Storage, Schemas, CLI, Auth, Registry & GitHub', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedCfg: string | undefined
    const tempDirs: string[] = []

    beforeEach(() => {
        savedEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEnc = process.env['DB_ENCRYPTION_KEY']
        savedCfg = process.env['MEMORY_JOURNAL_CONFIG']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedCfg !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedCfg
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('M1 & L1: createEntry and applyLegacyCommitNormalization acquire immediate write transactions when top-level', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const nativeDb = db.connection.getNativeDb()
            let sawImmediate = false
            const origTx = nativeDb.transaction.bind(nativeDb)
            vi.spyOn(nativeDb, 'transaction').mockImplementation(((fn: (...a: unknown[]) => unknown) => {
                const wrapped = origTx(fn)
                const origImmediate = wrapped.immediate.bind(wrapped)
                return Object.assign((...a: unknown[]) => wrapped(...a), {
                    immediate: (...a: unknown[]) => {
                        sawImmediate = true
                        return origImmediate(...a)
                    },
                })
            }) as never)

            const created = db.createEntry({
                content: 'Immediate write check',
                workspaceId: 'ws-p76',
                projectNumber: 5,
            })
            expect(created.id).toBeGreaterThan(0)
            expect(sawImmediate).toBe(true)

            sawImmediate = false
            applyLegacyCommitNormalization(nativeDb)
            expect(sawImmediate).toBe(true)
        } finally {
            db.close()
        }
    })

    it('M9 & M11 & L11 & staleness: schema aliases, CLI p5 project, entry history > 0, and mark_anchors_stale normalization', async () => {
        const viz = VisualizeInputSchemaMcp.parse({ entry_id: 1, path: 4, keep: 35 })
        expect(viz.depth).toBe(4)
        expect(viz.limit).toBe(35)
        const vizDefaults = VisualizeInputSchemaMcp.parse({ entry_id: 1 })
        expect(vizDefaults.depth).toBe(2)
        expect(vizDefaults.limit).toBe(20)

        const cliOpts = baseEntryOptionsSchema.parse({ project: 'p5', projectNumber: 'P16', project_number: '7' })
        expect(cliOpts.project).toBe(5)
        expect(cliOpts.projectNumber).toBe(16)
        expect(cliOpts.project_number).toBe(7)
        expect(() => baseEntryOptionsSchema.parse({ project: '0' })).toThrow()
        expect(() => baseEntryOptionsSchema.parse({ project: '-2' })).toThrow()

        expect(() => GetEntryHistorySchema.parse({ entry_id: 0 })).toThrow()
        expect(() => GetEntryHistorySchema.parse({ entry_id: -3 })).toThrow()
        expect(GetEntryHistorySchema.parse({ entry_id: 12 }).entry_id).toBe(12)

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const staleTool = getStalenessTools({ db } as unknown as ToolContext).find(
                (t) => t.name === 'mark_anchors_stale'
            )
            if (!staleTool) throw new Error('Expected mark_anchors_stale tool')
            const res = (await staleTool.handler({
                anchors: [{ anchorId: '999', status: 'outdated' }],
                workspace_id: 'ws-a',
                project_number: 5,
            })) as { success: boolean; not_found_ids?: number[] }
            expect(res.success).toBe(false)
            expect(res.not_found_ids).toEqual([999])
        } finally {
            db.close()
        }
    })

    it('M13: Milestone create/update schemas validate due_on format strictly', async () => {
        const createMilestoneMock = vi.fn().mockResolvedValue({
            number: 1,
            title: 'v1.0',
            state: 'open',
            openIssues: 0,
            closedIssues: 0,
            dueOn: '2026-12-31T08:00:00Z',
            url: 'https://github.com/org/repo/milestones/1',
        })
        const tools = getGitHubMilestoneTools({
            db: {} as ToolContext['db'],
            github: {
                isApiAvailable: () => true,
                createMilestone: createMilestoneMock,
                updateMilestone: vi.fn(),
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'org', repo: 'repo', branch: 'main', remoteUrl: '' }),
                getCachedRepoInfo: () => ({ owner: 'org', repo: 'repo', branch: 'main', remoteUrl: '' }),
            } as unknown as ToolContext['github'],
        })
        const createTool = tools.find((t) => t.name === 'create_github_milestone')
        const updateTool = tools.find((t) => t.name === 'update_github_milestone')
        if (!createTool || !updateTool) throw new Error('Expected milestone tools')

        const badCreate = (await createTool.handler({
            title: 'v1',
            due_on: 'not-a-date',
            owner: 'org',
            repo: 'repo',
        })) as { success: boolean; code?: string }
        expect(badCreate.success).toBe(false)
        expect(badCreate.code).toBe('VALIDATION_ERROR')
        expect(createMilestoneMock).not.toHaveBeenCalled()

        const badUpdate = (await updateTool.handler({
            milestone_number: 1,
            due_on: '2026/12/31',
            owner: 'org',
            repo: 'repo',
        })) as { success: boolean; code?: string }
        expect(badUpdate.success).toBe(false)
        expect(badUpdate.code).toBe('VALIDATION_ERROR')

        const okCreate = (await createTool.handler({
            title: 'v1.0',
            due_on: '2026-12-31',
            owner: 'org',
            repo: 'repo',
        })) as { success: boolean }
        expect(okCreate.success).toBe(true)
        expect(createMilestoneMock).toHaveBeenCalledWith('org', 'repo', 'v1.0', undefined, '2026-12-31T08:00:00Z')
    })

    it('L4, L7, L9, L10: rejects embedded URL credentials, honors ConfigManager registry path + sync, logs rebuild session_id, and checks exact github hostname', async () => {
        expect(() =>
            validateOAuthTransportConfig(
                {
                    port: 3000,
                    oauthEnabled: true,
                    oauthIssuer: 'https://user:pass@auth.example.com',
                    oauthAudience: 'api',
                },
                '127.0.0.1',
                true,
                () => undefined
            )
        ).toThrow(/embedded credentials/i)

        expect(
            () =>
                new TokenValidator({
                    jwksUri: 'https://user:secret@auth.example.com/.well-known/jwks.json',
                    issuer: 'https://auth.example.com',
                    audience: 'api',
                })
        ).toThrow(/embedded credentials/i)

        await expect(
            assertSafeJwksUri('https://tok:sec@auth.example.com/.well-known/jwks.json')
        ).rejects.toThrow(/embedded credentials/i)

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p76-reg-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'custom-config.json')
        delete process.env['MEMORY_JOURNAL_CONFIG']
        expect(resolveRegistryConfigPath(cfgFile)).toBe(path.resolve(cfgFile))

        let syncedReg: Record<string, unknown> | undefined
        const regFn = createRegisterProjectFn(
            { createEntry: async () => ({ success: true }) },
            [tmpDir],
            {
                getConfigFilePath: () => cfgFile,
                onRegistryUpdate: (next) => {
                    syncedReg = next
                },
            }
        )
        const regRes = await regFn('custom-proj', tmpDir, 22)
        expect(regRes.success).toBe(true)
        expect(fs.existsSync(cfgFile)).toBe(true)
        expect(syncedReg?.['custom-proj']).toMatchObject({ project_number: 22 })

        const warnSpy = vi.spyOn(logger, 'warning').mockImplementation(() => undefined)
        const rebuildTool = getAdminTools({
            db: {} as ToolContext['db'],
            vectorManager: {
                rebuildIndex: async () => ({ success: false, indexed: 0, failed: 1, firstError: 'vec err' }),
            } as unknown as ToolContext['vectorManager'],
        }).find((t) => t.name === 'rebuild_vector_index')
        if (!rebuildTool) throw new Error('Expected rebuild_vector_index')
        await rebuildTool.handler({ session_id: 'sess-p76-1' })
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('vec err'), { sessionId: 'sess-p76-1' })

        await executeTeamRebuildVectorIndex(
            {
                db: {} as ToolContext['db'],
                teamDb: {} as ToolContext['teamDb'],
                teamVectorManager: {
                    rebuildIndex: async () => ({ success: false, indexed: 0, failed: 1, firstError: 'team vec err' }),
                } as unknown as ToolContext['teamVectorManager'],
            },
            { session_id: 'team-sess-p76' }
        )
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('team vec err'), { sessionId: 'team-sess-p76' })

        const makeClient = (remote: string): GitHubClient =>
            ({
                git: {
                    branch: async () => ({ current: 'main' }),
                    getRemotes: async () => [{ name: 'origin', refs: { fetch: remote } }],
                },
                getCached: () => undefined,
                setCache: () => undefined,
            }) as unknown as GitHubClient
        const validWww = await new RepositoryManager(makeClient('https://www.github.com/org/repo.git')).getRepoInfo()
        expect(validWww.owner).toBe('org')
        expect(validWww.repo).toBe('repo')
        const badLookalike = await new RepositoryManager(makeClient('https://evil-github.com/org/repo.git')).getRepoInfo()
        expect(badLookalike.owner).toBeNull()
        expect(badLookalike.repo).toBeNull()
    })
})
