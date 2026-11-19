/**
 * Pass 27 Adversarial Code-Quality Audit Regression Suite
 * Covers H1-H8, M1-M12, L3/L5/L7/L8, and P1-P3.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { importMarkdownEntries } from '../../src/markdown/index.js'
import { getTeamIoTools } from '../../src/handlers/tools/team/io-tools.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { callTool, getTools } from '../../src/handlers/tools/index.js'
import { healTemplateBackticksOnRuntimeError } from '../../src/handlers/tools/codemode/code-healer.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { buildSandboxUserContext } from '../../src/handlers/tools/codemode/sandbox-user-context.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-scope.js'
import { handleUpdateConfiguration } from '../../src/handlers/tools/admin/update_configuration.js'
import { getActiveSessionProject, setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { resolveImportWriteScope } from '../../src/cli/commands/io.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { startConfiguredMetricsServer } from '../../src/server/mcp-server/core.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { attachListToolsInterceptor, type RequestHandlerMap } from '../../src/server/mcp-server/tool-registration/list-interceptor.js'
import { resolveKnownFallbackAuditName } from '../../src/server/mcp-server/tool-registration/fallback-interceptors.js'
import { createServerInstance } from '../../src/server/mcp-server/tool-registration/index.js'
import { globalSubscriptionManager } from '../../src/server/subscription-manager.js'
import { buildAllowedHostHeaders } from '../../src/transports/http/server/http-transport.js'
import { getSearchEntriesTool } from '../../src/handlers/tools/search/search-entries.js'
import { instrumentToolDefinitions, wrapToolHandlerWithInterceptors } from '../../src/handlers/tools/arg-interceptions.js'
import { getActiveProjectRegistry } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { createListProjectsFn } from '../../src/codemode/api/project-registry-ops.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { PullRequestsManager } from '../../src/github/github-integration/pull-requests.js'
import { GitHubClient } from '../../src/github/github-integration/client.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import { parseToolFilter, isFilterEffectivelyReadOnly } from '../../src/filtering/tool-filter.js'
import { getAnalyticsTools, omitNonStrictCrossProjectKeys } from '../../src/handlers/tools/analytics.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { buildPriorAuditSection } from '../../src/handlers/prompts/adversarial-helpers.js'
import { IGNORE_DIR_REGEX } from '../../scripts/run-checks.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5 },
    'other-repo': { project_number: 9 },
}

class FixedDimsVectorManager extends VectorSearchManager {
    override generateEmbedding(): Promise<Float32Array> {
        return Promise.resolve(new Float32Array([0.1, 0.2, 0.3, 0.4]))
    }
}

async function getFreeLoopbackPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = http.createServer()
        srv.on('error', reject)
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address()
            srv.close(() => {
                if (addr !== null && typeof addr === 'object') resolve(addr.port)
                else reject(new Error('No ephemeral port'))
            })
        })
    })
}

async function httpGet(port: number, reqPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method: 'GET', headers }, (res) => {
            let body = ''
            res.on('data', (chunk: Buffer) => { body += chunk.toString() })
            res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
        })
        req.on('error', reject)
        req.end()
    })
}

describe('Pass 27 Audit Regressions', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const tempDirs: string[] = []
    let envBackup: NodeJS.ProcessEnv = {}

    function mkTmpDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(async () => {
        envBackup = { ...process.env }
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const k of Object.keys(process.env)) {
            if (!(k in envBackup)) delete process.env[k]
        }
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
        teamDb.close()
        db.close()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    describe('H1: strict team markdown import ownership & RBAC', () => {
        it('resolves aliases, blocks non-owner & NULL-author overwrites, allows admin override, and enforces viewer RBAC', async () => {
            teamDb.addTeamMember('bob', 'admin')
            teamDb.addTeamMember('alice', 'member')
            teamDb.addTeamMember('viewer-user', 'viewer')
            teamDb.addAuthorAlias('alice-alias', 'alice', 'alice', 'ws1')

            const owned = teamDb.createEntry({ content: 'Alice original', workspaceId: 'ws1', projectNumber: 5, author: 'alice' })
            const unowned = teamDb.createEntry({ content: 'Null author original', workspaceId: 'ws1', projectNumber: 5 })
            const dir = mkTmpDir('mj-p27-h1-')
            const f1 = path.join(dir, 'owned.md')
            const f2 = path.join(dir, 'unowned.md')
            fs.writeFileSync(f1, `---\n{"mj_id": ${String(owned.id)}}\n---\nAlice via alias\n`, 'utf-8')
            fs.writeFileSync(f2, `---\n{"mj_id": ${String(unowned.id)}}\n---\nOverwrite unowned\n`, 'utf-8')

            await expect(
                importMarkdownEntries(dir, teamDb, { enforceStrictTeamOwnership: true, author: 'charlie', workspaceId: 'ws1', project_number: 5 }, undefined, [dir])
            ).rejects.toThrow(/owned by 'alice'/)

            await expect(
                importMarkdownEntries(dir, teamDb, { enforceStrictTeamOwnership: true, author: 'alice', workspaceId: 'ws1', project_number: 5 }, undefined, [dir])
            ).rejects.toThrow(/no recorded author/)

            fs.rmSync(f2)
            const aliasRes = await importMarkdownEntries(dir, teamDb, { enforceStrictTeamOwnership: true, author: 'alice-alias', workspaceId: 'ws1', project_number: 5 }, undefined, [dir])
            expect(aliasRes.updated).toBe(1)

            fs.writeFileSync(f2, `---\n{"mj_id": ${String(unowned.id)}}\n---\nAdmin fixed\n`, 'utf-8')
            const adminRes = await importMarkdownEntries(dir, teamDb, { enforceStrictTeamOwnership: true, allowAdminAuthorOverride: true, author: 'bob', workspaceId: 'ws1', project_number: 5 }, undefined, [dir])
            expect(adminRes.updated).toBe(2)

            const tool = getTeamIoTools({ db, teamDb, config: { allowedIoRoots: [dir] } }).find((t) => t.name === 'team_import_markdown')
            expect(tool).toBeDefined()
            const viewerRes = await runWithAuthContext(
                { authenticated: true, claims: { sub: 'viewer-user' }, scopes: [] },
                () => tool?.handler({ source_dir: dir, workspace_id: 'ws1', project_number: 5 })
            )
            expect(viewerRes).toMatchObject({ success: false, code: 'PERMISSION_DENIED' })
        })
    })

    describe('H2-H4: Code Mode recovery guard, alias normalization, and nested scope pinning', () => {
        it('does not re-run a mutating script on post-mutation error and skips SQL recovery on valid JS (H2)', async () => {
            const cfg = { runtime: new ServerRuntime(), codemodeEnabled: true, projectRegistry: TEST_REGISTRY }
            const res = await callTool(
                'mj_execute_code',
                {
                    code: `await mj.core.createEntry({ content: 'H2 single write', workspace_id: 'memory-journal-mcp', project_number: 5 }); throw new Error('SELECT * FROM memory_journal');`,
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    timeout_ms: 15000,
                },
                db, undefined, undefined, cfg
            )
            expect(res).toMatchObject({ success: false })
            const entries = db.getRecentEntries(10, undefined, undefined, undefined, undefined, 'memory-journal-mcp', 5).entries
            expect(entries).toHaveLength(1)
            expect(healTemplateBackticksOnRuntimeError('const x = `hello `world`;')).toBe('const x = `hello \\`world`;')
        }, 20000)

        it('preserves read-only query and metadata keys in normalizeExecuteCodeAliases (H3)', () => {
            const readObj: Record<string, unknown> = { query: 'find architecture' }
            normalizeExecuteCodeAliases(readObj)
            expect(readObj['query']).toBe('find architecture')
            expect(readObj['code']).toBeUndefined()

            const scriptObj: Record<string, unknown> = { script: 'return 7', repo_name: 'memory-journal-mcp', max_result_size_kb: 32 }
            normalizeExecuteCodeAliases(scriptObj)
            expect(scriptObj['code']).toBe('return 7')
            expect(scriptObj['repo']).toBe('memory-journal-mcp')
            expect(scriptObj['max_result_size_kb']).toBe(32)
        })

        it('unconditionally pins sandbox context and blocks nested executeCode cross-scope escalation (H4)', async () => {
            const ctx = buildSandboxUserContext(
                { code: 'return 1', context: { __mj_workspace_id: 'evil', __mj_project_number: 999 } },
                {}, 5, 5, 'memory-journal-mcp', true
            )
            expect(ctx.userContext['__mj_workspace_id']).toBe('memory-journal-mcp')
            expect(ctx.userContext['__mj_project_number']).toBe(5)
            expect(validateNestedExecScope({ workspace_id: 'other-repo' }, 'memory-journal-mcp', 5, TEST_REGISTRY)).not.toBeNull()
            expect(validateNestedExecScope({ project_number: 9 }, 'memory-journal-mcp', 5, TEST_REGISTRY)).not.toBeNull()
            expect(validateNestedExecScope({ workspace_id: 'memory-journal-mcp', project_number: 5 }, 'memory-journal-mcp', 5, TEST_REGISTRY)).toBeNull()

            const cfg = { runtime: new ServerRuntime(), codemodeEnabled: true, projectRegistry: TEST_REGISTRY }
            const nestedDenied = await callTool(
                'mj_execute_code',
                { code: `return await mj.executeCode({ code: 'return 1', workspace_id: 'other-repo' })`, workspace_id: 'memory-journal-mcp', project_number: 5, timeout_ms: 15000 },
                db, undefined, undefined, cfg
            ) as { success: boolean; result?: { success?: boolean; error?: string } }
            expect(nestedDenied.success === false || nestedDenied.result?.success === false).toBe(true)
        }, 20000)
    })

    describe('H5-H8: config session clearing, CLI precedence/scope, and metrics auth boundaries', () => {
        it('clears sticky session projectNumber when update_configuration omits default_project_number (H5)', async () => {
            const runtime = new ServerRuntime()
            runtime.configManager = new ConfigManager({
                rawToolFilter: undefined,
                codemodeInternalFullAccess: false,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'memory-journal-mcp', defaultProjectNumber: 5 },
            })
            setActiveSessionProject('memory-journal-mcp', 5, runtime)
            await handleUpdateConfiguration({ workspace_id: 'other-ws' }, { runtime })
            const session = getActiveSessionProject(runtime)
            expect(session.workspaceId).toBe('other-ws')
            expect(session.projectNumber).toBeUndefined()
        })

        it('honors CLI --db/--team-db over env, validates default scope pair, and pairs import write scope (H6, H7)', () => {
            process.env['DB_PATH'] = '/env/main.db'
            process.env['TEAM_DB_PATH'] = '/env/team.db'
            const dir = mkTmpDir('mj-p27-cli-')
            const cfgFile = path.join(dir, 'mj.json')
            fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: { 'ws-a': { project_number: 5 } } }), 'utf-8')

            const cmd = new Command()
                .option('--db <path>')
                .option('--team-db <path>')
                .option('--default-workspace <id>')
                .option('--default-project <num>', '', (v: string) => Number(v))
                .option('--transport <t>', '', 'stdio')
            cmd.parse(['node', 'mj', '--db', '/cli/main.db', '--team-db', '/cli/team.db', '--default-workspace', 'ws-a', '--default-project', '99'])
            const opts = cmd.opts<Record<string, unknown>>()
            const resolver = new ConfigResolver(cmd, opts, cfgFile)
            expect(resolver.isCliProvided('db')).toBe(true)

            const errors: string[] = []
            const built = buildServerOptions(resolver, opts, cmd, errors)
            expect(built.db).toBe('/cli/main.db')
            expect(built.teamDb).toBe('/cli/team.db')
            expect(errors.length).toBeGreaterThan(0)

            expect(resolveImportWriteScope({ dir }, { defaultWorkspaceId: 'ws-a', defaultProjectNumber: 5 })).toEqual({
                workspaceId: 'ws-a', projectNumber: 5,
            })
            expect(() =>
                resolveImportWriteScope({ dir, defaultProject: 9 }, { defaultWorkspaceId: 'memory-journal-mcp', projectRegistry: TEST_REGISTRY })
            ).toThrow()
        })

        it('blocks unauthenticated non-loopback metrics host and oauth metrics exposure without static token (H8)', async () => {
            const runtime = new ServerRuntime()
            process.env['MJ_METRICS_HOST'] = '0.0.0.0'
            expect(() => startMetricsServer(runtime, 0)).toThrow()
            delete process.env['MJ_METRICS_HOST']

            const port = await getFreeLoopbackPort()
            const stop = startMetricsServer(runtime, port, { authToken: 'h8-tok' })
            try {
                expect((await httpGet(port, '/metrics', { Host: 'evil.example:9465' })).status).toBe(403)
                expect((await httpGet(port, '/metrics')).status).toBe(401)
                expect((await httpGet(port, '/metrics', { Authorization: 'Bearer h8-tok' })).status).toBe(200)
            } finally {
                await stop()
            }

            const oauthPort = await getFreeLoopbackPort()
            const stopSkipped = startConfiguredMetricsServer(runtime, {
                transport: 'http', dbPath: ':memory:', metricsExport: 'prometheus', metricsPort: oauthPort, oauthEnabled: true,
            })
            expect(stopSkipped).toBeUndefined()
            await expect(httpGet(oauthPort, '/metrics')).rejects.toThrow()

            process.env['MCP_AUTH_TOKEN'] = 'env-mcp-tok'
            const stopWithEnv = startConfiguredMetricsServer(runtime, {
                transport: 'http', dbPath: ':memory:', metricsExport: 'prometheus', metricsPort: oauthPort, oauthEnabled: true,
            })
            try {
                expect((await httpGet(oauthPort, '/metrics')).status).toBe(401)
                expect((await httpGet(oauthPort, '/metrics', { Authorization: 'Bearer env-mcp-tok' })).status).toBe(200)
            } finally {
                if (stopWithEnv !== undefined) await stopWithEnv()
            }
        })
    })

    describe('M1-M12, L3/L5/L7/L8, P1-P3 remediations', () => {
        it('supports dynamic tool expansion (M1), fallback audit/scope names (M2), Host header building (M3), and model_name vec reset (M4)', async () => {
            const fullTools = getTools(db, null)
            expect(fullTools.some((t) => t.name === 'export_markdown')).toBe(true)

            const cm = new ConfigManager({
                rawToolFilter: 'core',
                toolFilterConfig: parseToolFilter('core'),
                codemodeInternalFullAccess: false,
                briefingConfig: DEFAULT_BRIEFING_CONFIG,
            })
            const handlers: RequestHandlerMap = new Map([
                ['tools/list', () => Promise.resolve({ tools: fullTools.map((t) => ({ name: t.name })) })],
            ])
            const hints = new Map(fullTools.map((t) => [t.name, t.annotations.readOnlyHint]))
            attachListToolsInterceptor(handlers, cm, new Set(fullTools.map((t) => t.name)), hints)
            const listHandler = handlers.get('tools/list')
            expect(listHandler).toBeDefined()
            const initialList = (await listHandler?.({}, {})) as { tools: { name: string }[] }
            expect(initialList.tools.some((t) => t.name === 'export_markdown')).toBe(false)
            cm.updateConfig({ rawToolFilter: 'full' })
            const expandedList = (await listHandler?.({}, {})) as { tools: { name: string }[] }
            expect(expandedList.tools.some((t) => t.name === 'export_markdown')).toBe(true)

            expect(resolveKnownFallbackAuditName('mjReadResource', undefined)).toBe('mjReadResource')
            expect(resolveKnownFallbackAuditName('projects', undefined)).toBe('projects')
            expect(resolveKnownFallbackAuditName('team_session_summary', { name: 'team-session-summary' })).toBe('team-session-summary')
            expect(getRequiredScope('team-session-summary')).toBe('team')
            expect(buildAllowedHostHeaders('0.0.0.0', 'https://api.example.com:8443/mcp')).toContain('api.example.com:8443')

            const vm1 = new FixedDimsVectorManager(db, { modelName: 'model-a' })
            await vm1.initialize()
            const entry = db.createEntry({ content: 'vec entry', workspaceId: 'ws-vec' })
            await vm1.addEntry(entry)
            expect(db.getVector(entry.id)).not.toBeNull()
            const vm2 = new FixedDimsVectorManager(db, { modelName: 'model-b' })
            await vm2.initialize()
            expect(db.getVectorMetadata('model_name')).toBe('model-b')
            expect(db.getVector(entry.id)).toBeNull()
        })

        it('excludes soft-deleted entries across anchors/history and reaps vectors on lifecycle prune (M5), search facets & team FTS fallback (M6)', async () => {
            const e1 = db.createEntry({
                content: 'Soft delete check',
                workspaceId: 'ws-m5',
                anchors: [{ anchorPath: 'src/a.ts', anchorType: 'file' }],
            })
            db.createVecTable(4)
            db.upsertVector(e1.id, new Float32Array([1, 0, 0, 0]))
            const anchorsBefore = db.getAnchorsByEntryId(e1.id, 'ws-m5')
            expect(anchorsBefore).toHaveLength(1)
            const firstAnchor = anchorsBefore[0]
            expect(firstAnchor).toBeDefined()

            expect(db.deleteEntry(e1.id, false, 'ws-m5').success).toBe(true)
            expect(db.getAnchorsByEntryId(e1.id, 'ws-m5')).toHaveLength(0)
            if (firstAnchor !== undefined) expect(db.updateAnchorStatus(firstAnchor.id, 'stale', 'ws-m5')).toBe(false)
            expect(db.getEntryHistory(e1.id, 'ws-m5')).toHaveLength(0)
            expect(db.getVectorCount()).toBe(0)

            const oldPrune = db.createEntry({
                content: 'Old candidate',
                timestamp: '2020-01-01T00:00:00.000Z',
                significanceType: null,
                impactScore: 0.1,
                workspaceId: 'ws-m5',
            })
            db.upsertVector(oldPrune.id, new Float32Array([1, 0, 0, 0]))
            db.executeDataLifecycle({
                archiveOlderThanDays: 0, pruneOlderThanDays: 1, hardDeleteOlderThanDays: 0,
                importanceThreshold: 0.9, workspaceId: 'ws-m5',
            })
            expect(db.getVector(oldPrune.id)).toBeNull()
            expect(db.getVectorCount()).toBe(0)

            db.createEntry({ content: 'Noisy facet', tags: ['noisy', 'keep'], workspaceId: 'ws-m6' })
            db.createEntry({ content: 'Clean facet', tags: ['keep'], workspaceId: 'ws-m6' })
            const facets = db.getSearchFacets('', { excludeTags: ['noisy'] })
            expect(facets.tags?.some((t) => t.name === 'noisy')).toBe(false)

            teamDb.createEntry({ content: 'UniqueTeamTokenFts', workspaceId: 'ws-m6' })
            const brokenVec = { isInitialized: () => true, search: () => Promise.reject(new Error('vec down')) } as unknown as VectorSearchManager
            const searchTool = getSearchEntriesTool({ db, teamDb, teamVectorManager: brokenVec }).find((t) => t.name === 'search_entries')
            const searchRes = await searchTool?.handler({ query: 'UniqueTeamTokenFts', mode: 'semantic', include_team: true, workspace_id: 'ws-m6' }) as { entries?: { content: string }[] }
            expect(searchRes.entries?.some((e) => e.content.includes('UniqueTeamTokenFts'))).toBe(true)
        })

        it('restores registry on error, strips use_test_db on ZodPipe (M7), preserves {} live registry (M8), blocks bad SQL/Copilot/filter/dir (M9-M12), L3/L5/L7/L8, P1-P3', async () => {
            const pipeDef = {
                name: 'pipe_tool',
                title: 'Pipe',
                description: 'Pipe tool',
                group: 'core' as const,
                inputSchema: z.object({ val: z.string() }).transform((v) => ({ ...v })),
                annotations: { readOnlyHint: true },
                handler: (params: unknown) => Promise.resolve({ hasUseTestDb: typeof params === 'object' && params !== null && 'use_test_db' in params }),
            }
            const [instrumented] = instrumentToolDefinitions([pipeDef], { projectRegistry: TEST_REGISTRY })
            expect(instrumented).toBeDefined()
            const parsedPipe = (instrumented?.inputSchema as z.ZodType).safeParse({ val: 'ok', use_test_db: true })
            expect(parsedPipe.success).toBe(true)

            let seenKeys: unknown = null
            const wrapped = wrapToolHandlerWithInterceptors('pipe_tool', (p) => { seenKeys = p; throw new Error('boom') }, undefined, { projectRegistry: TEST_REGISTRY })
            await expect(wrapped({ val: 'ok', use_test_db: true })).rejects.toThrow('boom')
            expect(seenKeys).toEqual({ val: 'ok' })
            expect(getActiveProjectRegistry()).toBeUndefined()

            expect(await createListProjectsFn(() => ({}))()).toEqual([])
            expect(extractAndRecoverSqlCode("SELECT * FROM tags WHERE name = 'arch'")).toBeNull()

            const ghClient = new GitHubClient('.')
            const mockReviews = { data: [{ id: 1, user: { login: 'copilot-pull-request-reviewer[bot]' }, state: 'COMMENTED', body: 'a', submitted_at: '2026-01-01T00:00:00Z' }, { id: 2, user: { login: 'not-copilot-user' }, state: 'APPROVED', body: 'b', submitted_at: '2026-01-01T00:00:00Z' }] }
            ghClient.octokit = { rest: { pulls: { listReviews: () => Promise.resolve(mockReviews) } } } as unknown as GitHubClient['octokit']
            const reviews = await new PullRequestsManager(ghClient).getReviews('o', 'r', 1)
            expect([reviews[0]?.isCopilot, reviews[1]?.isCopilot]).toEqual([true, false])

            expect([isFilterEffectivelyReadOnly(parseToolFilter('readonly')), isFilterEffectivelyReadOnly(parseToolFilter('-write')), isFilterEffectivelyReadOnly(parseToolFilter('core'))]).toEqual([true, true, false])
            expect(IGNORE_DIR_REGEX.test('node_modules') && IGNORE_DIR_REGEX.test('foo/dist/a.ts') && !IGNORE_DIR_REGEX.test('src/outpost/about.ts')).toBe(true)

            expect(omitNonStrictCrossProjectKeys({ query: 'drop', limit: 5, min_entries: 1 })).toEqual({ min_entries: 1 })
            expect(getAnalyticsTools({ db }).find((t) => t.name === 'get_cross_project_insights')?.handler({ query: 'ignored', limit: 5 })).toMatchObject({ success: true })

            db.createEntry({ content: 'ws1 old', tags: ['old'], workspaceId: 'ws-l7-a' })
            db.createEntry({ content: 'ws2 old', tags: ['old'], workspaceId: 'ws-l7-b' })
            expect(db.mergeTags('old', 'new', 'ws-l7-a')).toEqual({ entriesUpdated: 1, sourceDeleted: false })

            const regSpy = vi.spyOn(globalSubscriptionManager, 'registerServer')
            const subSpy = vi.spyOn(globalSubscriptionManager, 'subscribe')
            createServerInstance({ db, runtime: new ServerRuntime(), vectorManager: new FixedDimsVectorManager(db), github: new GitHubIntegration('.'), configManager: new ConfigManager({ rawToolFilter: undefined, codemodeInternalFullAccess: false, briefingConfig: DEFAULT_BRIEFING_CONFIG }), allowedIoRoots: [] }, { transport: 'http', dbPath: ':memory:', statelessHttp: true }, [], [], [], new Set(), {})
            expect(regSpy).not.toHaveBeenCalled()
            expect(subSpy).not.toHaveBeenCalled()

            const codeModeRes = await callTool('mj_execute_code', { code: 'return { cfg: await mj.getConfig() }', workspace_id: 'memory-journal-mcp', project_number: 5, timeout_ms: 15000 }, db, undefined, undefined, { runtime: new ServerRuntime(), codemodeEnabled: true, projectRegistry: TEST_REGISTRY }) as { success: boolean; result?: { cfg?: unknown } }
            expect([codeModeRes.success, codeModeRes.result?.cfg !== 'memory://internal', typeof codeModeRes.result?.cfg]).toEqual([true, true, 'object'])

            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-19-audit-pass45')
            db.createEntry({ content: 'Prior pass note', tags: ['audit-pass-27'], workspaceId: 'memory-journal-mcp' })
            expect(buildPriorAuditSection(db, 'audit-pass-27', 'Prior', { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'memory-journal-mcp' })).toContain('fallback/session workspace')
        }, 20000)
    })
})
