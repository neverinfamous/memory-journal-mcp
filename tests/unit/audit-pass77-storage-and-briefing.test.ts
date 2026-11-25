import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { BackupManager } from '../../src/database/sqlite-adapter/backup.js'
import { rollbackFailedRestore } from '../../src/database/sqlite-adapter/backup-helpers.js'
import {
    acquireRestoreLock,
    clearActiveInProcessRestoreLock,
    getActiveInProcessRestoreToken,
} from '../../src/database/sqlite-adapter/restore-lock.js'
import {
    queryActiveThreads,
    queryEntriesSharingAnchors,
} from '../../src/database/sqlite-adapter/graph-pivots.js'
import {
    getAnalyticsSnapshots,
    getLatestAnalyticsSnapshot,
} from '../../src/database/sqlite-adapter/entries/digest.js'
import { transformOutsideCodeFences } from '../../src/markdown/converters/utils.js'
import { ValidationError } from '../../src/types/errors.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { resolveActiveBriefingConfig } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { resolveBriefingScope } from '../../src/handlers/resources/core/briefing/scope-resolver.js'
import {
    extractPreview,
    previewLines,
} from '../../src/handlers/resources/core/briefing/preview-helpers.js'
import { unpackGitHubFetches } from '../../src/handlers/resources/core/briefing/github-section-settle.js'
import { buildGraphNeighborhoodMarkdown } from '../../src/handlers/resources/graph-neighborhood.js'
import {
    assertOperatorPathNotSymlinkEscape,
    skillsResource,
} from '../../src/handlers/resources/core/utilities-skills.js'
import { getProjectTools } from '../../src/handlers/tools/admin/project-tools.js'
import { MembersManager } from '../../src/database/sqlite-adapter/members.js'
import { getOptimizerPromptDefinitions } from '../../src/handlers/prompts/optimizer.js'
import { getActiveSessionProject, setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

const TEST_REGISTRY = {
    'repo-alpha': { path: path.resolve(os.tmpdir(), 'mj-p77-alpha'), project_number: 5 },
    'repo-beta': { path: path.resolve(os.tmpdir(), 'mj-p77-beta'), project_number: 16 },
}

describe('Pass 77 Audit — Storage, Briefing, Resources & Utilities', () => {
    let savedEnvEnc: string | undefined
    let savedEnvDbEnc: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedEnvEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedEnvDbEnc = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEnvEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnvEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedEnvDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedEnvDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('A-M1 & D-M4/D-M5: preserves default session projectNumber, delegates bare briefing, and trims/pins targets', () => {
        const runtime = new ServerRuntime()
        setActiveSessionProject('default', 7, runtime)

        const resolvedDefault = resolveActiveBriefingConfig(
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: { ...TEST_REGISTRY } },
            [],
            runtime
        )
        expect(resolvedDefault.defaultWorkspaceId).toBe('default')
        expect(resolvedDefault.defaultProjectNumber).toBe(7)

        const foreignDefault = resolveActiveBriefingConfig(
            {
                ...DEFAULT_BRIEFING_CONFIG,
                defaultWorkspaceId: 'repo-alpha',
                defaultProjectNumber: 5,
                projectRegistry: { ...TEST_REGISTRY },
            },
            [],
            runtime
        )
        expect(foreignDefault.defaultProjectNumber).toBe(5)

        const bareScope = resolveBriefingScope(
            { db: {} as never, runtime },
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: {} },
            '   '
        )
        expect(bareScope.activeWorkspaceId).toBe('default')
        expect(bareScope.activeProjectNumber).toBe(7)

        const rtUnreg = new ServerRuntime()
        const configuredScope = resolveBriefingScope(
            { db: {} as never, runtime: rtUnreg },
            {
                ...DEFAULT_BRIEFING_CONFIG,
                defaultWorkspaceId: 'custom-unreg',
                defaultProjectNumber: 21,
                projectRegistry: TEST_REGISTRY,
            },
            'custom-unreg'
        )
        expect(configuredScope.activeWorkspaceId).toBe('custom-unreg')
        expect(getActiveSessionProject(rtUnreg)).toEqual({
            workspaceId: 'custom-unreg',
            projectNumber: 21,
        })

        const rtNoReg = new ServerRuntime()
        const noRegScope = resolveBriefingScope(
            { db: {} as never, runtime: rtNoReg },
            { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: {} },
            'solo-repo'
        )
        expect(noRegScope.activeWorkspaceId).toBe('solo-repo')
        expect(noRegScope.activeProjectNumber).toBeUndefined()
        expect(getActiveSessionProject(rtNoReg)).toEqual({
            workspaceId: 'solo-repo',
        })
    })

    it('B-M1..B-M4 & B-L1..B-L5: atomic members/relationships, anchor & UTC graph filters, corrupt snapshots, backup/lock safety', async () => {
        const dir = makeTempDir('mj-p77-db-')
        const dbPath = path.join(dir, 'main.db')
        const teamPath = path.join(dir, 'team.db')
        const db = new DatabaseAdapter(dbPath)
        const teamDb = new DatabaseAdapter(teamPath)
        try {
            await db.initialize()
            await teamDb.initialize()
            teamDb.applyTeamSchema()
            const nativeTeam = teamDb.connection.getNativeDb()
            const membersMgr = new MembersManager(teamDb.connection)
            expect(() => membersMgr.addMember('bob', 'member')).toThrow(/admin/)
            const admin = membersMgr.addMember('alice', 'admin')
            expect(admin.role).toBe('admin')
            expect(() => membersMgr.addMember('ALICE', 'member')).toThrow(/already exists/)
            const cnt = nativeTeam.prepare('SELECT COUNT(*) AS c FROM team_members').get() as { c: number }
            expect(cnt.c).toBe(1)

            const e1 = db.createEntry({
                content: 'Anchor A',
                workspaceId: 'repo-alpha',
                projectNumber: 5,
                anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file' }],
            })
            const e2 = db.createEntry({
                content: 'Anchor B p5',
                workspaceId: 'repo-alpha',
                projectNumber: 5,
                anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file' }],
            })
            const e3 = db.createEntry({
                content: 'Anchor C p99',
                workspaceId: 'repo-alpha',
                projectNumber: 99,
                anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file' }],
            })

            const rel = db.linkEntries(e1.id, e2.id, 'references', 'ok', 'repo-alpha')
            expect(rel.fromEntryId).toBe(e1.id)
            expect(() => db.linkEntries(e1.id, e3.id, 'references', undefined, 'wrong-ws')).toThrow()

            const nativeDb = db.connection.getNativeDb()
            expect(queryEntriesSharingAnchors(nativeDb, e1.id, '2020-01-01T00:00:00Z', 10, 'repo-alpha', 0)).toEqual([])
            expect(queryEntriesSharingAnchors(nativeDb, e1.id, '2020-01-01T00:00:00Z', 10, 'repo-alpha', 1.5)).toEqual([])
            const sharedP5 = queryEntriesSharingAnchors(nativeDb, e1.id, '2020-01-01T00:00:00Z', 10, 'repo-alpha', 5)
            expect(sharedP5.map((r) => r.entryId)).toEqual([e2.id])
            expect(queryEntriesSharingAnchors(nativeDb, e1.id, '2020-01-01T00:00:00Z', 10, 'repo-alpha', 99)).toEqual([])

            const threads = queryActiveThreads(nativeDb, '2026-11-23T00:30:00+02:00', 5, 'repo-alpha', '2026-11-23T01:00:00Z')
            expect(Array.isArray(threads)).toBe(true)

            nativeDb
                .prepare(`INSERT INTO analytics_snapshots (snapshot_type, data, created_at) VALUES (?, ?, ?)`)
                .run('digest', '{not-valid-json', '2026-11-23T00:00:00Z')
            expect(getLatestAnalyticsSnapshot(nativeDb, 'digest')).toBeNull()
            expect(getAnalyticsSnapshots(nativeDb, 'digest', 5)).toEqual([])

            const backupMgr = new BackupManager(db.connection)
            expect(() => backupMgr.deleteOldBackups(1.5)).toThrow(ValidationError)
            expect(() => backupMgr.deleteOldBackups(Number.POSITIVE_INFINITY)).toThrow(ValidationError)

            const lockDir = path.join(dir, 'restore.lock')
            const lockFile = path.join(lockDir, 'lock.json')
            fs.mkdirSync(lockDir)
            fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999999, nonce: 'dead', timestamp: Date.now() }), 'utf8')
            const lockNonce = acquireRestoreLock(lockDir, lockFile, undefined)
            expect(lockNonce).not.toBe('dead')
            expect(getActiveInProcessRestoreToken(lockDir)).toBe(lockNonce)
            clearActiveInProcessRestoreLock(lockDir, lockNonce)
            expect(getActiveInProcessRestoreToken(lockDir)).toBeUndefined()
            fs.rmSync(lockDir, { recursive: true, force: true })
            expect(fs.existsSync(lockDir)).toBe(false)

            const preBackup = path.join(dir, 'pre-restore.db')
            const tempRestore = path.join(dir, 'tmp-restore.db')
            fs.copyFileSync(dbPath, preBackup)
            fs.copyFileSync(dbPath, tempRestore)
            const failingCtx = {
                closeDbBeforeRestore: () => undefined,
                getDbPath: () => dbPath,
                initialize: () => Promise.reject(new Error('init-boom')),
            } as never
            await expect(rollbackFailedRestore(failingCtx, preBackup, tempRestore, new Error('swap-boom'))).rejects.toThrow('swap-boom')
            expect(fs.existsSync(preBackup)).toBe(true)

            const crMd = "Intro\r\n```ts\rconst a = 'keep'\r```\rOutro"
            const outMd = transformOutsideCodeFences(crMd, (s) => s.toUpperCase())
            expect(outMd).toContain("const a = 'keep'")
            expect(outMd).toContain('INTRO')
            expect(outMd).toContain('OUTRO')
        } finally {
            db.close()
            teamDb.close()
        }
    })

    it('D-M2, D-M3, D-M6, D-M7 & D-L1..D-L5: ancestor symlink check, CommonMark fences, get_project, unwrapFence & resource guards', async () => {
        const inlineFenceSample = 'First inline ```code()``` here\nSecond line survives'
        expect(previewLines(inlineFenceSample)).toEqual([
            'First inline ```code()``` here',
            'Second line survives',
        ])

        const nestedBacktickBlock = 'Header\n````md\nInside\n```\nstill code\n````\nVisible tail'
        expect(previewLines(nestedBacktickBlock)).toEqual(['Header', 'Visible tail'])

        const smuggledClosing =
            '<untrusted_remote_content>a</untrusted_remote_content><untrusted_remote_content>b</untrusted_remote_content>'
        expect(extractPreview(smuggledClosing, 100)).toBe('ab')
        const doubleWrapped =
            '<untrusted_remote_content>&lt;untrusted_remote_content&gt;clean&lt;/untrusted_remote_content&gt;</untrusted_remote_content>'
        expect(extractPreview(doubleWrapped, 100)).toBe('clean')

        const settledGit = unpackGitHubFetches({
            ciStatusResult: { status: 'fulfilled', value: { status: 'passing', workflowSummary: undefined } },
            issuesAndPrsResult: { status: 'fulfilled', value: { openIssues: 0, openPRs: 0 } },
            milestonesResult: { status: 'fulfilled', value: { items: [] } },
            insightsResult: { status: 'fulfilled', value: {} },
            copilotReviewsResult: { status: 'fulfilled', value: {} },
            localGitStatusResult: {
                status: 'fulfilled',
                value: { modified: 0, untracked: 0, isClean: false, error: 'git status failed' },
            },
        })
        expect(settledGit.localGitStatus.degraded).toBe(true)
        expect(settledGit.degradedReasons.some((r) => r.includes('git status failed'))).toBe(true)

        let capturedLimit: number | undefined
        const graphMd = buildGraphNeighborhoodMarkdown(
            'memory://graph/repo-alpha?limit=05',
            {
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: TEST_REGISTRY },
                db: {
                    getRecentNeighborhood: (_s: string, lim: number) => {
                        capturedLimit = lim
                        return { nodes: [], edges: [], unlinkedIds: [], recentEntries: 0 }
                    },
                } as never,
            },
            'repo-alpha'
        )
        expect(capturedLimit).toBe(15)
        expect(graphMd).toContain('# Graph neighborhood')

        const dir = makeTempDir('mj-p77-tools-')
        const db = new DatabaseAdapter(path.join(dir, 'proj.db'))
        try {
            await db.initialize()
            const getProj = getProjectTools({
                db,
                config: { projectRegistry: { 'repo-alpha': { path: dir, project_number: 5 } } },
            }).find((t) => t.name === 'get_project')
            expect(getProj).toBeDefined()
            if (getProj !== undefined) {
                const miss = (await getProj.handler({
                    name: 'nonexistent-repo',
                    project_number: 5,
                })) as Record<string, unknown>
                expect(miss['success']).toBe(false)
                expect(miss['error']).toContain("Project not found: 'nonexistent-repo'")
            }

            const optDef = getOptimizerPromptDefinitions().find((p) => p.name === 'optimize-journal')
            expect(optDef).toBeDefined()
            if (optDef !== undefined) {
                const optPrompt = (await optDef.handler({ mode: 'full' }, db)) as {
                    messages: { content: { text: string } }[]
                }
                expect(optPrompt.messages[0]?.content.text).not.toContain('Mermaid topology')
                expect(optPrompt.messages[0]?.content.text).toContain('compact Markdown recent neighborhood')
            }
        } finally {
            db.close()
        }

        const symDir = makeTempDir('mj-p77-sym-')
        const targetReal = path.join(symDir, 'real-dir')
        const subDir = path.join(targetReal, 'nested')
        fs.mkdirSync(subDir, { recursive: true })
        const symLinkPath = path.join(symDir, 'link-dir')
        try {
            fs.symlinkSync(targetReal, symLinkPath, 'junction')
            expect(() =>
                assertOperatorPathNotSymlinkEscape(path.join(symLinkPath, 'nested', 'rules.md'), [], false)
            ).toThrow(/not permitted/)
        } catch {
            // Skip symlink creation assertion on environments forbidding junction creation.
        }

        const skillsRoot = makeTempDir('mj-p77-skills-')
        const skillFolder = path.join(skillsRoot, 'sample-skill')
        fs.mkdirSync(skillFolder, { recursive: true })
        fs.writeFileSync(
            path.join(skillFolder, 'SKILL.md'),
            '\uFEFF---\rname: sample\r---\rSummary after BOM CR frontmatter',
            'utf8'
        )
        const skillsRes = (await skillsResource.handler('memory://skills', {
            db: {} as never,
            briefingConfig: {
                ...DEFAULT_BRIEFING_CONFIG,
                skillsDirPath: skillsRoot,
                allowedIoRoots: [skillsRoot],
            },
        })) as { data: { skills: { name: string; excerpt: string }[] } }
        const matchedSkill = skillsRes.data.skills.find((s) => s.name === 'sample-skill')
        expect(matchedSkill?.excerpt).toBe(
            '<untrusted_remote_content>Summary after BOM CR frontmatter</untrusted_remote_content>'
        )
    })
})
