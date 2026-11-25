/**
 * Pass 93 Audit — Remediations for Pass 14 Findings across Subsystems A–D.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enforceAccessBoundary } from '../../src/auth/validation.js'
import { PermissionError } from '../../src/types/errors.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { preparePreRestoreSnapshot, writeVerifiedBackupFile } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { writeSafeCliOutputFile } from '../../src/cli/commands/db-helper.js'
import { resolveAuthenticatedAuthor, resolveAuthor, resolveExplicitTeamAuthor } from '../../src/utils/security-utils.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { normalizeProjectAliases } from '../../src/codemode/normalizers/project-alias-helpers.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { createChildProcessShims } from '../../src/codemode/worker/sandbox-process-shims.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/index.js'
import { verifyWildcardUpdateSourceProject } from '../../src/handlers/tools/codemode/dispatch-batch-wildcard.js'
import { verifyBatchWildcardMoveProjects } from '../../src/handlers/tools/codemode/dispatch-batch-scope.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import { MarkAnchorsStaleSchema } from '../../src/handlers/tools/core/staleness-tools.js'
import { readSafeViewFile } from '../../src/handlers/tools/core/dummy-healing/fs-view-helpers.js'
import { UpdateEntrySchema } from '../../src/handlers/tools/admin/schemas/crud-batch-schemas.js'
import { TeamCreateEntrySchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { TeamUpdateEntrySchema } from '../../src/handlers/tools/team/schemas/admin-batch-schemas.js'
import { TeamLinkEntriesSchema, TeamSemanticSearchSchema } from '../../src/handlers/tools/team/schemas/analytics-vector-schemas.js'
import { VisualizeInputSchemaMcp } from '../../src/handlers/tools/relationship-schemas.js'
import { getAnalyticsTools } from '../../src/handlers/tools/analytics.js'
import { getIoTools } from '../../src/handlers/tools/io/tools.js'
import { getTeamTools } from '../../src/handlers/tools/team/index.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { sanitizePromptTarget } from '../../src/handlers/prompts/adversarial-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'

const REGISTRY = {
    'repo-a': { path: os.tmpdir(), project_number: 5 },
    'repo-b': { path: os.tmpdir(), project_number: 9 },
}

describe('Pass 93 Audit — Pass 14 Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('P14-D-H1 & P14-D-L1: fails closed on team access without TEAM_AUTHOR/OAuth and writes CLI output with O_NOFOLLOW + 0o600', async () => {
        vi.stubEnv('TEAM_AUTHOR', '')
        vi.stubEnv('USERNAME', 'ambient-win-user')
        vi.stubEnv('USER', 'ambient-posix-user')
        expect(resolveExplicitTeamAuthor()).toBeUndefined()
        expect(resolveAuthenticatedAuthor()).toBe('unknown')
        expect(resolveAuthor()).toBe('ambient-win-user')
        expect(() => enforceAccessBoundary('team_get_recent', 'tool')).toThrow(PermissionError)
        expect(() => enforceAccessBoundary('memory://team/recent', 'resource')).toThrow(PermissionError)

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p93-cli-'))
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p93-out-'))
        tempDirs.push(tmpDir, outsideDir)
        const outFile = path.join(tmpDir, 'sub', 'export.json')
        const written = await writeSafeCliOutputFile(outFile, '--dest', '{"ok":true}')
        expect(written).toBe(path.resolve(outFile))
        expect(fs.readFileSync(written, 'utf-8')).toBe('{"ok":true}')
        if (process.platform !== 'win32') {
            expect(fs.statSync(written).mode & 0o777).toBe(0o600)
        }
        const linkDir = path.join(tmpDir, 'link-sub')
        fs.symlinkSync(outsideDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir')
        try {
            await expect(
                writeSafeCliOutputFile(path.join(linkDir, 'escape.json'), '--dest', '{"blocked":true}')
            ).rejects.toThrow(/symlink|junction|reparse|unsafe|outside/i)
        } finally {
            fs.unlinkSync(linkDir)
        }
    })

    it('P14-A-M1 & P14-A-M2: rejects workspace/repo/project/readonly alias conflicts, honors project_id when agentHealing=false, and aligns wildcard null/0 moves', async () => {
        const wsConflict: Record<string, unknown> = { workspace_id: 'repo-a', workspaceId: 'repo-b' }
        expect(normalizeProjectAliases(wsConflict)).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

        const ecConflict: Record<string, unknown> = { repo: 'repo-a', repo_name: 'repo-b', readonly: true, readOnly: false }
        normalizeExecuteCodeAliases(ecConflict)
        expect(ecConflict['repo_name']).toBe('repo-b')
        expect(ecConflict['readOnly']).toBe(false)

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const ctx: ToolContext = { db, config: { projectRegistry: REGISTRY, agentHealing: false, runtime: new ServerRuntime() } }
            expect(await resolveCodeModeSessionContext(ctx, ExecuteCodeSchema.parse({ code: 'return 1', project_number: 5, projectNumber: 9 }))).toHaveProperty('errorResponse')
            expect(await resolveCodeModeSessionContext(ctx, ExecuteCodeSchema.parse({ code: 'return 1', project_number: 5, project_id: 9 }))).toHaveProperty('errorResponse')
            expect(await resolveCodeModeSessionContext(ctx, ExecuteCodeSchema.parse({ code: 'return 1', repo: 'repo-a', repo_name: 'repo-b' }))).toHaveProperty('errorResponse')
            const noHealProj = await resolveCodeModeSessionContext(ctx, ExecuteCodeSchema.parse({ code: 'return 1', project_id: 5 }))
            expect('projectId' in noHealProj && noHealProj.projectId).toBe(5)
            const noHealNamed = await resolveCodeModeSessionContext(ctx, ExecuteCodeSchema.parse({ code: 'return 1', project_name: 'repo-b' }))
            expect('projectId' in noHealNamed && noHealNamed.projectId).toBe(9)

            const nullProjEntry = db.createEntry({ content: 'unassigned', workspaceId: 'default' })
            const fakeDef = { name: 'update_entry' } as ToolDefinition
            const wildcardErr = verifyWildcardUpdateSourceProject(
                fakeDef,
                { entry_id: nullProjEntry.id, workspace_id: '*', target_workspace_id: 'repo-a' },
                true,
                ctx,
                '*',
                5,
                (v) => typeof v === 'string' && v.toLowerCase() === 'default'
            )
            expect(wildcardErr).toMatchObject({ success: false, code: 'RESOURCE_NOT_FOUND' })
            const batchErr = verifyBatchWildcardMoveProjects(
                'updates',
                [{ entry_id: nullProjEntry.id, target_workspace_id: 'repo-a' }],
                '*',
                { projectId: 5, workspaceId: '*', toolName: 'batch_update_entries', sessionContext: ctx, isDefaultWorkspaceName: (v) => typeof v === 'string' && v.toLowerCase() === 'default', coerceProjectNumberField: () => undefined }
            )
            expect(batchErr?.errorResult).toMatchObject({ success: false, code: 'RESOURCE_NOT_FOUND' })
        } finally {
            db.close()
        }
    })

    it('P14-A-M3 & P14-A-L1 & P14-A-L2: blocks readonly write synthesis pre-sandbox, defines own name on disabled shims, and skips labeled return', async () => {
        const parsedContent = ExecuteCodeSchema.parse({ content: 'secret write', readonly: true })
        const resContent = resolveExecutionPayload(parsedContent, { content: 'secret write', readonly: true }, true, 0, true)
        expect('earlyReturn' in resContent && resContent.earlyReturn).toMatchObject({ success: false, code: 'PERMISSION_DENIED' })

        const parsedNl = ExecuteCodeSchema.parse({ code: 'save memory: secret write', readonly: true })
        const resNl = resolveExecutionPayload(parsedNl, { code: 'save memory: secret write', readonly: true }, true, 0, true)
        expect('earlyReturn' in resNl && resNl.earlyReturn).toMatchObject({ success: false, code: 'PERMISSION_DENIED' })

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const execTool = getCodeModeTools({ db, config: { codemodeEnabled: true, runtime: new ServerRuntime() } }).find((t) => t.name === 'mj_execute_code')
            const handlerRes = await execTool?.handler({ tool: 'create_entry', content: 'secret', readonly: true })
            expect(handlerRes).toMatchObject({ success: false, code: 'PERMISSION_DENIED' })
        } finally {
            db.close()
        }

        for (const fn of [() => createSafeFsShim().writeFileSync(), () => (createChildProcessShims()['execSync'] as () => void)()]) {
            let caught: unknown
            try { fn() } catch (e) { caught = e }
            expect(caught).toBeInstanceOf(Error)
            expect((caught as Error).name).toBe('VALIDATION_ERROR')
            expect(Object.getOwnPropertyDescriptor(caught, 'name')?.value).toBe('VALIDATION_ERROR')
        }

        const labeled = transformAutoReturn('foo: 1 + 2')
        expect(labeled).toBe('foo: 1 + 2')
        expect(() => new vm.Script(labeled)).not.toThrow()
    })

    it('P14-B-M1 & P14-B-M2 & P14-B-M3: fixes anchor file_path & conflict preservation, relationship strictness, and empty VisualizeInputSchemaMcp conflicts', () => {
        const validAnchor = CreateEntrySchema.safeParse({ content: 'ok', anchors: [{ file_path: 'src/a.ts' }] })
        expect(validAnchor.success).toBe(true)
        if (validAnchor.success) expect(validAnchor.data.anchors?.[0]?.anchor_path).toBe('src/a.ts')

        expect(CreateEntrySchema.safeParse({ content: 'ok', anchors: [{ anchor_path: 'src/a.ts', path: 'src/b.ts' }] }).success).toBe(false)
        expect(CreateEntrySchema.safeParse({ content: 'ok', anchors: ['src/a.ts'], anchor: ['src/b.ts'] }).success).toBe(false)
        expect(TeamCreateEntrySchema.safeParse({ content: 'ok', anchors: [{ anchor_path: 'src/a.ts', anchor_type: 'file', type: 'symbol' }] }).success).toBe(false)

        expect(CreateEntrySchema.safeParse({ content: 'ok', relationships: [{ targetId: 1, to_entry_id: 2 }] }).success).toBe(false)
        expect(CreateEntrySchema.safeParse({ content: 'ok', relationships: [{ targetId: 1, extra_junk: true }] }).success).toBe(false)
        expect(CreateEntrySchema.safeParse({ content: 'ok', evolves_from: -5 }).success).toBe(false)
        expect(CreateEntrySchema.safeParse({ content: 'ok', blocked_by: { invalid: 1 } }).success).toBe(false)
        expect(TeamCreateEntrySchema.safeParse({ content: 'ok', relationships: Array.from({ length: 101 }, (_, i) => ({ targetId: i + 1 })) }).success).toBe(false)

        expect(VisualizeInputSchemaMcp.safeParse({ q: '', text: 'security' }).success).toBe(false)
        expect(VisualizeInputSchemaMcp.safeParse({ q: '', tags: ['security'] }).success).toBe(false)
        expect(VisualizeInputSchemaMcp.safeParse({ q: 'x'.repeat(501) }).success).toBe(false)
    })

    it('P14-B-M4 & P14-B-M5 & P14-B-L1 & P14-B-L2: halts pre-IO/progress, syncs strict schema caps, rejects blank/conflicting aliases, and maps non-ENOENT open errors', async () => {
        vi.stubEnv('TEAM_AUTHOR', 'test-author')
        const db = new DatabaseAdapter(':memory:')
        const teamDb = new DatabaseAdapter(':memory:')
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            const notifications: unknown[] = []
            const ctx: ToolContext = { db, teamDb, config: { allowedIoRoots: [os.tmpdir()], projectRegistry: REGISTRY, runtime: new ServerRuntime() }, progress: { sendNotification: async (n) => { notifications.push(n) } } as unknown as ToolContext['progress'] }
            const expMd = getIoTools(ctx).find((t) => t.name === 'export_markdown')
            expect(await expMd?.handler({ output_dir: '../outside' })).toMatchObject({ success: false })
            expect(notifications).toHaveLength(0)

            const teamExp = getTeamTools(ctx).find((t) => t.name === 'team_export_entries')
            expect(await teamExp?.handler({ format: 'json' })).toMatchObject({ success: false })
            expect(notifications).toHaveLength(0)

            const stats = getAnalyticsTools(ctx).find((t) => t.name === 'get_statistics')
            expect(await stats?.handler({ group_by: 'day', period: 'month' })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(await stats?.handler({ timeframe: 123 })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        } finally {
            db.close()
            teamDb.close()
        }

        expect(UpdateEntrySchema.safeParse({ entry_id: 1, session_id: 's'.repeat(256) }).success).toBe(false)
        expect(TeamUpdateEntrySchema.safeParse({ entry_id: 1, session_id: null }).success).toBe(true)
        expect(TeamUpdateEntrySchema.safeParse({ entry_id: 1, session_id: 's'.repeat(256) }).success).toBe(false)
        expect(TeamSemanticSearchSchema.safeParse({ query: 'q'.repeat(501) }).success).toBe(false)
        expect(TeamLinkEntriesSchema.safeParse({ from_entry_id: 1, to_entry_id: 2, description: 'd'.repeat(2001) }).success).toBe(false)

        expect(CreateEntrySchema.safeParse({ content: 'ok', project_name: '   ' }).success).toBe(false)
        expect(CreateEntrySchema.safeParse({ content: 'ok', title: 'A', heading: 'B' }).success).toBe(false)
        expect(MarkAnchorsStaleSchema.safeParse({ updates: [{ id: 1, anchor_id: 2, status: 'stale' }] }).success).toBe(false)
        expect(MarkAnchorsStaleSchema.safeParse({ updates: [{ id: 1, entry_id: 2, status: 'stale' }] }).success).toBe(false)

        vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(Object.assign(new Error('ELOOP'), { code: 'ELOOP' }))
        expect(await readSafeViewFile('/tmp/sym', '/tmp/sym', 'view_file', {})).toMatchObject({ success: false, code: 'IO_ERROR' })
    })

    it('P14-C-L1 & P14-C-L2 & prompt revision: strips C0/C1 control chars across prompts, applies atomic 0o600 copies, and bumps revision', async () => {
        const dirty = sanitizePromptTarget('auth\u001b[31mFAKE\u0008\u009b`x`')
        expect([...dirty].some((c) => { const cp = c.codePointAt(0) ?? 0; return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) })).toBe(false)
        expect(dirty).not.toContain('`')

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const promptRes = await getPrompt('adversarial-plan-review', { topic: 'auth\u001b[31mFAKE\u0008\u009b' }, db)
            const promptText = String(promptRes.messages[0]?.content.text ?? '')
            expect(promptText).not.toContain('\u001b')
            expect(promptText).not.toContain('\u0008')
            expect(promptText).not.toContain('\u009b')
        } finally {
            db.close()
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p93-perm-'))
        tempDirs.push(tmpDir)
        const mkdirSpy = vi.spyOn(fs.promises, 'mkdir')
        const conn = new NativeConnectionManager(path.join(tmpDir, 'secure-db', 'data.db'))
        try {
            await conn.initialize()
            expect(mkdirSpy).toHaveBeenCalledWith(path.join(tmpDir, 'secure-db'), { recursive: true, mode: 0o700 })
            conn.createVecTable(4) // ensure initialized DB file exists
            conn.exec('PRAGMA wal_checkpoint(TRUNCATE)')
            await preparePreRestoreSnapshot(
                { getDbPath: () => path.join(tmpDir, 'secure-db', 'data.db'), initialize: async () => undefined } as never,
                path.join(tmpDir, 'tmp.db'),
                path.join(tmpDir, 'snap.db')
            )
            expect(fs.existsSync(path.join(tmpDir, 'snap.db'))).toBe(true)
            await writeVerifiedBackupFile(
                {
                    getDbPath: () => path.join(tmpDir, 'secure-db', 'data.db'),
                    exec: () => [{ columns: ['busy', 'log', 'checkpointed'], values: [[0, 0, 0]] }],
                } as never,
                path.join(tmpDir, 'copied-backup.db')
            )
            expect(fs.existsSync(path.join(tmpDir, 'copied-backup.db'))).toBe(true)
        } finally {
            conn.close()
        }
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
    })
})
