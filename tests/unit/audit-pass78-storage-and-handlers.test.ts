import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { BackupManager } from '../../src/database/sqlite-adapter/backup.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { transformOutsideCodeFences } from '../../src/markdown/converters/utils.js'
import { parseFrontmatter } from '../../src/markdown/frontmatter.js'
import { previewLines } from '../../src/handlers/resources/core/briefing/preview-helpers.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { updateEntryAction } from '../../src/cli/commands/entry.js'

describe('Pass 78 Audit — Storage, Markdown, Briefing, Batch Update & CLI', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedDbPath: string | undefined
    let savedTeamDbPath: string | undefined
    let savedTeamAuthor: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEnc = process.env['DB_ENCRYPTION_KEY']
        savedDbPath = process.env['DB_PATH']
        savedTeamDbPath = process.env['TEAM_DB_PATH']
        savedTeamAuthor = process.env['TEAM_AUTHOR']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedDbPath !== undefined) process.env['DB_PATH'] = savedDbPath
        else delete process.env['DB_PATH']
        if (savedTeamDbPath !== undefined) process.env['TEAM_DB_PATH'] = savedTeamDbPath
        else delete process.env['TEAM_DB_PATH']
        if (savedTeamAuthor !== undefined) process.env['TEAM_AUTHOR'] = savedTeamAuthor
        else delete process.env['TEAM_AUTHOR']
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('B-M1..B-M3 & B-L1..B-L3: invalidates RBAC cache across reopen, treats EPERM lock PID as live, filters self-loops, trims dots before spaces, strips BOM & nests immediate tx', async () => {
        const dir = makeTempDir('mj-p78-store-')
        const teamPath = path.join(dir, 'team.db')
        const teamDb = new DatabaseAdapter(teamPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        expect(teamDb.isTeamRbacActive()).toBe(false)
        teamDb.close()

        const extDb = new Database(teamPath)
        try {
            extDb
                .prepare("INSERT INTO team_members (author, role) VALUES ('alice', 'admin')")
                .run()
        } finally {
            extDb.close()
        }

        await teamDb.initialize()
        try {
            expect(teamDb.isTeamRbacActive()).toBe(true)
        } finally {
            teamDb.close()
        }

        const lockDir = path.join(dir, 'eperm.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(lockFile, JSON.stringify({ pid: 424242, nonce: 'foreign', timestamp: Date.now() }), 'utf8')
        vi.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
        })
        expect(() => acquireRestoreLock(lockDir, lockFile, undefined, 25)).toThrow(
            /Another process is currently holding the database lock/
        )
        vi.restoreAllMocks()

        const mainPath = path.join(dir, 'main.db')
        const db = new DatabaseAdapter(mainPath)
        await db.initialize()
        try {
            const e1 = db.createEntry({ content: 'Self-loop test', workspaceId: 'alpha', projectNumber: 5 })
            db.linkEntries(e1.id, e1.id, 'caused', undefined, 'alpha')
            expect(db.getRelationships(e1.id, 'alpha')).toEqual([])
            expect(db.getRelationshipsForEntries([e1.id], 'alpha').get(e1.id)).toEqual([])

            const backupMgr = new BackupManager(db.connection)
            const exported = await backupMgr.exportToFile('release-v1. ')
            expect(exported.filename).toBe('release-v1.db')

            db.executeInTransaction(() => {
                const nested = db.createEntry({
                    content: 'Nested immediate tx',
                    tags: ['nested-tx'],
                    workspaceId: 'alpha',
                    projectNumber: 5,
                    anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file' }],
                })
                expect(nested.id).toBeGreaterThan(0)
            })
        } finally {
            db.close()
        }

        const bomMd = '\uFEFF```ts\n#not-a-tag\n[[keep]]\n```\n[[real]]'
        const transformed = transformOutsideCodeFences(bomMd, (seg) => seg.replace('[[real]]', 'real'))
        expect(transformed).toContain('[[keep]]')
        expect(transformed).toContain('\nreal')
        expect(transformed.startsWith('\uFEFF')).toBe(false)

        expect(parseFrontmatter('\uFEFF---\n{"tags": ["bom-test"]}\n---\nBody')).toEqual({
            metadata: { tags: ['bom-test'] },
            body: 'Body',
        })
        expect(parseFrontmatter('\uFEFFPlain').body).toBe('Plain')
    })

    it('D-H1, D-H2, D-M1..D-M4 & D-L1: eliminates heading ReDoS, protects default-move source project, scopes batch updates, routes view_file URI, fails fast CLI update & keeps archived flag', async () => {
        const start = performance.now()
        const lines = previewLines(`#${' '.repeat(2000)}X`)
        const elapsedMs = performance.now() - start
        expect(elapsedMs).toBeLessThan(100)
        expect(lines).toEqual(['X'])

        const dir = makeTempDir('mj-p78-tools-')
        const dbPath = path.join(dir, 'personal.db')
        const teamPath = path.join(dir, 'team.db')
        const db = new DatabaseAdapter(dbPath)
        const teamDb = new DatabaseAdapter(teamPath)
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        process.env['DB_PATH'] = dbPath
        process.env['TEAM_DB_PATH'] = teamPath
        process.env['TEAM_AUTHOR'] = 'alice'

        try {
            const runtime = new ServerRuntime()
            const projectRegistry = {
                alpha: { path: dir, project_number: 5 },
                beta: { path: path.join(dir, 'b'), project_number: 9 },
                companion: { path: path.join(dir, 'c'), project_number: 16 },
            }
            const cfg = {
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry },
                projectRegistry,
                runtime,
            }

            const defEntry = db.createEntry({ content: 'default p5', workspaceId: 'default', projectNumber: 5 })
            const moveRes = (await callTool(
                'batch_update_entries',
                {
                    updates: [
                        {
                            entry_id: defEntry.id,
                            workspace_id: 'default',
                            target_workspace_id: 'companion',
                            project_number: 16,
                            content: 'hijacked',
                        },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg
            )) as { notFound?: number[] }
            expect(moveRes.notFound).toContain(defEntry.id)
            expect(db.getEntryById(defEntry.id, '*')?.workspaceId).toBe('default')

            const eAlpha = db.createEntry({ content: 'a1', workspaceId: 'alpha', projectNumber: 5 })
            const eBeta = db.createEntry({ content: 'b1', workspaceId: 'beta', projectNumber: 9 })
            const batchMixed = (await callTool(
                'batch_update_entries',
                {
                    workspace_id: 'alpha',
                    project_number: 5,
                    updates: [
                        { entry_id: eAlpha.id, content: 'a2' },
                        { entry_id: eBeta.id, workspace_id: 'beta', content: 'b2' },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg
            )) as { success?: boolean; updated?: { id: number }[] }
            expect(batchMixed.success).toBe(true)
            expect(db.getEntryById(eBeta.id, '*')?.content).toBe('b2')
            expect(db.getEntryById(eBeta.id, '*')?.projectNumber).toBe(9)

            const tAlpha = teamDb.createEntry({ content: 'ta1', author: 'alice', workspaceId: 'alpha', projectNumber: 5 })
            const tBeta = teamDb.createEntry({ content: 'tb1', author: 'alice', workspaceId: 'beta', projectNumber: 9 })
            const teamBatch = (await callTool(
                'team_batch_update_entries',
                {
                    workspace_id: 'alpha',
                    project_number: 5,
                    updates: [
                        { entry_id: tAlpha.id, content: 'ta2' },
                        { entry_id: tBeta.id, workspace_id: 'beta', content: 'tb2' },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )) as { success?: boolean }
            expect(teamBatch.success).toBe(true)
            expect(teamDb.getEntryById(tBeta.id, '*')?.content).toBe('tb2')
            expect(teamDb.getEntryById(tBeta.id, '*')?.projectNumber).toBe(9)

            const viewRes = (await callTool(
                'view_file',
                { AbsolutePath: 'memory://briefing/alpha' },
                db,
                undefined,
                undefined,
                cfg
            )) as { success?: boolean; code?: string; _healing_note?: string }
            expect(viewRes.code).not.toBe('VALIDATION_ERROR')
            expect(viewRes.success).toBe(true)
            expect(viewRes._healing_note).toContain('memory://briefing/alpha')

            const archived = db.createEntry({ content: 'archived item', workspaceId: 'alpha', projectNumber: 5 })
            db.updateEntry(archived.id, { isArchived: true })
            const recentRes = (await callTool(
                'get_recent_entries',
                { include_archived: undefined, archived: true, workspace_id: 'alpha', project_number: 5 },
                db,
                undefined,
                undefined,
                cfg
            )) as { entries?: { id: number }[] }
            expect(recentRes.entries?.some((r) => r.id === archived.id)).toBe(true)

            const stderrChunks: string[] = []
            vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
                stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
                return true
            })
            vi.spyOn(process, 'exit').mockImplementation((() => {
                throw new Error('PROCESS_EXIT_1')
            }) as never)
            const cliStart = performance.now()
            await expect(
                updateEntryAction(
                    { db: dbPath, id: 999999, expectedVersion: 1, tag: 'meta-only' },
                    new Command()
                )
            ).rejects.toThrow('PROCESS_EXIT_1')
            expect(performance.now() - cliStart).toBeLessThan(1500)
            expect(stderrChunks.join('')).toContain('Entry #999999 not found')
        } finally {
            db.close()
            teamDb.close()
        }
    })
})
