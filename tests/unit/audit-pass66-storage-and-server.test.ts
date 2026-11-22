import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { exportEntriesToMarkdown } from '../../src/markdown/exporter.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getActiveSessionProject, setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { extractAuditScopeFromArgs } from '../../src/audit/audit-query-helpers.js'
import { searchAuditFileBackward } from '../../src/audit/audit-file-helpers.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { enforceAccessBoundary } from '../../src/auth/validation.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { readResource } from '../../src/handlers/resources/index.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { addAuditOptions, addCoreOptions } from '../../src/cli/option-groups.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'
import { initializeDependencies } from '../../src/server/mcp-server/initialization.js'
import { getGitHubIntegration } from '../../src/github/github-integration/index.js'
import { attachCallToolInterceptor } from '../../src/server/mcp-server/tool-registration/call-interceptor.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { getTools } from '../../src/handlers/tools/index.js'
import { getProjectTools } from '../../src/handlers/tools/admin/project-tools.js'
import { RunAutoPruneSchema } from '../../src/handlers/tools/admin/schemas/project-and-ops-schemas.js'
import { getLifecycleTools } from '../../src/handlers/tools/admin/lifecycle-tools.js'
import { getRelationshipTools } from '../../src/handlers/tools/relationships.js'
import { getTeamIoTools } from '../../src/handlers/tools/team/io-tools.js'
import { buildDigestSignalForPrompt } from '../../src/handlers/prompts/analytics.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { readSafeViewFile } from '../../src/handlers/tools/core/dummy-healing/fs-view-helpers.js'
import { searchSingleFileAsync } from '../../src/handlers/tools/core/dummy-healing/directory-search.js'
import type { ToolDefinition, ToolRegistration } from '../../src/types/index.js'

const SAVED_ENV_KEYS = [
    'MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY', 'MEMORY_JOURNAL_CONFIG', 'TEAM_AUTHOR',
    'MEMORY_JOURNAL_AUDIT_LOG', 'AUDIT_LOG_PATH', 'RULES_FILE_PATH', 'SKILLS_DIR_PATH',
    'MCP_AGENT_HEALING', 'AUDIT_REDACT',
] as const

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`Expected tool '${name}' to be registered`)
    return found
}

describe('Pass 66 Audit — Storage, Lock, Server, CLI, RBAC & Prompts', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string, local = false): string {
        const base = local ? path.join(process.cwd(), '.test-output', 'vitest') : os.tmpdir()
        fs.mkdirSync(base, { recursive: true })
        const dir = fs.mkdtempSync(path.join(base, prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const [k, v] of savedEnv.entries()) {
            if (v !== undefined) process.env[k] = v
            else delete process.env[k]
        }
        savedEnv.clear()
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('H1: acquireRestoreLock never deletes a live contender lockDir on EEXIST in writeLockFileGuarded', () => {
        const dir = makeTempDir('mj-p66-lock-')
        const lockDir = path.join(dir, '.restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        const runtime = new ServerRuntime()
        const origMkdirSync = fs.mkdirSync
        const desc = Object.getOwnPropertyDescriptor(fs, 'mkdirSync')
        if (desc?.configurable === true) {
            Object.defineProperty(fs, 'mkdirSync', {
                value: (p: fs.PathLike, opts?: fs.MakeDirectoryOptions) => {
                    const out = origMkdirSync(p, opts)
                    if (String(p) === lockDir && !fs.existsSync(lockFile)) {
                        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce: 'contender' }), { flag: 'wx' })
                    }
                    return out
                },
                configurable: true,
            })
        }
        try {
            if (desc?.configurable === true) {
                expect(() => acquireRestoreLock(lockDir, lockFile, runtime)).toThrow(/holding the database lock/i)
                expect(fs.existsSync(lockDir)).toBe(true)
                expect(fs.existsSync(lockFile)).toBe(true)
                expect((JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as { nonce?: string }).nonce).toBe('contender')
            }
        } finally {
            if (desc?.configurable === true) {
                Object.defineProperty(fs, 'mkdirSync', { value: origMkdirSync, configurable: true })
            }
        }
    })

    it('M2 & O6: setupCoreDatabasesAndAudit closes primaryDb on testDb failure and passes effectiveOptions to GitHub init', async () => {
        const dir = makeTempDir('mj-p66-init-')
        const dbPath = path.join(dir, 'primary.db')
        const blockingFile = path.join(dir, 'not-a-dir')
        fs.writeFileSync(blockingFile, 'occupied', 'utf-8')
        await expect(
            initializeDependencies({ transport: 'stdio', dbPath, testDbPath: path.join(blockingFile, 'test.db'), allowedIoRoots: [dir] })
        ).rejects.toThrow()
        expect(() => fs.rmSync(dbPath, { force: true })).not.toThrow()

        const cfgPath = path.join(dir, 'config.json')
        const repoDir = path.join(dir, 'cfg-repo')
        fs.mkdirSync(repoDir, { recursive: true })
        fs.writeFileSync(
            cfgPath,
            JSON.stringify({ defaultWorkspaceId: 'cfg-repo', defaultProjectNumber: 77, projectRegistry: { 'cfg-repo': { path: repoDir, project_number: 77 } } }),
            'utf-8'
        )
        const ctx = await initializeDependencies({ transport: 'stdio', dbPath: ':memory:', configFilePath: cfgPath, allowedIoRoots: [dir] })
        try {
            expect(ctx.github).toBe(getGitHubIntegration(repoDir, ctx.runtime))
        } finally {
            await ctx.runtime.auditLogger?.close().catch(() => undefined)
            ctx.configManager.close()
            ctx.db.close()
        }
    })

    it('M3 & L2: per-file readers survive handle.close() rejections and searchAuditFileBackward slices to bytesRead', async () => {
        const dir = makeTempDir('mj-p66-io-')
        const target = path.join(dir, 'note.txt')
        fs.writeFileSync(target, 'alpha\nbeta\n', 'utf-8')
        const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue({
            stat: async () => ({ isFile: () => true, size: 11 }),
            readFile: async () => 'alpha\nbeta\n',
            read: async () => ({ bytesRead: 0, buffer: Buffer.alloc(0) }),
            close: async () => {
                throw new Error('close EIO')
            },
        } as unknown as fs.promises.FileHandle)
        const viewed = (await readSafeViewFile(target, target, 'view_file', {})) as { success?: boolean }
        expect(viewed.success).toBe(true)
        const grepRes = await searchSingleFileAsync(target, 'alpha', {})
        expect(grepRes.length).toBe(1)
        openSpy.mockRestore()

        const auditFile = path.join(dir, 'audit.jsonl')
        fs.writeFileSync(
            auditFile,
            `${JSON.stringify({ timestamp: '2026-11-21T00:00:00Z', tool: 'search_entries', scope: 'read', success: true, durationMs: 1 })}\n`,
            'utf-8'
        )
        const out: AuditEntry[] = []
        const scan = await searchAuditFileBackward(auditFile, {}, 10, out)
        expect(scan.skippedLines).toBe(0)
        expect(out.map((e) => e.tool)).toEqual(['search_entries'])
    })

    it('M5, M6, M7, M11: lifecycle blank ws fallback, explicit {} registry, case/project defaults sync, and RunAutoPruneSchema strings', async () => {
        const dir = makeTempDir('mj-p66-proj-')
        const cfgFile = path.join(dir, 'mj-config.json')
        const repoDir = path.join(dir, 'MyRepo')
        fs.mkdirSync(repoDir, { recursive: true })
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({
                defaultWorkspaceId: 'MyRepo',
                defaultProjectNumber: 12,
                projectRegistry: {
                    myrepo: { path: repoDir, project_number: 12 },
                    other: { path: dir, project_number: 19 },
                },
            }),
            'utf-8'
        )
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile

        const parsedPrune = RunAutoPruneSchema.parse({
            archive_older_than_days: '30',
            importance_threshold: '0.25',
            project_number: '12',
        })
        expect(parsedPrune.archive_older_than_days).toBe(30)
        expect(parsedPrune.importance_threshold).toBe(0.25)

        const db = new DatabaseAdapter(path.join(dir, 'proj.db'))
        try {
            await db.initialize()
            db.createEntry({ content: 'keep 12', workspaceId: 'myrepo', projectNumber: 12 })
            db.createEntry({ content: 'other 99', workspaceId: 'myrepo', projectNumber: 99 })

            const pruneTool = requireTool(
                getLifecycleTools({ db, config: { defaultWorkspaceId: 'myrepo', defaultProjectNumber: 12 } }),
                'run_auto_prune'
            )
            const pruneRes = (await pruneTool.handler({
                workspace_id: '',
                dry_run: true,
                archive_older_than_days: 0,
            })) as { success: boolean }
            expect(pruneRes.success).toBe(true)

            const emptyList = requireTool(
                getProjectTools({ db, config: { projectRegistry: {} } }),
                'list_projects'
            )
            const listed = (await emptyList.handler({})) as {
                projects: Record<string, unknown>
                items: unknown[]
            }
            expect(listed.projects).toEqual({})
            expect(listed.items).toEqual([])

            const runtime = new ServerRuntime()
            setActiveSessionProject('MyRepo', 12, runtime)
            const ctxConfig = {
                defaultWorkspaceId: 'MyRepo',
                defaultProjectNumber: 12,
                projectRegistry: { myrepo: { path: repoDir, project_number: 12 } },
                runtime,
            }
            const updateProj = requireTool(getProjectTools({ db, config: ctxConfig }), 'update_project')
            await updateProj.handler({ name: 'myrepo', new_name: 'renamedrepo', project_number: 44 })
            expect(ctxConfig.defaultWorkspaceId).toBe('renamedrepo')
            expect(ctxConfig.defaultProjectNumber).toBe(44)
            expect(getActiveSessionProject(runtime)).toEqual({
                workspaceId: 'renamedrepo',
                projectNumber: 44,
            })

            const numOnlyCfg: {
                defaultProjectNumber?: number
                projectRegistry?: Record<string, { path: string; project_number: number }>
            } = {
                defaultProjectNumber: 44,
                projectRegistry: { renamedrepo: { path: repoDir, project_number: 44 } },
            }
            const delProj = requireTool(getProjectTools({ db, config: numOnlyCfg }), 'delete_project')
            await delProj.handler({ name: 'renamedrepo' })
            expect(numOnlyCfg.defaultProjectNumber).toBeUndefined()
        } finally {
            db.close()
        }
    })

    it('M8, M9, M12, L1, L6, L7: pre-heal filter block, audit 0 scope, CLI flags, RBAC admin floor & path-neutral resources', async () => {
        const dir = makeTempDir('mj-p66-srv-')
        const db = new DatabaseAdapter(path.join(dir, 'srv.db'))
        try {
            await db.initialize()
            const runtime = new ServerRuntime()
            const allTools: ToolRegistration[] = getTools(db, null, undefined, undefined, { runtime })
            const allToolNames = new Set(allTools.map((t) => t.name))
            const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>()
            let passedThrough = false
            handlers.set('tools/call', () => {
                passedThrough = true
                return Promise.resolve({ blockedDownstream: true })
            })
            attachCallToolInterceptor(
                handlers,
                {
                    db,
                    runtime,
                    configManager: new ConfigManager({
                        rawToolFilter: 'codemode',
                        codemodeInternalFullAccess: true,
                        briefingConfig: DEFAULT_BRIEFING_CONFIG,
                    }),
                    allowedIoRoots: [],
                },
                { name: 'test', version: '1.0.0', transport: 'stdio' },
                [],
                allTools,
                allToolNames,
                { runtime, filterConfig: parseToolFilter('codemode'), codemodeInternalFullAccess: true }
            )
            const toolCallHandler = handlers.get('tools/call')
            expect(toolCallHandler).toBeDefined()
            if (toolCallHandler !== undefined) {
                await toolCallHandler(
                    { method: 'tools/call', params: { name: 'delete_entry', arguments: { entry_id: -1 } } },
                    {}
                )
            }
            expect(passedThrough).toBe(true)

            setActiveSessionProject('memory-journal-mcp', 5, runtime)
            expect(extractAuditScopeFromArgs({ project_number: 0 }, undefined, runtime)).toEqual({})

            process.env['TEAM_AUTHOR'] = 'alice'
            expect(() =>
                runWithAuthContext(
                    { authenticated: true, scopes: [SCOPES.TEAM], claims: { sub: 'alice', scopes: [SCOPES.TEAM] } },
                    () => enforceAccessBoundary('team_backup', 'tool', { requiresTeamScope: true })
                )
            ).toThrow(/insufficient scope/i)

            delete process.env['AUDIT_LOG_PATH']
            process.env['MCP_AGENT_HEALING'] = 'false'
            process.env['AUDIT_REDACT'] = 'false'
            process.env['MEMORY_JOURNAL_AUDIT_LOG'] = path.join(dir, 'env-audit.jsonl')
            const emptyCfg = path.join(dir, 'empty-cfg.json')
            fs.writeFileSync(emptyCfg, '{}', 'utf-8')
            const cmd = addAuditOptions(addCoreOptions(new Command()))
            cmd.parse(['node', 'srv', '--agent-healing', '--audit-redact'])
            const built = buildServerOptions(new ConfigResolver(cmd, cmd.opts(), emptyCfg), cmd.opts(), cmd, [])
            expect(built.serverOptions.agentHealing).toBe(true)
            expect(built.serverOptions.auditConfig?.redact).toBe(true)
            expect(built.serverOptions.auditConfig?.logPath).toBe(process.env['MEMORY_JOURNAL_AUDIT_LOG'])

            const missingSkills = path.join(dir, 'missing-skills-secret-folder')
            process.env['SKILLS_DIR_PATH'] = missingSkills
            await expect(readResource('memory://skills', db)).rejects.toThrow('Configured SKILLS_DIR_PATH does not exist')
            try {
                await readResource('memory://skills', db)
            } catch (err: unknown) {
                expect(err instanceof Error ? err.message : String(err)).not.toContain(missingSkills)
            }
        } finally {
            db.close()
        }
    })

    it('L4, L5, O1, O2, O9, O10, AP1–AP5: connection abort, anchor round-trip, team graph pruning, digest guard & Pass 66 prompts', async () => {
        const dir = makeTempDir('mj-p66-local-', true)
        const conn = new NativeConnectionManager(path.join(dir, 'conn.db'))
        const initPromise = conn.initialize()
        conn.close()
        await expect(initPromise).rejects.toThrow()

        const miscDbPath = path.join(dir, 'misc.db')
        const db = new DatabaseAdapter(miscDbPath)
        const teamDb = new DatabaseAdapter(path.join(dir, 'team.db'))
        try {
            await db.initialize()
            await teamDb.initialize()
            teamDb.applyTeamSchema()
            const e1 = db.createEntry({ content: 'Anchor export test', workspaceId: 'default' })
            const helperConn = new NativeConnectionManager(miscDbPath)
            await helperConn.initialize()
            try {
                helperConn
                    .getNativeDb()
                    .prepare("INSERT INTO entry_anchors (entry_id, anchor_path, anchor_type, status) VALUES (?, 'src/a.ts#fn', 'symbol', NULL)")
                    .run(e1.id)
            } finally {
                helperConn.close()
            }
            const expDir = path.join(dir, 'exported')
            fs.mkdirSync(expDir, { recursive: true })
            await exportEntriesToMarkdown([e1], expDir, db, [dir])
            const mdFiles = fs.readdirSync(expDir).filter((f) => f.endsWith('.md'))
            expect(mdFiles.length).toBe(1)
            const firstMd = mdFiles[0]
            expect(firstMd).toBeDefined()
            if (firstMd !== undefined) {
                expect(fs.readFileSync(path.join(expDir, firstMd), 'utf-8')).not.toContain('"status":null')
            }

            const t1 = teamDb.createEntry({ content: 'node1', workspaceId: 'default', projectNumber: 5, author: 'alice' })
            const t2 = teamDb.createEntry({ content: 'node2', workspaceId: 'default', projectNumber: 5, author: 'alice' })
            const t3 = teamDb.createEntry({ content: 'node3', workspaceId: 'default', projectNumber: 5, author: 'alice' })
            teamDb.linkEntries(t1.id, t2.id, 'blocked_by')
            teamDb.linkEntries(t1.id, t3.id, 'references')
            process.env['TEAM_AUTHOR'] = 'alice'
            const viz = requireTool(
                getRelationshipTools({ db, teamDb, config: { defaultProjectNumber: 5, runtime: new ServerRuntime() } }),
                'visualize_relationships'
            )
            const vizOut = (await viz.handler({ source: 'team', entry_id: t1.id, relationship_type: 'blocked_by' })) as {
                entry_count: number
                nodes: { id: number }[]
            }
            expect(vizOut.entry_count).toBe(2)
            expect(vizOut.nodes.map((n) => n.id)).not.toContain(t3.id)

            db.saveAnalyticsSnapshot('digest', { staleProjects: 'corrupt-string' }, 'default')
            expect(buildDigestSignalForPrompt(db, 'default')).toBe('')

            const builtPayload = buildEntryPayload({ message: 'test' }, { anchors: ['src\\a.ts#fn'] })
            expect(builtPayload.anchors).toEqual([{ anchor_path: 'src/a.ts#fn', anchor_type: 'symbol' }])

            teamDb.addTeamMember('alice', 'admin')
            teamDb.addTeamMember('viewer-user', 'viewer')
            process.env['TEAM_AUTHOR'] = 'viewer-user'
            const teamImp = requireTool(
                getTeamIoTools({
                    db,
                    teamDb,
                    config: { allowedIoRoots: [dir], projectRegistry: { default: { path: dir, project_number: 5 } } },
                }),
                'team_import_external'
            )
            const authErr = (await teamImp.handler({
                source_dir: path.join(dir, 'nonexistent-dir'),
                source_format: 'notion',
                workspace_id: 'default',
                project_number: 5,
            })) as { success: boolean; error?: string }
            expect(authErr.success).toBe(false)
            expect(authErr.error).toMatch(/Access denied|permission|viewer/i)

            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass74')
            const cqText =
                getCodeQualityAuditPromptDefinition().handler({ target: 'src', copilot: 'false' }, db)
                    .messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-22-audit-pass74')
            expect(cqText).toContain('relaxedNumber()')
            expect(cqText).toContain('detaching `this.worker = null`')
            expect(cqText).toContain('`unwrapNestedExecuteCode`')
            expect(cqText).toContain('`...args`')
            expect(cqText).toContain('args-side `project_number: 0`')
            expect(cqText).toContain('non-recursive `rmdirSync`')
        } finally {
            teamDb.close()
            db.close()
        }
    })
})
