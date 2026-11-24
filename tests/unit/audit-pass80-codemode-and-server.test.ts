import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { workspaceSnapshotType } from '../../src/database/sqlite-adapter/entries/digest.js'
import { attachCallToolInterceptor } from '../../src/server/mcp-server/tool-registration/call-interceptor.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { isSafeUserRegex } from '../../src/handlers/tools/core/dummy-healing/regex-safety.js'
import { readMarkdownFilesParallel } from '../../src/markdown/importer-scope.js'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import { projectCreateAction } from '../../src/cli/commands/project.js'
import { createGetReadFindInterceptor, createAppendInterceptor } from '../../src/codemode/worker/mj-shim-domains.js'
import { readExecutableCode } from '../../src/codemode/worker/nested-exec-payload.js'
import { normalizeExecuteCodeAliases } from '../../src/codemode/normalizers/execute-code-aliases.js'
import { normalizeProjectAliases } from '../../src/codemode/normalizers/project-alias-helpers.js'
import { normalizeParams } from '../../src/codemode/api/param-normalizer.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 80 Audit — Code Mode, ReDoS, Authz Ordering, Importer & CLI', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedCfg: string | undefined
    let savedRegistry: string | undefined
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
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (savedEnc !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEnc !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedCfg !== undefined) process.env['MEMORY_JOURNAL_CONFIG'] = savedCfg
        else delete process.env['MEMORY_JOURNAL_CONFIG']
        if (savedRegistry !== undefined) process.env['PROJECT_REGISTRY'] = savedRegistry
        else delete process.env['PROJECT_REGISTRY']
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('C1: preserves use_test_db across structured JSON, search, fuzzy recovery, context & NL paths', () => {
        const del = recoverStructuredJsonCode(
            JSON.stringify({ action: 'delete', entry_id: 1, use_test_db: true })
        )
        expect(del).toContain('mj.admin.deleteEntry')
        expect(del).toContain('"use_test_db":true')

        const srch = recoverStructuredJsonCode(JSON.stringify({ query: 'auth', use_test_db: true }))
        expect(srch).toContain('"use_test_db":true')

        const named = recoverStructuredJsonCode(
            JSON.stringify({ tool: 'core.getEntryById', params: { entry_id: 1 }, use_test_db: true })
        )
        expect(named).toContain('"use_test_db":true')

        const fuzzy = extractAndRecoverEntryCode(
            'return await mj.core.createEntry({ content: "test-only" use_test_db: true })'
        )
        expect(fuzzy).toContain('"use_test_db":true')

        for (const rawInput of [
            { payload: { content: 'test-only', use_test_db: true } },
            { context: { content: 'test-only', use_test_db: true } },
            { context: { query: 'auth', useTestDb: true } },
            { content: 'log test note', use_test_db: true },
        ] as Record<string, unknown>[]) {
            const res = resolveExecutionPayload(rawInput as never, rawInput, true, 0)
            expect('executionCode' in res).toBe(true)
            if ('executionCode' in res) {
                expect(res.executionCode).toContain('"use_test_db":true')
            }
        }
    })

    it('H1 & L1: rejects unrecoverable discriminators before fallback synthesis and rejects non-numeric unit scores', () => {
        expect(
            recoverStructuredJsonCode(JSON.stringify({ tool: 'bad;tool()', content: 'do not create me' }))
        ).toBeNull()

        const cases: Record<string, unknown>[] = [
            { operation: 'delete', rule: 'do not create me' },
            { operation: 'delete', content: 'do not create me' },
            { action: 'delete', content: 'do not create me' },
            { context: { action: 'delete', content: 'do not create me' } },
        ]
        for (const c of cases) {
            const copy = { ...c }
            normalizeExecuteCodeAliases(copy)
            const res = resolveExecutionPayload(copy as never, copy, true, 0)
            expect('earlyReturn' in res && res.earlyReturn['code']).toBe('VALIDATION_ERROR')
        }

        expect(readExecutableCode({ action: 'delete', content: 'do not create me' })).toBe('')

        for (const badImpact of ['', false, Number.POSITIVE_INFINITY] as const) {
            const res = resolveExecutionPayload(
                { content: 'note body', impact: badImpact } as never,
                { content: 'note body', impact: badImpact },
                true,
                0
            )
            expect('executionCode' in res).toBe(true)
            if ('executionCode' in res) {
                expect(res.executionCode).not.toContain('impact_score')
            }
        }
    })

    it('H2 & H3: preserves outer wrapper fields on payload/entry recovery and routes quoted/non-numeric updateMemory IDs to updateEntry', () => {
        const moveInput: Record<string, unknown> = {
            entry: { entry_id: 42, content: 'moved' },
            target_workspace_id: 'repo-b',
            share_with_team: true,
        }
        normalizeExecuteCodeAliases(moveInput)
        const moveRes = resolveExecutionPayload(moveInput as never, moveInput, true, 0)
        expect('executionCode' in moveRes).toBe(true)
        if ('executionCode' in moveRes) {
            expect(moveRes.executionCode).toContain('mj.admin.updateEntry')
            expect(moveRes.executionCode).toContain('"target_workspace_id":"repo-b"')
            expect(moveRes.executionCode).toContain('"share_with_team":true')
        }

        const searchWrap: Record<string, unknown> = {
            payload: { query: 'auth' },
            limit: 5,
            exclude_tags: ['commit-narrative'],
        }
        normalizeExecuteCodeAliases(searchWrap)
        const searchRes = resolveExecutionPayload(searchWrap as never, searchWrap, true, 0)
        expect('executionCode' in searchRes).toBe(true)
        if ('executionCode' in searchRes) {
            expect(searchRes.executionCode).toContain('"limit":5')
            expect(searchRes.executionCode).toContain('"exclude_tags":["commit-narrative"]')
        }

        const quotedId = extractAndRecoverEntryCode(
            'return await mj.updateMemory({ entry_id: "42", content: "updated text" badSyntax })'
        )
        expect(quotedId).toContain('mj.updateEntry')
        expect(quotedId).toContain('"entry_id":42')
        expect(quotedId).not.toContain('technical_note')

        const nonNumId = extractAndRecoverEntryCode(
            'return await mj.updateMemory({ entry_id: "abc", content: "updated text" badSyntax })'
        )
        expect(nonNumId).toContain('mj.updateEntry')
        expect(nonNumId).toContain('"entry_id":"abc"')
    })

    it('M4, M5, M6 & M7: merges 2-arg positional/record calls, forwards project_id in append, avoids blank alias shadowing, and enforces SQL LIMIT parity', async () => {
        const getCalls: unknown[][] = []
        const searchCalls: unknown[][] = []
        const shim = {
            core: { get_entry_by_id: (...a: unknown[]) => { getCalls.push(a); return { success: true } } },
            search: { search_entries: (...a: unknown[]) => { searchCalls.push(a); return { success: true } } },
        }
        const getter = createGetReadFindInterceptor(shim, shim)
        getter(42, { workspace_id: 'ws-a' })
        getter('auth query', { limit: 5 })
        expect(getCalls[0]).toEqual([{ entry_id: 42, workspace_id: 'ws-a' }])
        expect(searchCalls[0]).toEqual([{ query: 'auth query', limit: 5 }])

        expect(normalizeParams('getEntryById', [{ entry_id: 42 }, { workspace_id: 'ws-a' }])).toEqual({
            entry_id: 42,
            workspace_id: 'ws-a',
        })

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
        await (coreGrp['getEntryById'] as (a: unknown, b?: unknown) => Promise<unknown>)(
            { entry_id: 9 },
            { session_id: 's2', workspace_id: 'ws-b' }
        )
        expect(teamCalls[0]).toMatchObject({ entry_id: 9, session_id: 's2', workspace_id: 'ws-b' })

        const appendCreated: unknown[] = []
        const appendFn = createAppendInterceptor({
            core: { createEntry: (a: unknown) => { appendCreated.push(a); return { success: true } } },
        })
        appendFn?.(['t'], 'body', { project_id: 5 })
        expect(appendCreated[0]).toMatchObject({ project_number: 5, project_id: 5 })

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const sessionRes = await resolveCodeModeSessionContext(
                {
                    db,
                    config: {
                        codemodeInternalFullAccess: true,
                        projectRegistry: { 'repo-a': { path: process.cwd(), project_number: 5 } },
                    },
                } as never,
                { workspace_id: '', workspaceId: 'repo-a', repo: '', repo_name: 'repo-a' } as never
            )
            expect('workspaceId' in sessionRes && sessionRes.workspaceId).toBe('repo-a')
            expect('projectId' in sessionRes && sessionRes.projectId).toBe(5)
        } finally {
            db.close()
        }

        const blankShadowed: Record<string, unknown> = { workspace_id: '', workspaceId: 'repo-a' }
        normalizeProjectAliases(blankShadowed)
        expect(blankShadowed['workspace_id']).toBe('repo-a')
        const bareBlank: Record<string, unknown> = { workspace_id: '' }
        normalizeProjectAliases(bareBlank)
        expect(bareBlank['workspace_id']).toBe('')

        expect(extractAndRecoverSqlCode('SELECT * FROM audit_log LIMIT 5')).toContain('"limit":5')
        expect(extractAndRecoverSqlCode('SELECT * FROM relationships WHERE entry_id = 42 LIMIT 3')).toContain('"limit":3')
        expect(extractAndRecoverSqlCode('SELECT * FROM tags LIMIT 5')).toBeNull()
    })

    it('H4: isSafeUserRegex blocks O(n^5) ReDoS bypasses while keeping safe search patterns green', () => {
        expect(isSafeUserRegex('[^\\n]+[^\\n][^\\n]+[^\\n][^\\n]+[^\\n][^\\n]+[^\\n][^\\n]+\\x00')).toBe(false)
        expect(isSafeUserRegex('\\x61+\\x61+\\x61+\\x61+\\x61+b')).toBe(false)
        expect(isSafeUserRegex('a+aa+aa+aa+aa+b')).toBe(false)
        expect(isSafeUserRegex('[^\\n]+a[^\\n]+b[^\\n]+c')).toBe(false)

        expect(isSafeUserRegex('foo.*bar')).toBe(true)
        expect(isSafeUserRegex('\\w+\\s*=\\s*\\d+')).toBe(true)
        expect(isSafeUserRegex('function\\s+\\w+\\(')).toBe(true)
        expect(isSafeUserRegex('import\\s+\\w+\\s+from\\s+[\'"].+[\'"]')).toBe(true)
        expect(isSafeUserRegex('error|warning|fatal')).toBe(true)
        expect(isSafeUserRegex('a+b+c+')).toBe(true)
        expect(isSafeUserRegex('(?<tag>feat|fix)\\s+\\w+')).toBe(true)
    })

    it('M1, M2, M3, L2, L3, L4 & AP*: importer chunk-0 checks, pre-heal alias block, isolated project init, config filter trim, facets/digest, encrypt-db & prompt revision', async () => {
        const events: string[] = []
        await readMarkdownFilesParallel(
            ['one.md'],
            async () => ({ skipped: true }),
            (idx) => { events.push(`before:${String(idx)}`) },
            (idx) => { events.push(`after:${String(idx)}`) }
        )
        expect(events).toEqual(['before:0', 'after:0'])

        const impParent = makeTempDir('mj-p80-imp-')
        const impDir = path.join(impParent, 'in')
        const swappedDir = path.join(impParent, 'swapped')
        fs.mkdirSync(impDir, { recursive: true })
        fs.mkdirSync(swappedDir, { recursive: true })
        fs.writeFileSync(path.join(impDir, '1.md'), '---\n{"workspace_id":"ws-a"}\n---\nHello import\n', 'utf-8')
        const impDb = new DatabaseAdapter(':memory:')
        await impDb.initialize()
        try {
            const realOrig = fs.realpathSync.native
            const realImpDir = realOrig(impDir)
            const impRes = await importMarkdownEntries(impDir, impDb, { workspaceId: 'ws-a' }, undefined, [impParent])
            expect(impRes.success).toBe(true)

            let swapHits = 0
            vi.spyOn(fs.realpathSync, 'native').mockImplementation(((p: fs.PathLike) => {
                const resolved = realOrig(p)
                if (resolved === realImpDir) {
                    swapHits++
                    if (swapHits >= 4) return realOrig(swappedDir)
                }
                return resolved
            }) as typeof fs.realpathSync.native)
            await expect(
                importMarkdownEntries(impDir, impDb, { dry_run: true, workspaceId: 'ws-a' }, undefined, [impParent])
            ).rejects.toThrow(/symlink changed during batch/i)
        } finally {
            impDb.close()
        }

        const origCalls: string[] = []
        const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>()
        handlers.set('tools/call', async (req: unknown) => {
            const p = (req as { params?: { name?: string } }).params
            origCalls.push(p?.name ?? '')
            return { isError: true, content: [{ type: 'text', text: 'PERMISSION_DENIED' }] }
        })
        const cfgMgr = new ConfigManager({ rawToolFilter: '   ', briefingConfig: { ...DEFAULT_BRIEFING_CONFIG } })
        try {
            expect(cfgMgr.getConfig().toolFilterConfig).toBeUndefined()
            cfgMgr.updateConfig({ rawToolFilter: '   ' })
            expect(cfgMgr.getConfig().toolFilterConfig).toBeNull()

            attachCallToolInterceptor(
                handlers,
                { db: {} as never, configManager: cfgMgr, runtime: new ServerRuntime(), allowedIoRoots: [] },
                { name: 'test', version: '1.0.0', transport: 'stdio' },
                [],
                [{ name: 'create_entry' } as never],
                new Set(['create_entry']),
                {}
            )
            const intercepted = handlers.get('tools/call')
            const denied = await runWithAuthContext({ claims: { scopes: ['read'] } } as never, () =>
                intercepted?.(
                    { method: 'tools/call', params: { name: 'create_entry_minimal', arguments: { content: 'hi', project_number: -5 } } },
                    {}
                )
            )
            expect(origCalls).toEqual(['create_entry'])
            expect((denied as { isError?: boolean }).isError).toBe(true)
        } finally {
            cfgMgr.close()
        }

        const cliDir = makeTempDir('mj-p80-cli-')
        const hostCfg = path.join(cliDir, 'host.json')
        const freshCfg = path.join(cliDir, 'fresh.json')
        const cliDbPath = path.join(cliDir, 'sandbox.db')
        const sandboxRepoDir = path.join(cliDir, 'sandbox-app')
        fs.mkdirSync(sandboxRepoDir, { recursive: true })
        fs.writeFileSync(hostCfg, JSON.stringify({ projectRegistry: { 'other-repo': { path: cliDir, project_number: 5 } } }), 'utf-8')
        process.env['MEMORY_JOURNAL_CONFIG'] = hostCfg
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const rootCmd = new Command().option('--json', 'JSON')
        rootCmd.parse(['node', 'mj', '--json'], { from: 'node' })
        process.exitCode = undefined
        await projectCreateAction('sandbox-app', { path: sandboxRepoDir, number: '5', db: cliDbPath, config: freshCfg, json: true }, rootCmd)
        expect(process.exitCode).toBeUndefined()
        expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('"initialized":true')
        expect(stderrSpy).not.toHaveBeenCalled()

        expect(workspaceSnapshotType('digest', '  repo-a  ')).toBe('digest:repo-a')
        expect(workspaceSnapshotType('digest', '   ')).toBe('digest')

        const facetDb = new DatabaseAdapter(':memory:')
        await facetDb.initialize()
        try {
            facetDb.createEntry({ content: 'facet needle', entryType: 'project_decision', workspaceId: 'ws-f' })
            facetDb.createEntry({ content: 'facet needle', entryType: 'bug_fix', workspaceId: 'ws-f' })
            const facets = facetDb.getSearchFacets('facet', { workspaceId: 'ws-f' })
            expect(facets.entryTypes.map((t) => t.name)).toEqual(['bug_fix', 'project_decision'])
        } finally {
            facetDb.close()
        }

        const encSrc = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'encrypt-db.ts'), 'utf-8')
        expect(encSrc).toContain('randomBytes')
        expect(encSrc).toContain('O_EXCL')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass82')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass82')
        const cqDef = getCodeQualityAuditPromptDefinition()
        const cqRes = await cqDef.handler(
            { target: 'src', copilot: 'false' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof cqDef.handler>[1]
        )
        const cqText = (cqRes as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass82')
        expect(cqText).toContain('overlapping unquantified atoms')
        expect(cqText).toContain('O_CREAT|O_EXCL|O_NOFOLLOW')
    })
})
