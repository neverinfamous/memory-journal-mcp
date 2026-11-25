/**
 * Pass 91 Audit — Remediations for Pass 12 Findings across Subsystems A–D.
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import vm from 'node:vm'
import type Database from 'better-sqlite3'
import type { McpServer } from '@modelcontextprotocol/server'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { IDatabaseConnection } from '../../src/database/core/interfaces.js'
import { writeVerifiedBackupFile } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { ValidationError } from '../../src/types/errors.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'
import { DEFAULT_SECURITY_CONFIG } from '../../src/codemode/types.js'
import { createScopedRpcCall } from '../../src/codemode/worker/nested-exec-runner.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { resolveEffectiveRpcScope, validateRpcOverrideBounds } from '../../src/handlers/tools/codemode/dispatch-rpc-bounds.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { resolveOwner, resolveOwnerRepo } from '../../src/handlers/tools/github/helpers.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getIoTools } from '../../src/handlers/tools/io/tools.js'
import { resolveEntryAnchors } from '../../src/handlers/tools/core/entry-anchors.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { CreateEntrySchema, GetRecentEntriesSchema } from '../../src/handlers/tools/core/schemas.js'
import { TeamGetRecentSchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import {
    AddAuthorAliasSchema,
    AddAuthorAliasSchemaMcp,
    ConsolidateAuthorsSchema,
    ConsolidateAuthorsSchemaMcp,
    ListAuthorAliasesSchema,
    ListAuthorAliasesSchemaMcp,
    RemoveAuthorAliasSchema,
    RemoveAuthorAliasSchemaMcp,
    ResolveAuthorSchema,
    ResolveAuthorSchemaMcp,
} from '../../src/handlers/tools/team/alias-schemas.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import {
    GitHistoryOptionsSchemaMcp,
    GitReleaseInfoOptionsSchema,
    GitSearchOptionsSchemaMcp,
} from '../../src/handlers/tools/git-schemas.js'
import { getSanitizedGitEnv, resolveGitWorkingDir } from '../../src/handlers/tools/git-workdir.js'
import { fetchCommits } from '../../src/handlers/tools/git-commit-helpers.js'
import { readLatestGitTag } from '../../src/handlers/tools/git-staleness.js'
import { fetchGitHistoryFromRepoAsync } from '../../src/handlers/resources/core/briefing/system-section-helpers.js'
import { execAction } from '../../src/cli/commands/exec.js'
import { startSelectedTransport } from '../../src/server/mcp-server/server-lifecycle-helpers.js'
import { globalSubscriptionManager } from '../../src/server/subscription-manager.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'

function makeCliCommand(name: string, providedKeys: string[] = []): Command {
    const provided = new Set(providedKeys)
    return {
        name: () => name,
        getOptionValueSource: (k: string) => (provided.has(k) ? 'cli' : 'default'),
    } as unknown as Command
}

function createFastTestGitRepo(parentDir: string, commitCount: number): { repoDir: string; rootSha: string } {
    const repoDir = path.join(parentDir, 'git-repo')
    fs.mkdirSync(repoDir, { recursive: true })
    const env = getSanitizedGitEnv()
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, env, windowsHide: true })
    const chunks: string[] = []
    for (let i = 1; i <= commitCount; i++) {
        const msg = `feat(test): commit ${String(i)}\n`
        chunks.push(
            `commit refs/heads/main\nmark :${String(i)}\n` +
                `author Test <test@example.com> ${String(1700000000 + i)} +0000\n` +
                `committer Test <test@example.com> ${String(1700000000 + i)} +0000\n` +
                `data ${String(Buffer.byteLength(msg))}\n${msg}\n`
        )
        if (i === 1) {
            const fileBody = 'export const anchor = true\n'
            chunks.push(`M 100644 inline kept.ts\ndata ${String(Buffer.byteLength(fileBody))}\n${fileBody}\n`)
        } else {
            chunks.push(`from :${String(i - 1)}\n`)
        }
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: repoDir, env, input: chunks.join(''), windowsHide: true })
    execFileSync('git', ['checkout', '-f', 'main'], { cwd: repoDir, env, windowsHide: true })
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repoDir, env, windowsHide: true })
    const rootSha = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
        cwd: repoDir,
        env,
        encoding: 'utf-8',
        windowsHide: true,
    }).trim()
    return { repoDir, rootSha }
}

describe('Pass 91 Audit — Pass 12 Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('P12-A-H1 & P12-A-M1: checks project/project_number against pinned workspace and requires pinned path for IO tools', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const registry = {
                alpha: { path: os.tmpdir(), project_number: 5 },
                beta: { path: os.tmpdir(), project_number: 9 },
                nopath: { path: '', project_number: 7 },
            }
            const ctx: ToolContext = {
                db,
                vectorManager: undefined,
                github: undefined,
                config: {
                    projectRegistry: registry,
                    defaultWorkspaceId: 'alpha',
                    defaultProjectNumber: undefined,
                    allowedIoRoots: [os.tmpdir()],
                    runtime: new ServerRuntime(),
                },
            }
            const dispatcher = createSecureDispatcher({
                tools: [...getCoreTools(ctx), ...getIoTools(ctx)],
                sessionContext: ctx,
                projectId: undefined,
                workspaceId: 'alpha',
                explicitWorkspace: false,
                autoVersion: false,
                dryRun: false,
            })
            await runWithRpcExecutionOverrides({ workspaceId: 'alpha' }, async () => {
                const badProjAlias = (await dispatcher('create_entry', { content: 'x', project: 9 })) as { success: boolean; code?: string }
                expect(badProjAlias).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
                await expect(dispatcher('create_entry', { content: 'x', project_number: 9 })).rejects.toThrow(ValidationError)
                const nestedFilterErr = (await dispatcher('create_entry', { content: 'x', filters: { project_number: 9 } })) as { success: boolean; code?: string }
                expect(nestedFilterErr).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            })
            const createDef = { name: 'create_entry' } as ToolDefinition
            expect(validateRpcOverrideBounds(createDef, { content: 'x', project: 9 }, { workspaceId: 'alpha' }, registry)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(validateRpcOverrideBounds(createDef, { content: 'x', project_number: 9 }, { workspaceId: 'alpha' }, registry)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })

            const effScope = resolveEffectiveRpcScope(
                { workspaceId: undefined, projectId: undefined, explicitWorkspace: false },
                { workspaceId: 'alpha' },
                registry
            )
            expect('errorResult' in effScope).toBe(false)
            if (!('errorResult' in effScope)) expect(effScope.effectiveExplicitWorkspace).toBe(true)

            const ioNoPathDispatcher = createSecureDispatcher({
                tools: [...getIoTools(ctx)],
                sessionContext: { ...ctx, config: { ...ctx.config, defaultWorkspaceId: 'nopath', projectRegistry: registry } },
                projectId: 7,
                workspaceId: 'nopath',
                explicitWorkspace: true,
                autoVersion: false,
                dryRun: false,
            })
            const ioRes = (await ioNoPathDispatcher('export_entries', { output_file: 'out.json' })) as { success: boolean; code?: string }
            expect(ioRes).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        } finally {
            db.close()
        }
    })

    it('P12-A-H2 & P12-A-L1: preserves live getters across GitHub injection and budgets nested wrapper overhead', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p91-ctx-'))
        tempDirs.push(tmpDir)
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            let authRole = 'reader'
            let progressToken = 'p1'
            const baseCtx: ToolContext = {
                db,
                vectorManager: undefined,
                github: undefined,
                config: {
                    codemodeInternalFullAccess: true,
                    projectRegistry: { alpha: { path: tmpDir, project_number: 5 } },
                    runtime: new ServerRuntime(),
                },
            }
            Object.defineProperties(baseCtx, {
                auth: { enumerable: true, configurable: true, get: () => ({ authenticated: true, role: authRole }) },
                progress: { enumerable: true, configurable: true, get: () => ({ progressToken }) },
            })
            const sessionRes = await resolveCodeModeSessionContext(baseCtx, { code: 'return 1', project_number: 5 })
            expect('errorResponse' in sessionRes).toBe(false)
            if (!('errorResponse' in sessionRes)) {
                expect(sessionRes.sessionContext.github).toBeDefined()
                authRole = 'admin'
                progressToken = 'p2'
                expect((sessionRes.sessionContext.auth as { role?: string } | undefined)?.role).toBe('admin')
                expect((sessionRes.sessionContext.progress as { progressToken?: string } | undefined)?.progressToken).toBe('p2')
            }

            const sendRpc = vi.fn().mockResolvedValue({ success: true })
            const rpcFn = createScopedRpcCall(sendRpc)
            const shimMj = { core: { getRecentEntries: (...args: unknown[]) => rpcFn('core', 'getRecentEntries', args) } }
            const vmContextRef: { current?: vm.Context } = {}
            vmContextRef.current = vm.createContext({ mj: shimMj })
            const exec = createSandboxExecutor({
                shimMj,
                vmContextRef,
                timeoutMs: 1000,
                readonlyMode: false,
                dryRunMode: false,
                useTestDbMode: false,
                runIsolatedNestedCode: vi.fn().mockResolvedValue({ ok: true }),
            })
            const nearMax = `// ${'a'.repeat(DEFAULT_SECURITY_CONFIG.maxCodeLength - 20)}\nreturn 42`
            expect(nearMax.length).toBeLessThanOrEqual(DEFAULT_SECURITY_CONFIG.maxCodeLength)
            expect(await exec({ code: nearMax })).toBe(42)

            const tooLong = `// ${'a'.repeat(DEFAULT_SECURITY_CONFIG.maxCodeLength + 60)}\nreturn 1`
            expect(await exec({ code: tooLong })).toMatchObject({ success: false, code: 'SECURITY_VIOLATION' })
        } finally {
            db.close()
        }
    })

    it('P12-B-H1: resolveOwnerRepo rejects unregistered project_number even when owner is specified', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const fakeGithub = {
                isApiAvailable: vi.fn().mockReturnValue(true),
                getRepoInfo: vi.fn().mockResolvedValue({ owner: 'octocat', repo: 'cwd-repo', branch: 'main' }),
            } as unknown as NonNullable<ToolContext['github']>
            const ctx: ToolContext = {
                db,
                vectorManager: undefined,
                github: fakeGithub,
                config: {
                    projectRegistry: { alpha: { path: os.tmpdir(), project_number: 5 } },
                    defaultWorkspaceId: 'alpha',
                    defaultProjectNumber: 5,
                    runtime: new ServerRuntime(),
                },
            }
            const repoRes = await resolveOwnerRepo(ctx, { owner: 'octocat', project_number: 999 })
            expect('error' in repoRes).toBe(true)
            const ownerRes = await resolveOwner(ctx, 'octocat', undefined, undefined, 999)
            expect('error' in ownerRes).toBe(false)
        } finally {
            db.close()
        }
    })

    it('P12-B-M1 & P12-B-M2 & P12-B-L1: rejects conflicting cursors, empty git limits, conflicting git targets, and filter aliases', () => {
        expect(GetRecentEntriesSchema.parse({ cursor: '10' })).toMatchObject({ offset: 10 })
        expect(GetRecentEntriesSchema.parse({ cursor: '10', offset: '10' })).toMatchObject({ offset: 10 })
        expect(() => GetRecentEntriesSchema.parse({ cursor: '10', offset: 20 })).toThrow()
        expect(() => TeamGetRecentSchema.parse({ cursor: '10', offset: 20 })).toThrow()

        const interceptedMatch = applyDomainToolInterceptions('get_recent_entries', [{ cursor: '12', offset: '12' }])
        expect('args' in interceptedMatch && (interceptedMatch.args[0] as Record<string, unknown>)['cursor']).toBeUndefined()
        const interceptedConflict = applyDomainToolInterceptions('get_recent_entries', [{ cursor: '12', offset: 20 }])
        expect('args' in interceptedConflict && (interceptedConflict.args[0] as Record<string, unknown>)['cursor']).toBe('12')

        expect(() => GitHistoryOptionsSchemaMcp.parse({ maxCount: 10, limit: '' })).toThrow()
        expect(() => GitSearchOptionsSchemaMcp.parse({ query: 'x', maxCount: 10, limit: '' })).toThrow()

        const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p91-a-'))
        const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p91-b-'))
        tempDirs.push(tmpA, tmpB)
        const cfg = { projectRegistry: { alpha: { path: tmpA, project_number: 5 }, beta: { path: tmpB, project_number: 9 } } }
        expect(() => resolveGitWorkingDir({ repo: 'alpha', workspace_id: 'beta' }, cfg)).toThrow(ValidationError)
        expect(() => resolveGitWorkingDir({ workspace_id: 'alpha', project_number: 9 }, cfg)).toThrow(ValidationError)

        expect(updateConfigurationSchema.parse({ tool_filter: '-core', filter: '-core' })).toMatchObject({ tool_filter: '-core' })
        expect(() => updateConfigurationSchema.parse({ tool_filter: '-core', filter: '+core' })).toThrow()
    })

    it('P12-B-M3 & P12-B-M4: preserves conflicting non-scope and author aliases while strict-rejecting MCP schemas', () => {
        const matching = healAgentHallucinations({ content: 'hello', text: 'hello' })
        expect(CreateEntrySchema.parse(matching).content).toBe('hello')
        expect(() => CreateEntrySchema.parse(healAgentHallucinations({ content: 'a', text: 'b' }))).toThrow()
        expect(() => CreateEntrySchema.parse(healAgentHallucinations({ content: 'a', entry_type: 'technical_note', type: 'bugfix' }))).toThrow()
        expect(() => CreateEntrySchema.parse(healAgentHallucinations({ content: 'a', entry_type: 'technical_note', entryType: 'bug_fix' }))).toThrow()

        expect(ConsolidateAuthorsSchema.parse({ query: 'alex', author: 'alex', project_number: 5 })).toMatchObject({ canonical_author: 'alex' })
        const strictAndMcpConflicts: Array<[{ parse: (v: unknown) => unknown }, Record<string, unknown>]> = [
            [AddAuthorAliasSchema, { text: 'a', from: 'b', canonical_author: 'c', project_number: 5 }],
            [AddAuthorAliasSchemaMcp, { canonical_author: 'c', author: 'd', project_number: 5 }],
            [AddAuthorAliasSchemaMcp, { alias: 'a', canonical_author: 'b', extra_unknown: 1 }],
            [RemoveAuthorAliasSchema, { alias: 'a', name: 'b', project_number: 5 }],
            [RemoveAuthorAliasSchemaMcp, { alias: 'a', q: 'b', project_number: 5 }],
            [ListAuthorAliasesSchema, { canonical_author: 'a', q: 'b', project_number: 5 }],
            [ListAuthorAliasesSchemaMcp, { canonical_author: 'a', extra_unknown: true }],
            [ResolveAuthorSchema, { author: 'a', q: 'b', project_number: 5 }],
            [ResolveAuthorSchemaMcp, { author: 'a', name: 'b', project_number: 5 }],
            [ConsolidateAuthorsSchema, { query: 'alex', author: 'bob', project_number: 5 }],
            [ConsolidateAuthorsSchemaMcp, { canonical_author: 'alex', author: 'bob', project_number: 5 }],
        ]
        for (const [schema, payload] of strictAndMcpConflicts) {
            expect(() => schema.parse(payload)).toThrow()
        }
        const interceptedAlias = applyDomainToolInterceptions('team_add_author_alias', [{ text: 'a', from: 'b', canonical_author: 'c', project_number: 5 }])
        expect('args' in interceptedAlias).toBe(true)
        if ('args' in interceptedAlias) expect(() => AddAuthorAliasSchema.parse(interceptedAlias.args[0])).toThrow()
    })

    it('P12-C-M1, P12-C-L1 & P12-C-L2: isolates git env, chmods backups before check, bounds release info & maps bad regex', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p91-git-'))
        tempDirs.push(tmpDir)
        const { repoDir, rootSha } = createFastTestGitRepo(tmpDir, 505)

        const savedGitDir = process.env['GIT_DIR']
        const savedWorkTree = process.env['GIT_WORK_TREE']
        process.env['GIT_DIR'] = path.join(tmpDir, 'poison-git-dir')
        process.env['GIT_WORK_TREE'] = path.join(tmpDir, 'poison-work-tree')
        try {
            const cleanEnv = getSanitizedGitEnv()
            expect(cleanEnv['GIT_DIR']).toBeUndefined()
            expect(cleanEnv['GIT_WORK_TREE']).toBeUndefined()
            expect(await readLatestGitTag(repoDir)).toBe('v1.0.0')
            expect((await fetchGitHistoryFromRepoAsync(repoDir, 3)).commits).toHaveLength(3)
            const db = new DatabaseAdapter(':memory:')
            await db.initialize()
            try {
                const anchors = await resolveEntryAnchors(undefined, JSON.stringify({ commits: [rootSha] }), 'myrepo', {
                    db, vectorManager: undefined, github: undefined,
                    config: { projectRegistry: { myrepo: { path: repoDir, project_number: 5 } }, runtime: new ServerRuntime() },
                })
                expect(anchors).toEqual([{ anchorPath: 'kept.ts', anchorType: 'file' }])
            } finally {
                db.close()
            }
        } finally {
            if (savedGitDir === undefined) Reflect.deleteProperty(process.env, 'GIT_DIR'); else process.env['GIT_DIR'] = savedGitDir
            if (savedWorkTree === undefined) Reflect.deleteProperty(process.env, 'GIT_WORK_TREE'); else process.env['GIT_WORK_TREE'] = savedWorkTree
        }

        const impactCommits = await fetchCommits({ sortBy: 'impact', maxCount: 550, summary: true }, repoDir)
        expect(impactCommits).toHaveLength(505)
        await expect(fetchCommits({ query: '[invalid-regex' }, repoDir)).rejects.toThrow(ValidationError)
        expect(() => GitReleaseInfoOptionsSchema.parse({ ref: 'x'.repeat(256) })).toThrow()
        expect(() => GitReleaseInfoOptionsSchema.parse({ cwd: 'c'.repeat(501) })).toThrow()

        const chmodSpy = vi.spyOn(fs.promises, 'chmod')
        const corruptConn: IDatabaseConnection = {
            initialize: async () => undefined,
            close: () => undefined,
            exec: () => [],
            run: () => undefined,
            pragma: () => undefined,
            getDbPath: () => path.join(tmpDir, 'missing.db'),
            getNativeDb: () => ({
                backup: async (dest: string) => {
                    fs.writeFileSync(dest, 'NOT-A-SQLITE-FILE', 'utf-8')
                    return { totalPages: 1, remainingPages: 0 }
                },
            }) as unknown as Database.Database,
        }
        await expect(writeVerifiedBackupFile(corruptConn, path.join(tmpDir, 'backup.db'))).rejects.toThrow()
        expect(chmodSpy).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 0o600)
    })

    it('P12-D-M1 & P12-D-M2: forwards exec lifecycle/element configs, registers stdio subscriptions, and bumps prompt revision', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-p91-exec-'))
        tempDirs.push(tmpDir)
        const cfgFile = path.join(tmpDir, 'config.json')
        const scriptFile = path.join(tmpDir, 'exec-check.js')
        fs.writeFileSync(cfgFile, JSON.stringify({
            archiveOlderThanDays: 7,
            pruneOlderThanDays: 14,
            hardDeleteOlderThanDays: 30,
            pruneImportanceThreshold: 0.4,
            pruneExcludeTags: ['keep-me'],
            maxToolInputElements: 6,
        }), 'utf-8')
        fs.writeFileSync(scriptFile, [
            'const pruneRes = await mj.admin.runAutoPrune({ dry_run: true, workspace_id: "*" });',
            'const capErr = await mj.core.createEntry({ content: "cap", tags: ["a", "b", "c", "d", "e", "f", "g"] });',
            'return { pruneRes, capErr };',
        ].join('\n'), 'utf-8')

        const stdoutChunks: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => { stdoutChunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); return true })
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const exitCodes: (number | undefined)[] = []
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCodes.push(code); return undefined as never }) as never)
        vi.spyOn(VectorSearchManager.prototype, 'initialize').mockResolvedValue(undefined)
        const lifecycleSpy = vi.spyOn(DatabaseAdapter.prototype, 'executeDataLifecycle')

        await execAction(scriptFile, { db: path.join(tmpDir, 'exec.db'), config: cfgFile, json: true }, makeCliCommand('exec', ['db', 'config', 'json']))
        expect(exitCodes).toEqual([0])
        expect(lifecycleSpy).toHaveBeenCalledWith(expect.objectContaining({
            archiveOlderThanDays: 7, pruneOlderThanDays: 14, hardDeleteOlderThanDays: 30, importanceThreshold: 0.4, excludeTags: ['keep-me'], dryRun: true, workspaceId: '*',
        }))
        const execOut = JSON.parse(stdoutChunks.join('')) as { result?: { pruneRes?: Record<string, unknown>; capErr?: { success?: boolean; code?: string; error?: string } } }
        expect(execOut.result?.pruneRes).toMatchObject({ success: true })
        expect(execOut.result?.capErr).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
        expect(execOut.result?.capErr?.error).toContain('6 elements')

        const fakeServer = { connect: vi.fn().mockResolvedValue(undefined) } as unknown as McpServer
        const regSpy = vi.spyOn(globalSubscriptionManager, 'registerServer')
        const addedListeners: Array<{ ev: 'SIGINT' | 'SIGTERM'; fn: (...args: unknown[]) => void }> = []
        const origProcessOn = process.on.bind(process)
        vi.spyOn(process, 'on').mockImplementation(((ev: string | symbol, fn: (...args: unknown[]) => void) => {
            if (ev === 'SIGINT' || ev === 'SIGTERM') addedListeners.push({ ev, fn })
            return origProcessOn(ev, fn)
        }) as never)
        try {
            await startSelectedTransport({
                options: { transport: 'stdio', dbPath: path.join(tmpDir, 'srv.db') },
                getServerInstance: () => fakeServer,
                runtime: new ServerRuntime(),
                configManager: { close: () => undefined },
                shutdownMetrics: undefined,
                activeMetricsPath: undefined,
                closeDatabases: () => undefined,
            })
            expect(regSpy).toHaveBeenCalledWith('stdio', fakeServer)
        } finally {
            globalSubscriptionManager.unregisterServerIfMatch('stdio', fakeServer)
            for (const { ev, fn } of addedListeners) process.off(ev, fn)
        }

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
    })
})
