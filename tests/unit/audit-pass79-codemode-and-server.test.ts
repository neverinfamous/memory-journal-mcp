import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { healIncomingToolCallParams } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { normalizePromptAliasForScope } from '../../src/auth/scope-map.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { validateOAuthTransportConfig } from '../../src/transports/http/security.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { mcpLogger } from '../../src/utils/mcp-logger.js'
import { applyActiveSessionScopeFallback } from '../../src/audit/audit-query-helpers.js'
import { parseYamlFrontmatter } from '../../src/markdown/converters/yaml-parser.js'
import { convertLogseq } from '../../src/markdown/converters/logseq.js'
import { exportEntriesToMarkdown } from '../../src/markdown/exporter.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { handleServerInfo } from '../../src/handlers/tools/core/dummy-healing/mcp-fallbacks.js'
import { collectAllTargetWorkspaces, collectExtraTargetWorkspaces } from '../../src/handlers/tools/team/rbac-scope-target.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import { healAgentHallucinations } from '../../src/handlers/tools/schemas/hallucination-healer.js'
import { createAppendInterceptor } from '../../src/codemode/worker/mj-shim-domains.js'
import { buildMemoryAndFactoryShims } from '../../src/codemode/worker/sandbox-process-shims.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { buildSandboxGlobals } from '../../src/codemode/worker/sandbox-globals.js'
import { mergeNestedArgAndOptions } from '../../src/codemode/worker/nested-exec-payload.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { appendOptionalQuerySearchFields } from '../../src/codemode/shared-context-parsers.js'
import { normalizeParams } from '../../src/codemode/api/param-normalizer.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { projectListAction } from '../../src/cli/commands/project.js'
import * as dumpConfigMod from '../../src/cli/dump-config.js'
import { PermissionError } from '../../src/types/errors.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 79 Audit — Code Mode, Scope, Converters, CLI & Prompts', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedCfg: string | undefined
    let savedBomKey: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEnc = process.env['DB_ENCRYPTION_KEY']
        savedCfg = process.env['MEMORY_JOURNAL_CONFIG']
        savedBomKey = process.env['PASS79_BOM_ENV_TEST']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        delete process.env['PASS79_BOM_ENV_TEST']
    })

    afterEach(() => {
        if (savedEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedCfg !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedCfg
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        if (savedBomKey !== undefined) process.env['PASS79_BOM_ENV_TEST'] = savedBomKey
        else delete process.env['PASS79_BOM_ENV_TEST']
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('H1 & M6: createAppendInterceptor forwards isolation fields, avoids blank shadowing, and global append delegates to mj.append', () => {
        const created: unknown[] = []
        const appendFn = createAppendInterceptor({
            core: {
                createEntry: (args: unknown) => {
                    created.push(args)
                    return { success: true }
                },
            },
        })
        expect(appendFn).toBeDefined()
        appendFn?.(['e2e'], 'test note', {
            use_test_db: true,
            workspace_id: '',
            workspaceId: 'ws-b',
            project_number: '',
            projectNumber: 7,
            repo_name: 'org/repo-b',
            share_with_team: true,
            auto_link: false,
        })
        expect(created[0]).toMatchObject({
            use_test_db: true,
            workspace_id: 'ws-b',
            project_number: 7,
            repo_name: 'org/repo-b',
            share_with_team: true,
            auto_link: false,
            content: 'test note',
            tags: ['e2e'],
        })

        appendFn?.(['t'], 'conflict', { workspace_id: 'ws-a', workspace: 'ws-b' })
        expect(created[1]).toMatchObject({ workspace_id: 'ws-a', workspace: 'ws-b' })

        const shimCreated: unknown[] = []
        const shimMj: Record<string, unknown> = {
            core: { createEntry: (args: unknown) => { shimCreated.push(args); return { success: true } } },
        }
        shimMj['append'] = createAppendInterceptor(shimMj)
        const aliases = buildMemoryAndFactoryShims(shimMj, createSafeFsShim({}), () => undefined)
        const globalAppend = aliases['append'] as (...a: unknown[]) => unknown
        globalAppend(['tag-a'], 'body text', { use_test_db: true, workspace_id: 'ws-c' })
        expect(shimCreated[0]).toMatchObject({
            tags: ['tag-a'],
            content: 'body text',
            use_test_db: true,
            workspace_id: 'ws-c',
        })
    })

    it('H2, M5, M7, M8 & M9: rejects discriminator-key code synthesis, forwards search/context telemetry, blocks SQL aggregates & nested conflicts', () => {
        for (const key of ['operation', 'op', 'tool', 'method', 'function']) {
            const aliased: Record<string, unknown> = { [key]: 'delete entry 42' }
            normalizeExecuteCodeAliases(aliased)
            expect(aliased['code']).toBeUndefined()

            const payload = resolveExecutionPayload(aliased as never, aliased, true, 0)
            expect('executionCode' in payload).toBe(false)
            expect('earlyReturn' in payload && payload.earlyReturn['code']).toBe('VALIDATION_ERROR')
        }
        const directAction = resolveExecutionPayload(
            { action: 'delete entry 42' } as never,
            { action: 'delete entry 42' },
            true,
            0
        )
        expect('earlyReturn' in directAction && directAction.earlyReturn['code']).toBe('VALIDATION_ERROR')
        const aliasedAction: Record<string, unknown> = { action: 'delete entry 42' }
        normalizeExecuteCodeAliases(aliasedAction)
        const resolvedAction = resolveExecutionPayload(aliasedAction as never, aliasedAction, true, 0)
        expect('earlyReturn' in resolvedAction && resolvedAction.earlyReturn['code']).toBe('VALIDATION_ERROR')
        const aliasedTask: Record<string, unknown> = { action: 'delete', task: 'entry 42' }
        normalizeExecuteCodeAliases(aliasedTask)
        const resolvedTask = resolveExecutionPayload(aliasedTask as never, aliasedTask, true, 0)
        expect('earlyReturn' in resolvedTask && resolvedTask.earlyReturn['code']).toBe('VALIDATION_ERROR')

        const searchOut: Record<string, unknown> = { query: 'test' }
        appendOptionalQuerySearchFields(searchOut, {
            cursor: 'c1',
            includeTeam: true,
            includeArchived: false,
            fuzzyMatch: true,
            autoCorrect: false,
            minImportance: 0.4,
            sessionId: 'sess-1',
            excludeTags: ['commit-narrative'],
            entryType: 'technical_note',
            useSemantic: true,
        })
        expect(searchOut).toMatchObject({
            cursor: 'c1',
            include_team: true,
            include_archived: false,
            fuzzy_match: true,
            auto_correct: false,
            min_importance: 0.4,
            session_id: 'sess-1',
            exclude_tags: ['commit-narrative'],
            entry_type: 'technical_note',
            use_semantic: true,
        })

        expect(extractAndRecoverSqlCode('SELECT MAX(impact_score) FROM memory_journal WHERE id = 42')).toBeNull()
        expect(extractAndRecoverSqlCode("SELECT AVG(trust_score) FROM memory_journal WHERE content LIKE '%auth%'")).toBeNull()

        const ctxRecovered = resolveExecutionPayload(
            {
                context: {
                    content: 'ctx body',
                    session_id: 'sess-ctx',
                    impact_score: 0.8,
                    trust_score: 0.9,
                    validation_status: 'passed',
                    auto_context: { commits: ['abc123'] },
                },
            } as never,
            undefined,
            true,
            0
        )
        expect('executionCode' in ctxRecovered).toBe(true)
        if ('executionCode' in ctxRecovered) {
            expect(ctxRecovered.executionCode).toContain('"session_id":"sess-ctx"')
            expect(ctxRecovered.executionCode).toContain('"impact_score":0.8')
            expect(ctxRecovered.executionCode).toContain('"trust_score":0.9')
            expect(ctxRecovered.executionCode).toContain('"validation_status":"passed"')
            expect(ctxRecovered.executionCode).toContain('"auto_context":{"commits":["abc123"]}')
        }

        expect('error' in mergeNestedArgAndOptions({ project: 5 }, { project: 9 })).toBe(true)
        expect('error' in mergeNestedArgAndOptions({ repo: 'repo-a' }, { repo_name: 'repo-b' })).toBe(true)
        expect('error' in mergeNestedArgAndOptions({ target_workspace_id: 'ws-a' }, { targetWorkspaceId: 'ws-b' })).toBe(true)
    })

    it('M1, M2, M3, M4, M10, M11 & M12: blank workspace preservation, prompt camelCase scope, OAuth trim/empty check, BOM converters, regex, raw-array RBAC, and project dump cleanup', async () => {
        const dir = makeTempDir('mj-p79-')
        const projectRegistry = { 'repo-a': { path: dir, project_number: 5 } }
        const callParams = { name: 'create_entry', arguments: { content: 'hi', workspace_id: '', repo: 'repo-a' } as Record<string, unknown> }
        healIncomingToolCallParams(callParams, { name: 'test', version: '1.0.0', transport: 'stdio' }, {
            ...DEFAULT_BRIEFING_CONFIG,
            projectRegistry,
        })
        expect(callParams.arguments['workspace_id']).toBe('')
        expect(callParams.arguments['project_number']).toBeUndefined()

        expect(normalizePromptAliasForScope('projectSetup')).toBe('project-setup')
        expect(normalizePromptAliasForScope('teamSessionSummary')).toBe('team-session-summary')
        expect(normalizePromptAliasForScope('optimizeJournal')).toBe('optimize-journal')

        expect(() =>
            validateOAuthTransportConfig(
                { port: 3000, oauthEnabled: true, oauthIssuer: '   ', oauthAudience: 'api' },
                '127.0.0.1',
                true,
                () => undefined
            )
        ).toThrow(/FATAL:/i)
        expect(() =>
            validateOAuthTransportConfig(
                { port: 3000, oauthEnabled: true, oauthIssuer: 'https://auth.example.com', oauthAudience: '   ' },
                '127.0.0.1',
                true,
                () => undefined
            )
        ).toThrow(/FATAL:/i)
        expect(
            validateOAuthTransportConfig(
                { port: 3000, oauthEnabled: true, oauthIssuer: ' https://auth.example.com ', oauthAudience: ' api ' },
                '127.0.0.1',
                true,
                () => undefined
            )
        ).toEqual({ oauthIssuer: 'https://auth.example.com', oauthAudience: 'api' })

        const yamlNoFm = parseYamlFrontmatter('\uFEFFtags:: alpha\n- task')
        expect(yamlNoFm.body.startsWith('\uFEFF')).toBe(false)
        const logseq = convertLogseq('\uFEFFtags:: alpha, beta\n- task item', 'journal.md')
        expect(logseq.metadata.tags).toEqual(['alpha', 'beta'])
        expect(logseq.body).not.toContain('tags::')

        expect(isSafeUserRegex('(ab)+(ab)+(ab)+(ab)+(ab)+z')).toBe(false)
        expect(isSafeUserRegex('(ab)+(cd)+')).toBe(false)
        expect(isSafeUserRegex('(ab)+z')).toBe(true)

        const rawArray = [{ content: 'a', workspace_id: 'ws-a' }, { content: 'b', workspace_id: 'ws-b' }]
        expect(collectAllTargetWorkspaces(rawArray, { projectRegistry })).toEqual(['default', 'ws-a', 'ws-b'])
        expect(collectExtraTargetWorkspaces(rawArray, 'default', { projectRegistry })).toEqual(['ws-a', 'ws-b'])

        const missingCfg = path.join(dir, 'nonexistent-config.json')
        const regPath = path.join(dir, 'reg.json')
        fs.writeFileSync(regPath, JSON.stringify({ projectRegistry: {} }), 'utf-8')
        process.env['MEMORY_JOURNAL_CONFIG'] = regPath
        const rootCmd = new Command().option('--json', 'JSON')
        const subCmd = rootCmd.command('project').command('list')
        rootCmd.parse(['node', 'mj', '--json', 'project', 'list'], { from: 'node' })
        const dumpSpy = vi.spyOn(dumpConfigMod, 'dumpConfigAndExit').mockImplementation(() => undefined as never)
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        const beforeTmp = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mj-proj-cfg-')))
        projectListAction({ config: missingCfg, dumpConfig: true }, subCmd)
        const afterTmp = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mj-proj-cfg-'))
        expect(afterTmp.filter((n) => !beforeTmp.has(n))).toEqual([])
        expect(dumpSpy).toHaveBeenCalledTimes(1)
        expect(stdoutSpy).toHaveBeenCalledWith('{}\n')
    })

    it('L1-L8 & AP*: encoded path chars, env BOM, mcpLogger message, audit null runtime, exporter pre-chunk pin, SQL spaces/tiebreakers, sandbox timer, configuration/healer/fallback & revision', async () => {
        expect(isValidProjectPath('C:\\\\repo%0aevil')).toBe(false)
        expect(isValidProjectPath('C:\\\\repo%0devil')).toBe(false)
        expect(isValidProjectPath('C:\\\\repo%09evil')).toBe(false)

        const dir = makeTempDir('mj-p79-l-')
        fs.writeFileSync(path.join(dir, '.env'), '\uFEFFPASS79_BOM_ENV_TEST=bom_ok\n', 'utf-8')
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
        new ConfigResolver({ name: () => 'serve', getOptionValueSource: () => undefined }, {})
        cwdSpy.mockRestore()
        expect(process.env['PASS79_BOM_ENV_TEST']).toBe('bom_ok')

        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        mcpLogger.info('p79', 'explicit message', { message: 'overridden' })
        expect(errSpy.mock.calls[0]?.[0]).toContain('explicit message')

        const fallbackScope = applyActiveSessionScopeFallback(
            {},
            { ephemeralSessionProject: { workspaceId: 'ws-ctx', projectNumber: 9 } } as never,
            false,
            null
        )
        expect(fallbackScope).toEqual({})

        const testOutputBase = path.join(path.resolve('.'), '.test-output')
        fs.mkdirSync(testOutputBase, { recursive: true })
        const projectExportRoot = fs.mkdtempSync(path.join(testOutputBase, 'mj-p79-export-'))
        tempDirs.push(projectExportRoot)
        const exportDir = path.join(projectExportRoot, 'export-out')
        const db = new DatabaseAdapter(path.join(dir, 'db.sqlite'))
        await db.initialize()
        try {
            const realNativeOrig = fs.realpathSync.native
            let swapCalls = 0
            vi.spyOn(fs.realpathSync, 'native').mockImplementation(((p: fs.PathLike) => {
                const resolved = realNativeOrig(p)
                if (resolved.endsWith('export-out')) {
                    swapCalls++
                    if (swapCalls >= 2) return path.join(projectExportRoot, 'swapped-out')
                }
                return resolved
            }) as typeof fs.realpathSync.native)
            await expect(
                exportEntriesToMarkdown(
                    [{ id: 1, content: 'hello', entry_type: 'technical_note', timestamp: '2026-11-24T00:00:00Z', tags: [], is_personal: true }],
                    exportDir,
                    db,
                    [projectExportRoot]
                )
            ).rejects.toThrow(/Directory swapped/i)

            const pragmaRows = db.connection.exec('PRAGMA  integrity_check')
            expect(pragmaRows.length).toBeGreaterThan(0)

            const e1 = db.createEntry({ content: 'one', workspaceId: 'repo-a', projectNumber: 5 })
            const e2 = db.createEntry({ content: 'two', workspaceId: 'repo-a', projectNumber: 5 })
            db.createEntry({ content: 'three', workspaceId: 'repo-a', projectNumber: 5 })
            db.linkEntries(e1.id, e2.id, 'references')
            const hubs = db.getRelationshipHubs(5, 'repo-a')
            expect(hubs.map((h) => h.entryId)).toEqual([Math.max(e1.id, e2.id), Math.min(e1.id, e2.id)])

            await expect(
                runWithAuthContext({ scopes: [] } as never, () =>
                    handleServerInfo({}, 'server_info', { db } as never)
                )
            ).rejects.toThrow(PermissionError)
        } finally {
            db.close()
        }

        const cfgParsed = updateConfigurationSchema.safeParse({ tool_filter: 'core', config: { tool_filter: 'readonly' } })
        expect(cfgParsed.success && cfgParsed.data.tool_filter === 'core').toBe(true)
        const arrCfg = updateConfigurationSchema.safeParse({ tool_filter: 'core', config: ['bad'] })
        expect(arrCfg.success).toBe(false)

        const circular: Record<string, unknown> = {}
        circular['self'] = circular
        expect(() => healAgentHallucinations({ content: 'ok', context: circular, artifacts: [circular] })).not.toThrow()

        const teamCalls: unknown[] = []
        const coreGrp: Record<string, unknown> = {
            getEntryById: async () => ({ success: false, code: 'RESOURCE_NOT_FOUND', suggestion: 'Try team_get_entry_by_id' }),
        }
        wireProjectAndTeamAliasesHelper({
            core: coreGrp,
            search: {},
            admin: {},
            relationships: {},
            team: { teamGetEntryById: async (a: unknown) => { teamCalls.push(a); return { success: true } } },
            hasDispatcher: true,
            registryProvider: undefined,
            copyFnSchema: () => undefined,
        })
        await (coreGrp['getEntryById'] as (a: unknown) => Promise<unknown>)({ entry_id: 9, sessionId: 's-cam' })
        expect(teamCalls[0]).toMatchObject({ entry_id: 9, session_id: 's-cam' })

        const globals = buildSandboxGlobals({
            mjApi: {},
            shimMj: {},
            safeFsShim: createSafeFsShim({}),
            frozenContext: Object.freeze({}),
            executeCodeFn: async () => ({}),
            updateMemoryFn: () => undefined,
        })
        const timeoutFn = globals['setTimeout'] as (cb: unknown, ms?: number) => number
        expect(() => timeoutFn('not-a-fn', 0)).toThrow(TypeError)
        expect(normalizeParams('getEntryById', [42, { entry_id: undefined }])).toEqual({ entry_id: 42 })

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass83')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass83')
        const cqDef = getCodeQualityAuditPromptDefinition()
        const cqRes = await cqDef.handler(
            { target: 'src', copilot: 'false' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof cqDef.handler>[1]
        )
        const cqText = (cqRes as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass83')
        expect(cqText).toContain('normalizePromptAliasForScope')
        expect(cqText).toContain('createAppendInterceptor')
        expect(cqText).toContain('parseYamlFrontmatter')
    })
})
