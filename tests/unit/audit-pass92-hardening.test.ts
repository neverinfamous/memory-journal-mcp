/**
 * Pass 92 Audit — Remediations for Pass 13 Findings across Subsystems A–D.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { applySwappedDatabase, preparePreRestoreSnapshot } from '../../src/database/sqlite-adapter/backup-helpers.js'
import type { IDatabaseConnection } from '../../src/database/core/interfaces.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getGitHubIntegration } from '../../src/github/github-integration/index.js'
import { normalizeProjectAliases } from '../../src/codemode/normalizers/project-alias-helpers.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getBackupTools } from '../../src/handlers/tools/backup.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { getCreateGitHubIssueTool } from '../../src/handlers/tools/github/create-issue-tool.js'
import { getCloseGitHubIssueTool } from '../../src/handlers/tools/github/close-issue-tool.js'
import { getGitHubMilestoneTools } from '../../src/handlers/tools/github/milestone-tools.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import { TeamCreateEntrySchema, TeamSearchSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { SearchAuditLogSchema } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { ListAuthorAliasesSchema } from '../../src/handlers/tools/team/alias-schemas.js'
import {
    LinkEntriesSchema,
    LinkEntriesSchemaMcp,
    VisualizeInputSchema,
    VisualizeInputSchemaMcp,
} from '../../src/handlers/tools/relationship-schemas.js'
import { healAnchorsField } from '../../src/handlers/tools/schemas/hallucination-healer-anchors.js'
import { healIncludeArchivedField } from '../../src/handlers/tools/schemas/hallucination-healer-fields.js'
import { healSearchPayload, unpackFilterContainers } from '../../src/handlers/tools/schemas/hallucination-healer-search.js'
import { readAndConvertExternalMarkdownFiles } from '../../src/handlers/tools/team/io-scope-helpers.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { readSafeRegularConfigTextSync } from '../../src/utils/config-file-safety.js'
import { parseConfigObjectContent, readCachedConfigObject } from '../../src/utils/registry-config-file.js'
import { readBoundedCliInputFile } from '../../src/cli/commands/cli-input-reader.js'

const REGISTRY = {
    alpha: { path: os.tmpdir(), project_number: 5 },
    beta: { path: os.tmpdir(), project_number: 9 },
}

function makeFakeSwapConn(dbPath: string): IDatabaseConnection {
    return {
        getDbPath: () => dbPath,
        initialize: async () => undefined,
        close: () => undefined,
        query: async () => [],
        execute: async () => undefined,
        exec: () => [{ columns: ['integrity_check'], values: [['ok']] }],
        getNativeDb: () =>
            ({
                prepare: (sql: string) => ({
                    get: () => (sql.includes('integrity_check') ? { integrity_check: 'ok' } : undefined),
                    all: () => [],
                }),
            }) as unknown as ReturnType<NonNullable<IDatabaseConnection['getNativeDb']>>,
    }
}

describe('Pass 92 Audit — Pass 13 Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('P13-A-H1: normalizes and validates project_id, projectId, project_name, and projectName across RPC bounds', async () => {
        const promoA: Record<string, unknown> = { project_id: 9 }
        expect(normalizeProjectAliases(promoA, false)).toBeUndefined()
        expect(promoA['project_number']).toBe(9)
        expect(promoA['project_id']).toBeUndefined()

        const promoB: Record<string, unknown> = { project_number: 5, project_id: 9 }
        normalizeProjectAliases(promoB, false)
        expect(promoB['project_id']).toBe(9)

        const intercepted = applyArgInterceptions('create_entry', [{ content: 'x', projectId: '12' }])
        expect('args' in intercepted && (intercepted.args[0] as Record<string, unknown>)['project_number']).toBe(12)

        const createDef = { name: 'create_entry' } as ToolDefinition
        expect(validateRpcOverrideBounds(createDef, { project_id: 9 }, { projectNumber: 5 }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(validateRpcOverrideBounds(createDef, { projectId: '9' }, { projectNumber: 5 }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(validateRpcOverrideBounds(createDef, { project_name: 'beta' }, { projectNumber: 5 }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(validateRpcOverrideBounds(createDef, { filters: { projectName: 'beta' } }, { workspaceId: 'alpha' }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(validateRpcOverrideBounds(createDef, { project_id: 5, project_name: 'alpha' }, { workspaceId: 'alpha' }, REGISTRY)).toBeUndefined()

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const ctx: ToolContext = {
                db,
                config: { projectRegistry: REGISTRY, defaultWorkspaceId: 'alpha', allowedIoRoots: [os.tmpdir()], runtime: new ServerRuntime() },
            }
            const dispatcher = createSecureDispatcher({
                tools: getCoreTools(ctx),
                sessionContext: ctx,
                projectId: undefined,
                workspaceId: 'alpha',
                explicitWorkspace: false,
                autoVersion: false,
                dryRun: false,
            })
            await runWithRpcExecutionOverrides({ workspaceId: 'alpha' }, async () => {
                expect(await dispatcher('create_entry', { content: 'x', projectId: 9 })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
                expect(await dispatcher('create_entry', { content: 'x', project_name: 'beta' })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            })
        } finally {
            db.close()
        }
    })

    it('P13-A-H2 & P13-A-L1: blocks DB-wide backup tools in narrowed nested executeCode and fixes core/maintenance proxy aliases', async () => {
        for (const name of ['restore_backup', 'cleanup_backups', 'backup_journal', 'list_backups', 'team_backup', 'team_list_backups']) {
            const toolDef = { name } as ToolDefinition
            expect(validateRpcOverrideBounds(toolDef, {}, { workspaceId: 'alpha' }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(validateRpcOverrideBounds(toolDef, {}, { projectNumber: 5 }, REGISTRY)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(validateRpcOverrideBounds(toolDef, {}, undefined, REGISTRY)).toBeUndefined()
            expect(validateRpcOverrideBounds(toolDef, {}, { workspaceId: '*' }, REGISTRY)).toBeUndefined()
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p92-bak-'))
        tempDirs.push(tmpDir)
        const db = new DatabaseAdapter(path.join(tmpDir, 'bak.db'), path.join(tmpDir, 'backups'))
        await db.initialize()
        try {
            const ctx: ToolContext = { db, config: { projectRegistry: REGISTRY, defaultWorkspaceId: 'alpha', runtime: new ServerRuntime() } }
            const dispatcher = createSecureDispatcher({
                tools: getBackupTools(ctx),
                sessionContext: ctx,
                projectId: undefined,
                workspaceId: 'alpha',
                explicitWorkspace: false,
                autoVersion: false,
                dryRun: false,
            })
            expect(await dispatcher('list_backups', {})).toMatchObject({ total: expect.any(Number) as number })
            await runWithRpcExecutionOverrides({ workspaceId: 'alpha' }, async () => {
                expect(await dispatcher('list_backups', {})).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            })
        } finally {
            db.close()
        }

        const rpcSpy = vi.fn().mockResolvedValue({ success: true, entry: { id: 1 } })
        const proxy = buildApiProxy(rpcSpy, { core: ['create_entry'], analytics: ['get_statistics'] })
        const coreGroup = proxy['core'] as Record<string, (...a: unknown[]) => Promise<unknown>>
        const analyticsGroup = proxy['analytics'] as Record<string, (...a: unknown[]) => Promise<unknown>>
        await coreGroup['create_entry_minimal']?.({ content: 'minimal test', workspace: 'alpha', projectId: '5' })
        expect(rpcSpy).toHaveBeenCalledWith('core', 'create_entry', [expect.objectContaining({ workspace_id: 'alpha', project_number: 5 })])
        const maintRes = await analyticsGroup['schema']?.()
        expect(maintRes).toMatchObject({ success: false, code: 'VALIDATION_ERROR', error: 'Maintenance call is not available' })
    })

    it('P13-B-M1 & P13-B-M2 & P13-B-M3: preserves unrecognized anchor status/keys, healer conflicts, and rejects blank relationship IDs', () => {
        const anchorPayload: Record<string, unknown> = {
            anchors: [{ anchor_path: 'src/a.ts', anchor_type: 'file', status: 'bogus_status', extra_junk: 1 }],
        }
        healAnchorsField(anchorPayload)
        const healedAnchor = (anchorPayload['anchors'] as Record<string, unknown>[])[0]
        expect(healedAnchor?.['status']).toBe('bogus_status')
        expect(healedAnchor?.['extra_junk']).toBe(1)
        expect(CreateEntrySchema.safeParse({ content: 'x', anchors: anchorPayload['anchors'] }).success).toBe(false)
        expect(TeamCreateEntrySchema.safeParse({ content: 'x', anchors: anchorPayload['anchors'] }).success).toBe(false)
        const overAnchors = Array.from({ length: 101 }, (_, i) => ({ anchor_path: `f${String(i)}.ts`, anchor_type: 'file' }))
        expect(CreateEntrySchema.safeParse({ content: 'x', anchors: overAnchors }).success).toBe(false)
        expect(TeamCreateEntrySchema.safeParse({ content: 'x', anchors: overAnchors }).success).toBe(false)

        const badArch: Record<string, unknown> = { archived: 'yes' }
        healIncludeArchivedField(badArch)
        expect(badArch['archived']).toBe('yes')
        const confArch: Record<string, unknown> = { include_archived: false, archived: true }
        healIncludeArchivedField(confArch)
        expect(confArch['archived']).toBe(true)

        const malformedFilter: Record<string, unknown> = { filter: 'not-an-object' }
        unpackFilterContainers(malformedFilter)
        expect(malformedFilter['filter']).toBe('not-an-object')
        const confFilter: Record<string, unknown> = { project_number: 5, filter: { project_number: 9 } }
        unpackFilterContainers(confFilter)
        expect(confFilter['filter']).toEqual({ project_number: 9 })

        const confSearch = healSearchPayload({ query: 'alpha', q: 'beta' }) as Record<string, unknown>
        expect(confSearch['query']).toBe('alpha')
        expect(confSearch['q']).toBe('beta')

        expect(LinkEntriesSchema.safeParse(LinkEntriesSchemaMcp.parse({ from_entry_id: '', to_entry_id: 2 })).success).toBe(false)
        expect(LinkEntriesSchema.safeParse({ from_entry_id: '', to_entry_id: 2 }).success).toBe(false)
        expect(LinkEntriesSchemaMcp.safeParse({ from_entry_id: 1, from: '', to_entry_id: 2 }).success).toBe(false)
        expect(VisualizeInputSchema.safeParse(VisualizeInputSchemaMcp.parse({ entry_id: '' })).success).toBe(false)
        expect(VisualizeInputSchema.safeParse({ entry_id: '' }).success).toBe(false)
        expect(VisualizeInputSchemaMcp.safeParse({ entry_id: 1, id: '' }).success).toBe(false)
    })

    it('P13-B-L1 & P13-B-L2 & P13-B-L3: validates git bounds pre-IO, blocks post-realpath symlink escape, and caps schemas', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p92-io-'))
        tempDirs.push(tmpDir)
        const outsideDir = path.join(tmpDir, 'outside')
        const linkDir = path.join(tmpDir, 'link-dir')
        const allowedRoot = path.join(tmpDir, 'allowed')
        fs.mkdirSync(outsideDir, { recursive: true })
        fs.mkdirSync(allowedRoot, { recursive: true })
        fs.writeFileSync(path.join(outsideDir, 'note.md'), '# Secret\nBody', 'utf-8')
        try {
            fs.symlinkSync(outsideDir, linkDir, 'junction')
            await expect(
                readAndConvertExternalMarkdownFiles(linkDir, 10, 'obsidian', undefined, [allowedRoot], undefined)
            ).rejects.toThrow()
        } finally {
            if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true, force: true })
        }

        const gitDb = new DatabaseAdapter(':memory:')
        await gitDb.initialize()
        try {
            const tools = getGitTools({ db: gitDb, config: { projectRegistry: { alpha: { path: path.join(tmpDir, 'missing') } } } })
            const unreleased = tools.find((t) => t.name === 'get_unreleased_commits')
            const patterns = tools.find((t) => t.name === 'analyze_commit_patterns')
            const staleness = tools.find((t) => t.name === 'check_entry_staleness')
            expect(await unreleased?.handler({ repo: 'r'.repeat(256) })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(await patterns?.handler({ cwd: 'c'.repeat(501) })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(await staleness?.handler({ entry_id: 1, session_id: 's'.repeat(256) })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })

            const issueCtx: ToolContext = { db: gitDb }
            expect(await getCreateGitHubIssueTool(issueCtx).handler({ title: 'x'.repeat(501) })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(await getCloseGitHubIssueTool(issueCtx).handler({ issue_number: 1, comment: 'c', extra_unknown: 1 })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            const createMilestone = getGitHubMilestoneTools(issueCtx).find((t) => t.name === 'create_github_milestone')
            expect(await createMilestone?.handler({ title: 'm', extra_unknown: 1 })).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(SearchAuditLogSchema.safeParse({ category: 'c'.repeat(256) }).success).toBe(false)
            expect(LinkEntriesSchema.safeParse({ from_entry_id: 1, to_entry_id: 2, description: 'd'.repeat(2001) }).success).toBe(false)
            expect(VisualizeInputSchema.safeParse({ tags: Array.from({ length: 101 }, (_, i) => `t${String(i)}`) }).success).toBe(false)
            expect(VisualizeInputSchema.safeParse({ tags: ['t'.repeat(101)] }).success).toBe(false)
            expect(ListAuthorAliasesSchema.safeParse({ workspace_id: 'w'.repeat(256) }).success).toBe(false)
        } finally {
            gitDb.close()
        }
    })

    it('P13-C-M1 & P13-C-M2 & P13-C-M3 & P13-C-L1: pools GitHub clients by effective token, guards >500 fuzzy expansion, chmods copy swap, and bumps initEpoch', async () => {
        vi.stubEnv('GITHUB_TOKEN', 'tok-env-123')
        const ghRuntime = new ServerRuntime()
        const ghDefault = getGitHubIntegration('.', ghRuntime)
        const ghSame = getGitHubIntegration('.', ghRuntime, 'tok-env-123')
        const ghDifferent = getGitHubIntegration('.', ghRuntime, 'tok-explicit-456')
        expect(ghDefault).toBe(ghSame)
        expect(ghDifferent).not.toBe(ghDefault)

        expect(TeamSearchSchema.safeParse({ query: 'q'.repeat(501) }).success).toBe(false)
        const searchDb = new DatabaseAdapter(':memory:')
        await searchDb.initialize()
        try {
            const longTerms = Array.from({ length: 45 }, (_, i) => `kwzz${String(i).padStart(2, '0')}abcde`)
            searchDb.createEntry({ content: longTerms.join(' ') })
            const typoQuery = Array.from({ length: 45 }, (_, i) => `kwzz${String(i).padStart(2, '0')}abcd`).join(' ')
            expect(typoQuery.length).toBeLessThanOrEqual(500)
            const fuzzyRes = searchDb.searchEntries(typoQuery, { fuzzyMatch: true, autoCorrect: true })
            expect(fuzzyRes.correctedQuery).toBeUndefined()
        } finally {
            searchDb.close()
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p92-swap-'))
        tempDirs.push(tmpDir)
        const livePath = path.join(tmpDir, 'live.db')
        const snapPath = path.join(tmpDir, 'snap.db')
        const tempPath = path.join(tmpDir, 'temp.db')
        fs.writeFileSync(livePath, 'live')
        fs.writeFileSync(tempPath, 'temp')
        const chmodSpy = vi.spyOn(fs.promises, 'chmod').mockResolvedValue(undefined)
        const conn = makeFakeSwapConn(livePath)
        await preparePreRestoreSnapshot(conn, tempPath, snapPath)
        expect(chmodSpy).toHaveBeenCalledWith(snapPath, 0o600)
        vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
        await applySwappedDatabase(conn, tempPath)
        expect(chmodSpy).toHaveBeenCalledWith(livePath, 0o600)

        let releaseMkdir: (() => void) | undefined
        let notifyStarted: (() => void) | undefined
        const mkdirStarted = new Promise<void>((resolve) => {
            notifyStarted = resolve
        })
        const origMkdir = fs.promises.mkdir.bind(fs.promises)
        vi.spyOn(fs.promises, 'mkdir').mockImplementationOnce(async (p, opts) => {
            await origMkdir(p, opts)
            notifyStarted?.()
            await new Promise<void>((resolve) => {
                releaseMkdir = resolve
            })
        })
        const initConn = new NativeConnectionManager(path.join(tmpDir, 'nested', 'init', 'db.sqlite'))
        const initPromise = initConn.initialize()
        await mkdirStarted
        initConn.closeDbBeforeRestore()
        releaseMkdir?.()
        await expect(initPromise).rejects.toThrow('Database closed during initialization.')
    })

    it('P13-C-L2 & P13-C-L3 & P13-D-L1 & P13-D-L2: rejects zero/negative/leading-zero optimizer projects, sanitizes briefing tokens, and strips UTF-8 BOM', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const cfg = { projectRegistry: { alpha: { path: os.tmpdir(), project_number: 5 }, alpha_dup: { path: os.tmpdir(), project_number: 5 } } }
            for (const badProj of ['0', '#0', '-5', '01']) {
                await expect(getPrompt('optimize-journal', { project: badProj }, db, undefined, undefined, cfg)).rejects.toThrow(ValidationError)
            }
            const ambigRes = await getPrompt('load-briefing', { projects: '5, bad\n##INJECT\r\n`rm -rf`\x00' }, db, undefined, undefined, cfg)
            const msgText = String(ambigRes.messages[0]?.content.text ?? '')
            expect(msgText).toContain('Ambiguous:')
            expect(msgText).not.toContain('\n##INJECT')
            expect(msgText).not.toContain('\r')
            expect(msgText).not.toContain('`')
            expect(msgText).not.toContain('\x00')
        } finally {
            db.close()
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p92-bom-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'cfg.json')
        const regFile = path.join(tmpDir, 'reg.json')
        const cliFile = path.join(tmpDir, 'meta.json')
        fs.writeFileSync(cfgFile, '\uFEFF{"maxToolInputElements": 12}', 'utf-8')
        fs.writeFileSync(regFile, '\uFEFF{"alpha": {"path": "/tmp"}}', 'utf-8')
        fs.writeFileSync(cliFile, '\uFEFF{"tags": ["bom"]}', 'utf-8')
        expect(JSON.parse(readSafeRegularConfigTextSync(cfgFile)?.content ?? '')).toEqual({ maxToolInputElements: 12 })
        expect(parseConfigObjectContent(regFile, fs.readFileSync(regFile, 'utf-8'))).toEqual({ alpha: { path: '/tmp' } })
        expect(readCachedConfigObject(regFile)).toEqual({ alpha: { path: '/tmp' } })
        expect(JSON.parse(readBoundedCliInputFile(cliFile, '--metadata'))).toEqual({ tags: ['bom'] })
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
    })
})
