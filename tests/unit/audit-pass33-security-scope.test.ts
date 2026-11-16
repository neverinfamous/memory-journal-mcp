/**
 * Pass 33 Adversarial Security, Scope & Code Mode Boundary Regression Suite (H1-H13).
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DatabaseAdapterProxy } from '../../src/database/core/DatabaseAdapterProxy.js'
import { VectorSearchManagerProxy } from '../../src/vector/vector-search-manager/VectorSearchManagerProxy.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { ConfigurationError } from '../../src/types/errors.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { deepCamelToSnake, normalizeAndAliasToolCall } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { applyGenericInterceptions } from '../../src/codemode/normalizers/generic-interceptions.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getCoreTools as getAdminCoreTools } from '../../src/handlers/tools/admin/core-tools.js'
import { enforceTeamRbac, resolveScopedTeamRole } from '../../src/handlers/tools/team/rbac.js'
import { executeTeamExportMarkdown } from '../../src/handlers/tools/team/io-scope-helpers.js'
import { createGitHubContextTool } from '../../src/handlers/tools/github/context-tool.js'
import { enforceCliTeamReadScope } from '../../src/cli/commands/db-helper.js'
import { setActiveProjectRegistry } from '../../src/codemode/normalizers/generic-field-aliases.js'
import type { ToolContext } from '../../src/types/index.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}
const INGRESS_OPTS = { dbPath: ':memory:', transport: 'stdio' as const, projectRegistry: TEST_REGISTRY, briefingConfig: DEFAULT_BRIEFING_CONFIG }
const asAdmin = <T>(fn: () => T): T => runWithAuthContext({ authenticated: true, claims: { sub: 'alice', scopes: [SCOPES.READ, SCOPES.WRITE, SCOPES.TEAM, SCOPES.ADMIN] } }, fn)

describe('Pass 33 High-Severity Security & Scope Regressions (H1-H13)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string
    let savedEnv: NodeJS.ProcessEnv

    beforeEach(async () => {
        savedEnv = { ...process.env }
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass33-sec-'))
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        setActiveProjectRegistry(undefined)
        vi.restoreAllMocks()
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key)
        }
        Object.assign(process.env, savedEnv)
        try {
            db.close()
        } finally {
            teamDb.close()
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('H1: foreign owner or owner/repo slug does not stamp local workspace or project_number', () => {
        const ownerCall = { name: 'create_github_issue_with_entry', arguments: { owner: 'foreign-org', repo: 'memory-journal-mcp', title: 'Fork bug' } }
        normalizeAndAliasToolCall(ownerCall, INGRESS_OPTS)
        expect((ownerCall.arguments as Record<string, unknown>)['project_number']).toBeUndefined()
        expect((ownerCall.arguments as Record<string, unknown>)['workspace_id']).toBeUndefined()

        const slugCall = { name: 'create_entry', arguments: { repo: 'foreign-org/memory-journal-mcp', content: 'Fork note' } }
        normalizeAndAliasToolCall(slugCall, INGRESS_OPTS)
        expect((slugCall.arguments as Record<string, unknown>)['project_number']).toBeUndefined()
        expect((slugCall.arguments as Record<string, unknown>)['workspace_id']).toBeUndefined()
    })

    it('H2: deepCamelToSnake preserves explicit snake_case, acronyms, and opaque context/arguments bags', () => {
        const res = deepCamelToSnake({ workspace_id: 'memory-journal-mcp', workspaceId: 'other-repo', project_number: 5, projectNumber: 9, HTMLParser: true }) as Record<string, unknown>
        expect(res).toMatchObject({ workspace_id: 'memory-journal-mcp', project_number: 5, html_parser: true })

        const promptCall = { name: 'get_prompt', arguments: { name: 'cms-rem-supervisor', arguments: { autoRestore: 'false', lookbackHours: '48' } } }
        normalizeAndAliasToolCall(promptCall, INGRESS_OPTS)
        expect(promptCall.arguments.arguments).toEqual({ autoRestore: 'false', lookbackHours: '48' })

        const codeCall = { name: 'mj_execute_code', arguments: { code: 'return context.camelKey', context: { camelKey: 'preserved' } } }
        normalizeAndAliasToolCall(codeCall, INGRESS_OPTS)
        expect(codeCall.arguments.context).toEqual({ camelKey: 'preserved' })
    })

    it('H3: unconfigured test proxies fail closed while personal search skips uninitialized teamDb', async () => {
        const proxiedDb = DatabaseAdapterProxy.create(db, undefined)
        const proxiedVec = VectorSearchManagerProxy.create(new VectorSearchManager(db), undefined)

        await requestContextStorage.run({ useTestDb: true }, async () => {
            expect((proxiedDb as unknown as { isInitialized: () => boolean }).isInitialized()).toBe(false)
            expect(proxiedVec.isInitialized()).toBe(false)
            expect(() => proxiedDb.getEntryById(1)).toThrow(ConfigurationError)
            await expect(proxiedVec.search('hello')).rejects.toThrow(ConfigurationError)
        })

        const prod = db.createEntry({ content: 'prod entry', workspaceId: 'memory-journal-mcp', projectNumber: 5 })
        const res = (await asAdmin(() =>
            callTool('delete_entry', { entry_id: prod.id, permanent: true, workspace_id: 'memory-journal-mcp', use_test_db: true }, proxiedDb, proxiedVec, undefined, { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() }, undefined, DatabaseAdapterProxy.create(teamDb, undefined))
        )) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(db.getEntryById(prod.id, 'memory-journal-mcp')).not.toBeNull()

        const isolatedTestDb = new DatabaseAdapter(':memory:')
        await isolatedTestDb.initialize()
        try {
            isolatedTestDb.createEntry({ content: 'test-only entry', workspaceId: 'default' })
            const searchRes = (await asAdmin(() =>
                callTool('search_entries', { query: 'test-only', use_test_db: true }, DatabaseAdapterProxy.create(db, isolatedTestDb), undefined, undefined, { runtime: new ServerRuntime() }, undefined, DatabaseAdapterProxy.create(teamDb, undefined))
            )) as Record<string, unknown>
            expect(searchRes['success']).not.toBe(false)
            expect(Array.isArray(searchRes['entries'])).toBe(true)
        } finally {
            isolatedTestDb.close()
        }
    })

    it('H4: explicit default session preserves project_number across dispatch and recovery', async () => {
        const e77 = db.createEntry({ content: 'proj 77 entry', workspaceId: 'default', projectNumber: 77 })
        const recovered = recoverStructuredJsonCode(JSON.stringify({ payload: { workspace_id: 'default', project_number: 99, content: 'hello' } }))
        expect(recovered).toContain('"workspace_id":"default"')
        expect(recovered).toContain('"project_number":99')

        const nlPayload = resolveExecutionPayload(
            ExecuteCodeSchema.parse({ workspace_id: 'default', project_number: 99, code: 'record a note on default' }),
            { workspace_id: 'default', project_number: 99, code: 'record a note on default' },
            true,
            0
        )
        expect('executionCode' in nlPayload ? nlPayload.executionCode : '').toContain('"project_number":99')

        const tools = getAdminCoreTools({ db, config: { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() } })
        const dispatcher = createSecureDispatcher({
            tools,
            sessionContext: { db, config: { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() } },
            projectId: 99,
            workspaceId: 'default',
            explicitWorkspace: true,
            autoVersion: false,
            dryRun: false,
        })
        const delRes = (await asAdmin(() => dispatcher('delete_entry', { entry_id: e77.id, workspace_id: 'default' }))) as Record<string, unknown>
        expect(delRes['success']).toBe(false)
        expect(db.getEntryById(e77.id, 'default')).not.toBeNull()
    })

    it('H5: nested executeCode rpcOverrides enforce monotonic bounds and propagate synthesized scope', async () => {
        const createdCalls: unknown[] = []
        const mockTools = getAdminCoreTools({ db, config: { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() } })
        const dispatcher = createSecureDispatcher({
            tools: mockTools,
            sessionContext: { db, config: { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() } },
            projectId: undefined,
            workspaceId: '*',
            explicitWorkspace: true,
            autoVersion: true,
            dryRun: false,
        })
        const conflict = (await runWithRpcExecutionOverrides(
            { workspaceId: 'memory-journal-mcp', projectNumber: 5 },
            () => dispatcher('update_entry', { entry_id: 1, workspace_id: 'other-repo', project_number: 9, content: 'escape' })
        )) as Record<string, unknown>
        expect(conflict['success']).toBe(false)
        expect(conflict['code']).toBe('VALIDATION_ERROR')

        const executor = createSandboxExecutor({
            shimMj: {
                core: {
                    createEntry: (p: unknown) => {
                        createdCalls.push(p)
                        return { success: true, payload: p }
                    },
                },
                search: { searchEntries: () => ({ entries: [] }) },
            },
            vmContextRef: {},
            timeoutMs: 1000,
            readonlyMode: false,
            dryRunMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode: async () => ({ ok: true }),
        })
        await executor({ workspace_id: 'other-repo', project_number: 9, session_id: 'nested-sess-9', code: 'record a technical note about other-repo' })
        expect(createdCalls[0]).toMatchObject({ workspace_id: 'other-repo', project_number: 9, session_id: 'nested-sess-9' })
    })

    it('H6: search/q aliases map to query and executionCode/command execute as JS rather than createEntry', () => {
        const qRes = applyGenericInterceptions('mj_execute_code', [{ search: 'oauth token validation', workspace_id: 'memory-journal-mcp', project_number: 5 }])
        expect('args' in qRes).toBe(true)
        const qObj = 'args' in qRes ? (qRes.args[0] as Record<string, unknown>) : {}
        expect(qObj['query']).toBe('oauth token validation')
        expect(qObj['code']).toBeUndefined()

        const resolvedQ = resolveExecutionPayload(ExecuteCodeSchema.parse(qObj), qObj, true, 0)
        expect('executionCode' in resolvedQ ? resolvedQ.executionCode : '').toContain('mj.search.searchEntries')
        expect('executionCode' in resolvedQ ? resolvedQ.executionCode : '').not.toContain('createEntry')

        const execPayload = { executionCode: 'return await mj.core.getRecentEntries({ limit: 5 })', tags: ['audit'], workspace_id: 'memory-journal-mcp', project_number: 5 }
        const resolvedJs = resolveExecutionPayload(ExecuteCodeSchema.parse(execPayload), execPayload, true, 0)
        expect('executionCode' in resolvedJs ? resolvedJs.executionCode.trim() : '').toBe(
            'return await mj.core.getRecentEntries({ limit: 5 })'
        )
    })

    it('H7: single update_entry wildcard move checks source entry project_number before moving', async () => {
        const e9 = db.createEntry({ content: 'in project 9', workspaceId: 'other-repo', projectNumber: 9 })
        const res = (await asAdmin(() =>
            callTool('update_entry', { entry_id: e9.id, workspace_id: '*', project_number: 5, target_workspace_id: 'memory-journal-mcp' }, db, undefined, undefined, { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() })
        )) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(res['code']).toBe('RESOURCE_NOT_FOUND')
        expect(db.getEntryById(e9.id, '*')?.workspaceId).toBe('other-repo')
    })

    it('H8 & H10: explicit viewer role blocks alias escalation, member rejects alias collision, and RBAC normalizes filters', async () => {
        teamDb.addTeamMember('alice', 'admin')
        teamDb.addAuthorAlias('alex', 'alice', 'alice', 'memory-journal-mcp')
        teamDb.addTeamMember('alex', 'viewer')

        expect(resolveScopedTeamRole(teamDb, 'alex', 'member', 'memory-journal-mcp')).toBe('viewer')
        expect(() => enforceTeamRbac({ db, teamDb, config: { teamDefaultRole: 'member', projectRegistry: TEST_REGISTRY } }, 'alex', 'member', 'memory-journal-mcp')).toThrow()

        const addRes = (await asAdmin(() =>
            callTool('team_add_member', { author: 'alex', role: 'viewer' }, db, undefined, undefined, { projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() }, undefined, teamDb)
        )) as Record<string, unknown>
        expect(addRes['success']).toBe(false)

        const filterSearch = (await runWithAuthContext(
            { authenticated: true, claims: { sub: 'alex', scopes: [SCOPES.TEAM] } },
            () => callTool('team_semantic_search', { query: 'roadmap', filters: { project_name: 'other-repo' } }, db, undefined, undefined, { defaultWorkspaceId: 'memory-journal-mcp', teamDefaultRole: 'denied', projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() }, undefined, teamDb)
        )) as Record<string, unknown>
        expect(filterSearch['success']).toBe(false)
    })

    it('H9: team_export_markdown resolves omitted workspace from output_dir and re-checks RBAC', async () => {
        const testOutBase = path.join(process.cwd(), '.test-output')
        fs.mkdirSync(testOutBase, { recursive: true })
        const ioRoot = fs.mkdtempSync(path.join(testOutBase, 'pass33-h9-'))
        const repoADir = path.join(ioRoot, 'repo-a')
        const outDir = path.join(repoADir, 'exports')
        fs.mkdirSync(outDir, { recursive: true })
        try {
            teamDb.createEntry({ content: 'repo-a secret', workspaceId: 'repo-a', projectNumber: 11 })
            teamDb.createEntry({ content: 'repo-b secret', workspaceId: 'repo-b', projectNumber: 22 })
            teamDb.addTeamMember('bootstrap-admin', 'admin')
            teamDb.addAuthorAlias('bobby', 'repo-a-member', 'admin', 'repo-a')
            teamDb.addTeamMember('repo-a-member', 'member')

            const cfg: ToolContext['config'] = {
                defaultWorkspaceId: 'repo-b',
                teamDefaultRole: 'denied',
                allowedIoRoots: [ioRoot],
                projectRegistry: {
                    'repo-a': { path: repoADir, project_number: 11 },
                    'repo-b': { path: path.join(ioRoot, 'repo-b'), project_number: 22 },
                },
            }
            await runWithAuthContext({ authenticated: true, claims: { sub: 'bobby', scopes: [SCOPES.TEAM] } }, async () => {
                const exportRes = (await executeTeamExportMarkdown(
                    { db, teamDb, config: cfg },
                    teamDb,
                    { output_dir: outDir, limit: 100 }
                )) as Record<string, unknown>
                expect(exportRes['success']).toBe(true)
            })
            const files = fs.readdirSync(outDir).map((f) => fs.readFileSync(path.join(outDir, f), 'utf-8'))
            expect(files.some((txt) => txt.includes('repo-a secret'))).toBe(true)
            expect(files.some((txt) => txt.includes('repo-b secret'))).toBe(false)
        } finally {
            fs.rmSync(ioRoot, { recursive: true, force: true })
        }
    })

    it('H11 & H12: get_github_context honors concrete defaultWorkspaceId and CLI rejects non-admin wildcard team reads', async () => {
        const mockGithub = {
            isApiAvailable: () => true,
            getCachedRepoInfo: () => ({ owner: 'org', repo: null, branch: 'main' }),
            getRepoInfo: async () => ({ owner: 'org', repo: null, branch: 'main' }),
            getRepoContext: vi.fn(async () => ({ repoName: 'cwd-leak', branch: 'main', commit: 'abc', remoteUrl: '', issues: [], pullRequests: [] })),
        }
        const tool = createGitHubContextTool({ db, github: mockGithub as unknown as ToolContext['github'], config: { defaultWorkspaceId: 'other-repo', projectRegistry: TEST_REGISTRY } })
        const res = (await tool.handler({})) as Record<string, unknown>
        expect(res['success']).toBe(false)
        expect(res['code']).toBe('VALIDATION_ERROR')
        expect(mockGithub.getRepoContext).not.toHaveBeenCalled()

        teamDb.addTeamMember('admin1', 'admin')
        teamDb.addTeamMember('viewer1', 'viewer')
        process.env['TEAM_AUTHOR'] = 'viewer1'
        expect(() => enforceCliTeamReadScope(teamDb, { teamDefaultRole: 'denied' }, '*', undefined)).toThrow()
        expect(() => enforceCliTeamReadScope(teamDb, { teamDefaultRole: 'denied' }, '*', 5)).not.toThrow()
        process.env['TEAM_AUTHOR'] = 'admin1'
        expect(() => enforceCliTeamReadScope(teamDb, { teamDefaultRole: 'denied' }, '*', undefined)).not.toThrow()
    })

    it('H13: ConfigManager does not persist CLI/env overrides to disk when updating unrelated config', () => {
        const cfgPath = path.join(tmpDir, 'cfg.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ defaultWorkspaceId: 'repo-a', defaultProjectNumber: 1, codemodeInternalFullAccess: false, briefingEntries: 3 }), 'utf-8')
        const cm = new ConfigManager(
            { rawToolFilter: undefined, toolFilterConfig: null, codemodeInternalFullAccess: true, briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'repo-b', defaultProjectNumber: 2, entryCount: 9 } },
            cfgPath,
            { codemodeInternalFullAccess: false, defaultWorkspaceId: 'repo-a', defaultProjectNumber: 1, briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, defaultWorkspaceId: 'repo-a', defaultProjectNumber: 1, entryCount: 3 } }
        )
        try {
            cm.updateConfig({ rawToolFilter: 'starter' }, true, { mutatedFields: { rawToolFilter: true } })
            const disk = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
            expect(disk).toMatchObject({ toolFilter: 'starter', codemodeInternalFullAccess: false, defaultWorkspaceId: 'repo-a', defaultProjectNumber: 1, briefingEntries: 3 })
        } finally {
            cm.close()
        }
        expect(typeof getCodeModeTools).toBe('function')
    })
})
