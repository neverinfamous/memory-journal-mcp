import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import { initConfigAndStartupJobs } from '../../src/server/mcp-server/initialization-config.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { ConfigurationError } from '../../src/types/errors.js'
import {
    readProjectRegistryFile,
    resolveRegistryConfigPath,
} from '../../src/utils/registry-config-file.js'
import { writeTempAndRenameConfig } from '../../src/utils/config-manager-persist.js'
import { loadProjectRegistryFromConfig } from '../../src/utils/workspace-resolver.js'
import { extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import { resolveToolCallAuditScope } from '../../src/audit/audit-file-helpers.js'
import { auditOperation } from '../../src/audit/interceptor.js'
import type { AuditLogger } from '../../src/audit/audit-logger.js'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { createContextNamespaceProxy } from '../../src/codemode/proxy-namespaces.js'
import { createChildProcessShims } from '../../src/codemode/worker/sandbox-process-shims.js'
import { splitSqlValueList } from '../../src/codemode/sql-literal-scope.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { runWithRpcExecutionOverrides } from '../../src/codemode/rpc-context.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'
import { z } from 'zod'

describe('Pass 77 Audit — Code Mode, Server Config, Proxies & Prompts', () => {
    let savedConfigEnv: string | undefined
    let savedProjRegEnv: string | undefined
    let savedNodeEnv: string | undefined
    let savedVitest: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedConfigEnv = process.env['MEMORY_JOURNAL_CONFIG']
        savedProjRegEnv = process.env['PROJECT_REGISTRY']
        savedNodeEnv = process.env['NODE_ENV']
        savedVitest = process.env['VITEST']
    })

    afterEach(() => {
        if (savedConfigEnv !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedConfigEnv
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        if (savedProjRegEnv !== undefined) process.env['PROJECT_REGISTRY'] = savedProjRegEnv
        else delete process.env['PROJECT_REGISTRY']
        if (savedNodeEnv !== undefined) process.env['NODE_ENV'] = savedNodeEnv
        else delete process.env['NODE_ENV']
        if (savedVitest !== undefined) process.env['VITEST'] = savedVitest
        else delete process.env['VITEST']
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('A-H1, D-M1 & D-L4: preserves file-only reload clearing, keeps --dump-config env pure & validates blank path strings', async () => {
        const dir = makeTempDir('mj-p77-cfg-')
        const cfgFile = path.join(dir, 'config.json')
        const regDir = path.join(dir, 'repo-a')
        fs.mkdirSync(regDir, { recursive: true })
        fs.writeFileSync(
            cfgFile,
            JSON.stringify({
                toolFilter: 'starter',
                defaultWorkspaceId: 'repo-a',
                defaultProjectNumber: 5,
                projectRegistry: { 'repo-a': { path: regDir, project_number: 5 } },
            }),
            'utf8'
        )
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile
        delete process.env['PROJECT_REGISTRY']

        const fakeCmd = { name: () => 'serve', getOptionValueSource: () => undefined }
        const configErrors: string[] = []
        const dumpBuilt = buildServerOptions(
            new ConfigResolver(fakeCmd, {}, cfgFile),
            { dumpConfig: true },
            fakeCmd,
            configErrors
        )
        expect(configErrors).toEqual([])
        expect(process.env['PROJECT_REGISTRY']).toBeUndefined()
        expect(dumpBuilt.serverOptions.cliEnvBaseline?.rawToolFilter).toBeUndefined()

        const errBlank: string[] = []
        buildServerOptions(
            new ConfigResolver(
                {
                    name: () => 'serve',
                    getOptionValueSource: (k) => (k === 'rulesFile' || k === 'skillsDir' ? 'cli' : undefined),
                },
                { rulesFile: '   ', skillsDir: 123 },
                cfgFile
            ),
            {},
            fakeCmd,
            errBlank
        )
        expect(errBlank.some((e) => e.includes('Invalid blank rulesFile path'))).toBe(true)
        expect(errBlank.some((e) => e.includes('Invalid skillsDir'))).toBe(true)

        const runtime = new ServerRuntime()
        const mockDb = {
            executeDataLifecycle: () => ({ archivedCount: 0, prunedCount: 0, hardDeletedCount: 0 }),
        } as never
        const { configManager } = await initConfigAndStartupJobs({
            options: dumpBuilt.serverOptions,
            db: mockDb,
            runtime,
        })
        try {
            expect(configManager.getConfig().rawToolFilter).toBe('starter')
            expect(configManager.getConfig().briefingConfig.defaultWorkspaceId).toBe('repo-a')
            fs.writeFileSync(cfgFile, JSON.stringify({}), 'utf8')
            const reload = (configManager as unknown as { reloadFromFile: () => void }).reloadFromFile
            reload.call(configManager)
            expect(configManager.getConfig().rawToolFilter).toBeUndefined()
            expect(configManager.getConfig().briefingConfig.defaultWorkspaceId).toBeUndefined()
        } finally {
            configManager.close()
        }
    })

    it('A-M2..A-M5 & A-L5: invalidates registry cache on write, handles wildcard/blank URI audit flags, rejects blank bools & forbidden keys', async () => {
        const cliCmd = { name: () => 'serve', getOptionValueSource: (k: string) => (k === 'briefingGraph' ? 'cli' : undefined) }
        const resolver = new ConfigResolver(cliCmd, { briefingGraph: '' })
        expect(() => resolver.resolveBool('briefingGraph')).toThrow(ConfigurationError)
        expect(() => new ConfigResolver(cliCmd, { briefingGraph: 1 }).resolveBool('briefingGraph')).toThrow(
            ConfigurationError
        )

        const dir = makeTempDir('mj-p77-reg-')
        const regPath = path.join(dir, 'reg.json')
        fs.writeFileSync(regPath, JSON.stringify({ projectRegistry: { alpha: { path: dir, project_number: 1 } } }), 'utf8')
        expect(Object.keys(readProjectRegistryFile(regPath).registry)).toEqual(['alpha'])
        writeTempAndRenameConfig(
            regPath,
            JSON.stringify({ projectRegistry: { beta: { path: dir, project_number: 2 } } })
        )
        expect(Object.keys(readProjectRegistryFile(regPath).registry)).toEqual(['beta'])

        const protoCfg = path.join(dir, 'proto-reg.json')
        fs.writeFileSync(
            protoCfg,
            '{"projectRegistry":{"__proto__":{"path":"' + dir.replace(/\\/g, '\\\\') + '","project_number":9},"good":{"path":"' + dir.replace(/\\/g, '\\\\') + '","project_number":10}}}',
            'utf8'
        )
        process.env['MEMORY_JOURNAL_CONFIG'] = protoCfg
        process.env['NODE_ENV'] = 'production'
        delete process.env['VITEST']
        expect(resolveRegistryConfigPath()).toBe(path.resolve(protoCfg))
        const loaded = loadProjectRegistryFromConfig()
        expect(loaded?.['good']?.project_number).toBe(10)
        expect(Object.hasOwn(loaded ?? {}, '__proto__')).toBe(false)

        const reqCtx = { ephemeralSessionProject: { workspaceId: 'Repo-A', projectNumber: 5 } } as never
        expect(extractAuditScopeFromUri('memory://briefing/*', reqCtx)).toEqual({})
        expect(extractAuditScopeFromUri('memory://briefing/default?workspace_id=%2A', reqCtx)).toEqual({})
        expect(extractAuditScopeFromUri('memory://briefing/repo-a?project_number=', reqCtx)).toEqual({
            workspaceId: 'repo-a',
            projectNumber: 5,
        })
        expect(
            resolveToolCallAuditScope('read_resource', { uri: 'memory://briefing/*', project_number: 5 }, true, undefined, reqCtx)
        ).toEqual({ projectNumber: 5 })

        const logged: Record<string, unknown>[] = []
        await auditOperation(
            { config: { enabled: true, auditReads: true }, log: (e: Record<string, unknown>) => logged.push(e) } as unknown as AuditLogger,
            'resource',
            'briefing',
            () => 'ok',
            { resourceUri: 'memory://briefing/*', runtime: { activeSessionProject: { workspaceId: 'repo-a', projectNumber: 5 } } as never }
        )
        expect(logged[0]?.['workspaceId']).toBeUndefined()
    })

    it('C-H1, C-H4, C-M4 & C-L5: structured action recovery preserves reads & search filters and balanced quote prepared SQL rejects JS concats', () => {
        const intercepted = applyArgInterceptions('mj_execute_code', [{ action: 'get', entry_id: 42 }])
        expect('args' in intercepted).toBe(true)
        if ('args' in intercepted) {
            const norm = intercepted.args[0] as Record<string, unknown>
            expect(norm['code']).toContain('42')
        }
        const getPayload = resolveExecutionPayload(
            { action: 'get', entry_id: 42 } as never,
            { action: 'get', entry_id: 42 },
            true,
            Date.now()
        )
        expect('executionCode' in getPayload).toBe(true)
        if ('executionCode' in getPayload) {
            expect(getPayload.executionCode).toContain('getEntryById')
            expect(getPayload.executionCode).not.toContain('updateEntry')
        }

        const searchPayload = resolveExecutionPayload(
            { action: 'search', query: 'audit', tags: ['sec'], mode: 'hybrid', limit: 5 } as never,
            { action: 'search', query: 'audit', tags: ['sec'], mode: 'hybrid', limit: 5 },
            true,
            Date.now()
        )
        expect('executionCode' in searchPayload).toBe(true)
        if ('executionCode' in searchPayload) {
            expect(searchPayload.executionCode).toContain('searchEntries')
            expect(searchPayload.executionCode).toContain('"tags":["sec"]')
            expect(searchPayload.executionCode).toContain('"mode":"hybrid"')
            expect(searchPayload.executionCode).toContain('"limit":5')
        }

        expect(
            extractAndRecoverPreparedStatementCode(
                "const s = db.prepare('UPDATE memory_journal SET content = ? WHERE id = ?'); s.run('prefix: ' + dynamicVar + ' suffix', 1);"
            )
        ).toBeNull()
        const escapedSql = extractAndRecoverPreparedStatementCode(
            "const s = db.prepare('UPDATE memory_journal SET content = ? WHERE id = ?\\n'); s.run('ok', 7);"
        )
        expect(escapedSql).toContain('updateEntry')
    })

    it('C-H2, C-H3, C-L1 & C-L2: enforces readonly/RBAC ahead of DB/GitHub I/O, strips workspace alias, forwards use_test_db & options objects', async () => {
        let teamDbReadCount = 0
        let githubCallCount = 0
        const teamUpdateTool = {
            name: 'team_batch_update_entries',
            group: 'team',
            annotations: { readOnlyHint: false },
            inputSchema: z.object({ updates: z.array(z.unknown()), workspace_id: z.string().optional(), issue_url: z.string().optional() }).strict(),
            handler: async () => ({ success: true }),
        } as never
        const dispatcher = createSecureDispatcher({
            tools: [teamUpdateTool],
            projectId: 5,
            workspaceId: '*',
            sessionContext: {
                db: {} as never,
                teamDb: {
                    isTeamRbacActive: () => true,
                    resolveTeamRole: () => 'viewer',
                    getEntryById: () => {
                        teamDbReadCount++
                        return null
                    },
                } as never,
                github: {
                    getRepoInfo: async () => {
                        githubCallCount++
                        return { owner: 'o', repo: 'r', branch: 'b' }
                    },
                } as never,
                config: { runtime: new ServerRuntime() },
            },
        })
        const roRes = (await runWithRpcExecutionOverrides({ readonly: true }, () =>
            dispatcher('team_batch_update_entries', {
                updates: [{ entry_id: 1, target_workspace_id: 'repo-b', content: 'x' }],
            })
        )) as Record<string, unknown>
        expect(roRes['success']).toBe(false)
        expect(teamDbReadCount).toBe(0)
        expect(githubCallCount).toBe(0)

        const rbacRes = (await dispatcher('team_batch_update_entries', {
            updates: [{ entry_id: 1, target_workspace_id: 'repo-b', content: 'x' }],
            issue_url: 'https://github.com/o/r/issues/1',
        })) as Record<string, unknown>
        expect(rbacRes['success']).toBe(false)
        expect(teamDbReadCount).toBe(0)
        expect(githubCallCount).toBe(0)

        const normWorkspace = await normalizeDispatchParams(
            {
                name: 'get_recent_entries',
                group: 'core',
                annotations: { readOnlyHint: true },
                inputSchema: z.object({ workspace_id: z.string().optional() }).strict(),
            } as never,
            { workspace: 'repo-a' },
            { sessionContext: { db: {} as never }, projectId: 5, workspaceId: 'repo-a' }
        )
        expect('params' in normWorkspace).toBe(true)
        if ('params' in normWorkspace) {
            expect((normWorkspace.params as Record<string, unknown>)['workspace']).toBeUndefined()
            expect((normWorkspace.params as Record<string, unknown>)['workspace_id']).toBe('repo-a')
        }

        const teamCalls: unknown[] = []
        const regCalls: unknown[] = []
        const core: Record<string, unknown> = {
            getEntryById: async () => ({
                success: false,
                code: 'RESOURCE_NOT_FOUND',
                suggestion: 'Use team_get_entry_by_id',
            }),
        }
        const admin: Record<string, unknown> = {
            registerProject: async (p: unknown) => {
                regCalls.push(p)
                return { success: true }
            },
        }
        const team: Record<string, unknown> = {
            teamGetEntryById: async (p: unknown) => {
                teamCalls.push(p)
                return { success: true, entry: { id: 10 } }
            },
        }
        wireProjectAndTeamAliasesHelper({
            core,
            search: {},
            admin,
            relationships: {},
            team,
            hasDispatcher: true,
            registryProvider: undefined,
            copyFnSchema: () => undefined,
        })
        const autoRouted = (await (core['getEntryById'] as (a: unknown) => Promise<unknown>)({
            entry_id: 10,
            use_test_db: true,
        })) as Record<string, unknown>
        expect(autoRouted['_healed']).toEqual({ routedTo: 'team' })
        expect((teamCalls[0] as Record<string, unknown>)['use_test_db']).toBe(true)
        await (admin['registerProject'] as (...a: unknown[]) => Promise<unknown>)('my-repo', {
            absolute_path: os.tmpdir(),
            project_number: 9,
        })
        expect(regCalls[0]).toEqual({ name: 'my-repo', absolute_path: os.tmpdir(), project_number: 9 })
    })

    it('C-M1..C-M3, C-L3, C-L4 & AP*: wraps nested auto_version updates, freezes nested/aliased arrays & mj.context, handles 3-arg exec & backticks', async () => {
        let compiledExecCode = ''
        const sandboxExec = createSandboxExecutor({
            shimMj: {} as never,
            vmContextRef: { current: undefined },
            timeoutMs: 1000,
            maxResultSize: 10000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: undefined,
            pinnedProjectRaw: undefined,
            projectRegistryRaw: undefined,
            runIsolatedNestedCode: (code) => {
                compiledExecCode = code
                return Promise.resolve({ success: true })
            },
            activeTimers: new Set(),
        })
        await sandboxExec({ entry_id: 5, content: 'updated', auto_version: false })
        expect(() => new vm.Script(compiledExecCode)).not.toThrow()

        const proxied = wrapResult({
            success: true,
            entries: [{ id: 1 }, { id: 2 }],
            nested: [10, 20],
            deleted: [3],
            edges: [{ from: 1, to: 2, type: 'references' }],
        }) as Record<string, unknown>
        expect(() => (proxied['entries'] as unknown[]).push(1)).toThrow(/Array mutator/)
        expect(() => (proxied['nested'] as unknown[]).push(1)).toThrow(/Array mutator/)
        expect(() => (proxied['items'] as unknown[]).push(1)).toThrow(/Array mutator/)
        expect(() => (proxied['entryIds'] as unknown[]).push(1)).toThrow(/Array mutator/)
        expect(() => (proxied['deletedIds'] as unknown[]).push(1)).toThrow(/Array mutator/)
        expect(() => (proxied['relationships'] as unknown[]).push(1)).toThrow(/Array mutator/)

        const { contextProxy } = createContextNamespaceProxy({ nested: { list: [1, 2] } }) as {
            contextProxy: Record<string, unknown>
        }
        expect(() => {
            ((contextProxy['nested'] as Record<string, unknown>)['list'] as number[]).push(3)
        }).toThrow()

        let execErr: unknown
        const cp = createChildProcessShims() as { exec: (c: string, o: unknown, cb: (e: unknown) => void) => void }
        cp.exec('echo hi', { encoding: 'utf8' }, (e) => {
            execErr = e
        })
        expect(execErr).toBeInstanceOf(Error)
        expect(splitSqlValueList('`col,1`, 2, "a,b"')).toEqual(['`col,1`', '2', '"a,b"'])

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass87')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass87')
        const def = getCodeQualityAuditPromptDefinition()
        const rendered = await def.handler(
            { target: 'memory-journal-mcp' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof def.handler>[1]
        )
        const text = (rendered as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(text).toContain('cliEnvBaseline')
        expect(text).toContain('scanBalancedQuotedString')
        expect(text).toContain('runImmediateWriteTx')
        expect(text).toContain('invalidateRegistryFileCache')
    })
})
