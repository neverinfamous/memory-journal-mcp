import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { getTeamCollaborationMetrics } from '../../src/database/sqlite-adapter/insights/team-collaboration.js'
import { getSearchFacets } from '../../src/database/sqlite-adapter/entries/search/facets.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import {
    captureActiveProjectRegistryState,
    normalizeProjectAliases,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/project-alias-helpers.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { readExecutableCode, readNestedQuerySearch } from '../../src/codemode/worker/nested-exec-payload.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { readEntryIdField, readProjectNumber, readWorkspaceId } from '../../src/handlers/tools/codemode/json-entry-scope.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { readWorkspaceField } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { createAppendInterceptor } from '../../src/codemode/worker/mj-shim-domains.js'
import { hasUnsupportedSqlTrailingClause } from '../../src/codemode/sql-clause-validator.js'
import { resolveDatabasePaths } from '../../src/cli/server-options-groups.js'
import { resolveProjectConfigPath, withIsolatedProjectConfigEnv } from '../../src/cli/commands/project-config-helper.js'
import { projectCreateAction } from '../../src/cli/commands/project.js'
import { createProgram } from '../../src/cli/program.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getMiscTools } from '../../src/handlers/tools/admin/misc-tools.js'
import { significantResource } from '../../src/handlers/resources/core/utilities.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 81 Audit — ReDoS Nullable Chains, Code Mode Dispatch, Filter Rewrite & CLI', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedCfg: string | undefined
    let savedRegistry: string | undefined
    let savedArgv: string[]
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
        savedRegistry = process.env['PROJECT_REGISTRY']
        savedArgv = [...process.argv]
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        process.argv = savedArgv
        process.exitCode = undefined
        if (savedEnc === undefined) Reflect.deleteProperty(process.env, 'MJ_DB_ENCRYPTION_KEY')
        else process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        if (savedDbEnc === undefined) Reflect.deleteProperty(process.env, 'DB_ENCRYPTION_KEY')
        else process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        if (savedCfg === undefined) Reflect.deleteProperty(process.env, 'MEMORY_JOURNAL_CONFIG')
        else process.env['MEMORY_JOURNAL_CONFIG'] = savedCfg
        if (savedRegistry === undefined) Reflect.deleteProperty(process.env, 'PROJECT_REGISTRY')
        else process.env['PROJECT_REGISTRY'] = savedRegistry
        Reflect.deleteProperty(process.env, 'MJ_PASS82_QUOTE_TEST')
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('H1 & L1: tracks nullable repeating atom/group chains while allowing [+) ]+ classes', () => {
        expect(isSafeUserRegex('\\s+\\w*\\w*\\w*\\w*!')).toBe(false)
        expect(isSafeUserRegex('a+b*b*b*b*!')).toBe(false)
        expect(isSafeUserRegex('a+(?:b)*b*b*b*!')).toBe(false)
        expect(isSafeUserRegex('a+(?:b*)b*b*!')).toBe(false)
        expect(isSafeUserRegex('a+(?:b*|c*)b*!')).toBe(false)
        expect(isSafeUserRegex('[+)]+')).toBe(true)
        expect(isSafeUserRegex('\\s+\\w*!\\w+')).toBe(true)
    })

    it('H2: blocks query fast-path bypass when structured discriminators are present', () => {
        const aliasObj: Record<string, unknown> = {
            query: 'auth',
            operation: 'delete',
            entry_id: 42,
        }
        normalizeExecuteCodeAliases(aliasObj)
        expect(aliasObj['code']).toBeUndefined()

        const delPayload = resolveExecutionPayload(
            { query: 'auth', operation: 'delete', entry_id: 42 } as never,
            { query: 'auth', operation: 'delete', entry_id: 42 },
            true,
            0
        )
        expect('executionCode' in delPayload).toBe(true)
        if ('executionCode' in delPayload) {
            expect(delPayload.executionCode).toContain('mj.admin.deleteEntry')
            expect(delPayload.executionCode).not.toContain('searchEntries')
        }

        const badToolPayload = resolveExecutionPayload(
            { query: 'auth', tool: 'bad;tool()' } as never,
            { query: 'auth', tool: 'bad;tool()' },
            true,
            0
        )
        expect('earlyReturn' in badToolPayload).toBe(true)
        if ('earlyReturn' in badToolPayload) {
            expect(badToolPayload.earlyReturn['code']).toBe('VALIDATION_ERROR')
        }

        expect(readNestedQuerySearch({ query: 'auth', operation: 'delete', entry_id: 42 })).toBeUndefined()
        expect(readExecutableCode({ query: 'auth', operation: 'delete', entry_id: 42 })).toBe('')
        const normalNested = readNestedQuerySearch({ query: 'auth', workspace_id: '  ', workspaceId: 'repo-a' })
        expect(normalNested).toMatchObject({ query: 'auth', workspace_id: 'repo-a' })
    })

    it('H3 & M2: prevents blank/outer entry_id duplicate creates and recovers wrapped named tool calls', () => {
        const shadowId = readEntryIdField({ entry_id: '', entryId: 42 })
        expect(shadowId.entryId).toBe(42)

        const shadowedJson = recoverStructuredJsonCode(
            JSON.stringify({ entry_id: '', entryId: 42, content: 'patched' })
        )
        expect(shadowedJson).toContain('mj.admin.updateEntry')
        expect(shadowedJson).toContain('"entry_id":42')

        const wrappedUpdate = recoverStructuredJsonCode(
            JSON.stringify({ entry_id: 42, entry: { content: 'patched' } })
        )
        expect(wrappedUpdate).toContain('mj.admin.updateEntry')
        expect(wrappedUpdate).toContain('"entry_id":42')

        const wrappedNamed = recoverStructuredJsonCode(
            JSON.stringify({
                tool: 'mj.core.createEntry',
                workspace_id: 'repo-a',
                payload: { content: 'wrapped note', tags: ['v1'] },
            })
        )
        expect(wrappedNamed).toContain('mj.core.createEntry')
        expect(wrappedNamed).toContain('"content":"wrapped note"')
        expect(wrappedNamed).toContain('"workspace_id":"repo-a"')
    })

    it('H4: forwards second options bag in 2-arg mj.append(entry, options)', () => {
        const calls: unknown[] = []
        const appendFn = createAppendInterceptor({
            core: { createEntry: (args: unknown) => { calls.push(args); return args } },
        })
        expect(appendFn).toBeDefined()
        appendFn?.({ content: 'note' }, { workspace_id: 'ws-b', project_number: 5, use_test_db: true })
        expect(calls).toEqual([
            { content: 'note', workspace_id: 'ws-b', project_number: 5, use_test_db: true },
        ])
    })

    it('M1, M3 & M4: enforces tool filter on URI rewrites, routes broken saveMemory updates & prevents blank alias shadowing', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const filterConfig = parseToolFilter('full,-get_entry_by_id')
            const runtime = new ServerRuntime()
            const res = (await callTool(
                'get_entry_by_id',
                { uri: 'memory://recent' },
                db,
                undefined,
                undefined,
                { filterConfig, agentHealing: true, runtime }
            )) as { success?: boolean; code?: string; error?: string }
            expect(res.success).toBe(false)
            expect(res.code).toBe('TOOL_DISABLED')
        } finally {
            db.close()
        }

        const recoveredSave = extractAndRecoverEntryCode(
            'await mj.saveMemory({ entry_id: 42, content: "broken", )'
        )
        expect(recoveredSave).toContain('mj.updateEntry')
        expect(recoveredSave).toContain('"entry_id":42')

        expect(readProjectNumber({ project_number: '', projectNumber: 9 })).toBe(9)
        expect(readWorkspaceId({ workspace_id: ' ', workspaceId: 'repo-b' })).toBe('repo-b')
        const prevRegState = captureActiveProjectRegistryState()
        setActiveProjectRegistry({
            'repo-a': { path: process.cwd(), project_number: 5 },
            'repo-b': { path: process.cwd(), project_number: 9 },
        })
        try {
            expect(readWorkspaceField({ repo: '', repo_name: 'repo-b' }, {})).toBe('repo-b')
            expect(readWorkspaceField({ repo_name: 'repo-a' }, { repo: 'repo-b' })).toBe('repo-a')
        } finally {
            restoreActiveProjectRegistryState(prevRegState)
        }

        const projAlias: Record<string, unknown> = { project_number: '', projectNumber: 12 }
        normalizeProjectAliases(projAlias)
        expect(projAlias['project_number']).toBe(12)
        expect(projAlias['projectNumber']).toBeUndefined()
    })

    it('H5 & M5: rejects blank CLI --db/--team-db/--config and empty NativeConnectionManager path', () => {
        const dir = makeTempDir('mj-p82-cli-')
        const resolver = new ConfigResolver(
            {
                name: () => 'serve',
                getOptionValueSource: (k) => (k === 'db' || k === 'teamDb' ? 'cli' : 'default'),
            },
            { db: '', teamDb: '   ' },
            undefined
        )
        const configErrors: string[] = []
        resolveDatabasePaths(resolver, (fn, fb) => {
            try {
                return fn()
            } catch (e) {
                configErrors.push(e instanceof Error ? e.message : String(e))
                return fb
            }
        })
        expect(configErrors.some((e) => e.includes('--db'))).toBe(true)
        expect(configErrors.some((e) => e.includes('--team-db'))).toBe(true)

        expect(() => new NativeConnectionManager('')).toThrow(/empty|whitespace/i)
        expect(() => new NativeConnectionManager('   ')).toThrow(/empty|whitespace/i)

        expect(() => resolveProjectConfigPath({ config: '' })).toThrow(/blank --config/i)
        expect(() => withIsolatedProjectConfigEnv({ config: '  ' }, () => undefined)).toThrow(/blank --config/i)
        const fakeCmd: CliCommandLike = { name: () => 'serve', getOptionValueSource: () => 'default' }
        expect(() => new ConfigResolver(fakeCmd, {}, '')).toThrow(/blank configuration file/i)

        // Mismatched quotes in .env stay literal while matched quotes strip
        fs.writeFileSync(path.join(dir, '.env'), "MJ_PASS82_QUOTE_TEST='mismatched\"\n", 'utf-8')
        vi.spyOn(process, 'cwd').mockReturnValue(dir)
        Reflect.deleteProperty(process.env, 'MJ_PASS82_QUOTE_TEST')
        new ConfigResolver(fakeCmd, {}, undefined)
        expect(process.env['MJ_PASS82_QUOTE_TEST']).toBe("'mismatched\"")
    })

    it('Low & AP checks: auto_context braces, unsafe SQL LIMIT, tie-breakers, facets cap, NaN timestamp, help JSON, project trim, encrypt-db & prompt rev', async () => {
        const balancedCtx = extractAndRecoverEntryCode(
            'await mj.createEntry({\n content: "ctx",\n auto_context: { meta: { a: 1 },\n b: 2 \n}\n)'
        )
        expect(balancedCtx).toContain('"auto_context":{"meta":{"a":1},"b":2}')

        expect(hasUnsupportedSqlTrailingClause('SELECT * FROM tags LIMIT 99999999999999999999', 'select')).toBe(true)
        expect(hasUnsupportedSqlTrailingClause('SELECT * FROM tags LIMIT 10', 'select')).toBe(false)

        expect(() =>
            getSearchFacets({ db: {} as never }, 'x'.repeat(501))
        ).toThrow(/500 characters/i)

        const collabConn = new NativeConnectionManager(':memory:')
        await collabConn.initialize()
        try {
            collabConn.applyTeamSchema()
            const dbNative = collabConn.getNativeDb()
            dbNative.prepare(`INSERT INTO memory_journal (content, entry_type, author, workspace_id, timestamp) VALUES ('c1', 'technical_note', 'bob', 'ws', '2026-11-24T00:00:00Z')`).run()
            dbNative.prepare(`INSERT INTO memory_journal (content, entry_type, author, workspace_id, timestamp) VALUES ('c2', 'technical_note', 'alice', 'ws', '2026-11-24T00:00:00Z')`).run()
            const metrics = getTeamCollaborationMetrics(collabConn, { period: 'day', limit: 10, workspaceId: 'ws' })
            expect(metrics.authorActivity.map((r) => r.author)).toEqual(['alice', 'bob'])
        } finally {
            collabConn.close()
        }

        const sigRes = significantResource.handler('memory://significant', {
            db: {
                getSignificantEntries: () => [{
                    id: 1, content: 'bad ts', entryType: 'technical_note', timestamp: 'not-a-date',
                    isPersonal: false, deletedAt: null,
                }],
                getRelationshipsForEntries: () => new Map(),
            },
        } as never) as { data: { entries: { importance: number }[] } }
        expect(Number.isFinite(sigRes.data.entries[0]?.importance)).toBe(true)

        const mergeTool = getMiscTools({ db: { mergeTags: () => { throw new Error('disk failure') } } as never }).find((t) => t.name === 'merge_tags')
        const mergeErr = (await mergeTool?.handler({ sourceTag: 'old', targetTag: 'new' })) as { sourceTag?: string; targetTag?: string }
        expect(mergeErr.sourceTag).toBe('old')
        expect(mergeErr.targetTag).toBe('new')

        const prog = createProgram()
        prog.option('--json', 'JSON output').option('--no-json', 'Text output').option('-q, --query <q>', 'Query')
        process.argv = ['node', 'mj', '--json', '--no-json', '--help']
        expect(prog.helpInformation()).not.toContain('"status": "success"')
        process.argv = ['node', 'mj', '--query', '--json', '--help']
        expect(prog.helpInformation()).not.toContain('"status": "success"')

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`EXIT:${String(code)}`) })
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        await expect(projectCreateAction(' spaced-name ', { path: process.cwd() }, new Command())).rejects.toThrow('EXIT:1')
        expect(exitSpy).toHaveBeenCalledWith(1)
        expect(stderrSpy).toHaveBeenCalled()

        const encSrc = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'encrypt-db.ts'), 'utf-8')
        expect(encSrc).toContain('lstatSync')
        expect(encSrc).toContain('O_NOFOLLOW')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass88')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass88')
        const cqDef = getCodeQualityAuditPromptDefinition()
        const cqRes = await cqDef.handler(
            { target: 'src', copilot: 'false' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof cqDef.handler>[1]
        )
        const cqText = (cqRes as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass88')
        expect(cqText).toContain('prevQuantAtoms')
        expect(cqText).toContain('mj.append(entry, options)')
    })
})
