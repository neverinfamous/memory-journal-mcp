import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { BackupManager } from '../../src/database/sqlite-adapter/backup.js'
import { queryEntryIdsByCommitShas } from '../../src/database/sqlite-adapter/graph-pivots.js'
import { runImmediateWriteTx } from '../../src/database/sqlite-adapter/row-helpers.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { parseYamlFrontmatter } from '../../src/markdown/converters/yaml-parser.js'
import { getRequiredScope, canonicalizeMemoryResourceUri } from '../../src/auth/scope-map.js'
import { resolveToolCallAuditScope } from '../../src/audit/audit-file-helpers.js'
import { extractAuditScopeFromArgs, normalizeAuditResourceUri } from '../../src/audit/audit-query-helpers.js'
import { resolveAutoPruneScope } from '../../src/utils/workspace-resolver.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { LinkEntriesSchemaMcp } from '../../src/handlers/tools/relationship-schemas.js'
import { instrumentToolDefinitions } from '../../src/handlers/tools/arg-interceptions.js'
import { findWildcardProjectMismatches } from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import { getProjectReadTools } from '../../src/handlers/tools/admin/project-read-tools.js'
import { getDiagnosticTools } from '../../src/handlers/tools/core/diagnostic-tools.js'
import { addIssueToProject } from '../../src/handlers/tools/github/create-issue-project.js'
import { getCloseGitHubIssueTool } from '../../src/handlers/tools/github/close-issue-tool.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { getIoImportTools } from '../../src/handlers/tools/io/import-tools.js'
import { parseContent } from '../../src/cli/commands/entry-payload.js'
import { collectExternalMarkdownFiles } from '../../src/cli/commands/io-external-helpers.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import type { ToolContext, ToolDefinition } from '../../src/types/index.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
    const base = path.join(process.cwd(), '.test-output', 'vitest')
    fs.mkdirSync(base, { recursive: true })
    const dir = fs.mkdtempSync(path.join(base, prefix))
    tempDirs.push(dir)
    return dir
}

describe('Pass 75 Audit — Storage, Server, Auth, Schemas & CLI', () => {
    const origLogLevel = process.env['LOG_LEVEL']
    const origDbKey = process.env['DB_ENCRYPTION_KEY']
    const origMjDbKey = process.env['MJ_DB_ENCRYPTION_KEY']

    beforeEach(() => {
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        if (origLogLevel === undefined) delete process.env['LOG_LEVEL']
        else process.env['LOG_LEVEL'] = origLogLevel
        if (origDbKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
        else process.env['DB_ENCRYPTION_KEY'] = origDbKey
        if (origMjDbKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
        else process.env['MJ_DB_ENCRYPTION_KEY'] = origMjDbKey
        vi.restoreAllMocks()
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('H7: preserves use_test_db across LinkEntriesSchemaMcp ZodPipe transform', () => {
        const fakeTool: ToolDefinition = {
            name: 'link_entries',
            title: 'Link',
            description: 'Link',
            group: 'relationships',
            inputSchema: LinkEntriesSchemaMcp,
            outputSchema: LinkEntriesSchemaMcp,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            handler: () => Promise.resolve({ success: true }),
        }
        const [instrumented] = instrumentToolDefinitions([fakeTool])
        const parsedAfter = instrumented?.inputSchema.parse({
            from: 1,
            to: 2,
            rel: 'references',
            use_test_db: true,
        }) as Record<string, unknown>
        expect(parsedAfter['use_test_db']).toBe(true)
        expect(parsedAfter['from_entry_id']).toBe(1)
        expect(parsedAfter['to_entry_id']).toBe(2)
    })

    it('H8: validates project ownership on same-workspace batch target_workspace_id moves', () => {
        const fakeDb = {
            getEntriesByIds: () =>
                new Map([
                    [10, { id: 10, workspaceId: 'repo-a', projectNumber: 1 }],
                    [11, { id: 11, workspaceId: 'repo-a', projectNumber: 9 }],
                ]),
        } as unknown as ToolContext['db']
        const mismatches = findWildcardProjectMismatches(
            fakeDb,
            [
                { entry_id: 10, project_number: 9, target_workspace_id: 'repo-a' },
                { entry_id: 11, project_number: 9, target_workspace_id: 'repo-a' },
            ],
            undefined,
            undefined,
            { projectRegistry: { 'repo-a': { project_number: 9 } } }
        )
        expect(mismatches).toEqual([10])
    })

    it('A-M1..A-M4 & A-L1..A-L4: auth URI decode, audit scope isolation, sanitizeDefaultWorkspaceId, SSE, path guards & ConfigManager', async () => {
        // A-M1: malformed % in URI host and mixed-case scheme
        expect(() => canonicalizeMemoryResourceUri('memory://%E0%A4%A/path')).not.toThrow()
        expect(getRequiredScope('MEMORY://Team/recent')).toBe('team')
        expect(getRequiredScope('MEMORY://Audit/logs')).toBe('audit')

        // A-M2 & A-L2: audit scope ignores wildcard/0 fallback and decodes scheme-less team/%2f
        const reqCtx = { ephemeralSessionProject: { workspaceId: 'repo-a', projectNumber: 5 } } as never
        const wildUri = resolveToolCallAuditScope('read_resource', { uri: 'memory://briefing/repo-b', workspace_id: '*' }, true, undefined, reqCtx)
        expect(wildUri.projectNumber).toBeUndefined()
        const badProj = extractAuditScopeFromArgs({ workspace_id: 'repo-b', project_number: 0 }, reqCtx)
        expect(badProj.projectNumber).toBeUndefined()
        expect(normalizeAuditResourceUri('team%2frecent')).toBe('memory://team/recent')

        // A-M3: resolveAutoPruneScope rejects __proto__ default
        expect(() => resolveAutoPruneScope('__proto__', undefined, undefined)).toThrow()

        // A-M4: LegacySSEServerTransport rejects batch array & non-jsonrpc object
        const transport = new LegacySSEServerTransport('/messages')
        transport.handleSseRequest(
            { on: () => undefined, destroyed: false } as never,
            { setTimeout: () => undefined, writeHead: () => undefined, write: () => undefined, on: () => undefined, writableEnded: false, destroyed: false, end: () => undefined } as never
        )
        const jsonSpy1 = vi.fn()
        const statusSpy1 = vi.fn(() => ({ json: jsonSpy1, end: () => undefined }))
        transport.handlePostMessage({ body: [{ jsonrpc: '2.0' }] } as never, { status: statusSpy1 } as never)
        expect(statusSpy1).toHaveBeenCalledWith(400)
        const statusSpy2 = vi.fn(() => ({ json: vi.fn(), end: () => undefined }))
        transport.handlePostMessage({ body: { method: 'ping' } } as never, { status: statusSpy2 } as never)
        expect(statusSpy2).toHaveBeenCalledWith(400)
        await transport.close()

        // A-L1: trailing dot/space & control char in Win32 paths
        expect(isValidProjectPath('C:\\work\\CON.txt')).toBe(false)
        expect(isValidProjectPath('C:\\work\\dir.')).toBe(false)
        expect(isValidProjectPath('C:\\work\\dir\r')).toBe(false)

        // A-L4: ConfigManager ignores unchanged baseline keys on reload (no spurious log/update)
        const cfgDir = makeTempDir('cfg-reload-')
        const cfgPath = path.join(cfgDir, 'config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ toolFilter: 'starter', codemodeInternalFullAccess: false }), 'utf8')
        const cm = new ConfigManager(
            {
                rawToolFilter: 'starter',
                toolFilterConfig: null,
                briefingConfig: {
                    commitCount: 3,
                    entryCount: 5,
                    summaryCount: 1,
                    includeTeam: false,
                    issueCount: 3,
                    prCount: 3,
                    prStatusBreakdown: false,
                    milestoneCount: 3,
                    workflowCount: 3,
                    workflowStatusBreakdown: false,
                    copilotReviews: false,
                    briefingImportanceThreshold: 0.5,
                    graphPivots: true,
                    insights: true,
                },
                codemodeInternalFullAccess: false,
            },
            cfgPath
        )
        const listener = vi.fn()
        cm.on('configChanged', listener)
        ;(cm as unknown as { reloadFromFile: () => void }).reloadFromFile()
        expect(listener).not.toHaveBeenCalled()
        cm.close()
    })

    it('B-B1..B-B7: SQLite search cursors, fuzzy offset, SHA pivots, immediate tx, team schema flag, yaml CRLF & backup trim/sort', async () => {
        const dbDir = makeTempDir('db-pass75-')
        const dbPath = path.join(dbDir, 'test.db')
        const backupsDir = path.join(dbDir, 'backups')
        const adapter = new DatabaseAdapter(dbPath, undefined, { backupsDir })
        await adapter.initialize()
        try {
            // B-B4: runImmediateWriteTx creates entry cleanly inside immediate tx
            const rawConn = (adapter as unknown as { connection: NativeConnectionManager }).connection
            const nativeDb = rawConn.getNativeDb()
            const created = runImmediateWriteTx(nativeDb, () =>
                adapter.createEntry({
                    content: 'Alpha beta gamma note',
                    workspaceId: 'ws1',
                    projectNumber: 1,
                })
            )
            expect(created.id).toBeGreaterThan(0)
            adapter.createEntry({ content: 'Second entry commit pivot', workspaceId: 'ws1', projectNumber: 1 })

            // B-B1 & B-B2: searchEntries preserves degraded cursor & skips fuzzy on offset > 0
            const sym = adapter.searchEntries(':::', { limit: 1, workspaceId: 'ws1' })
            expect(sym.degraded).toBe(true)
            const fuzzyAtOffset = adapter.searchEntries('nonexistentword', {
                fuzzy_match: true,
                offset: 1,
                workspaceId: 'ws1',
            })
            expect(fuzzyAtOffset.suggestions).toBeUndefined()
            expect(fuzzyAtOffset.correctedQuery).toBeUndefined()

            // B-B3: short SHA prefix does not match unrelated commit SHA
            const entry = adapter.createEntry({
                content: 'Commit entry',
                workspaceId: 'ws1',
                projectNumber: 1,
                autoContext: JSON.stringify({ commits: ['abc'] }),
            })
            const hits = queryEntryIdsByCommitShas(nativeDb, ['abc1234567'], 'ws1')
            expect(hits.get('abc1234567') ?? []).not.toContain(entry.id)

            // B-B5: teamSchemaApplied stays false if MigrationManager.applyTeamMigrations throws
            const spyMig = vi.spyOn(MigrationManager, 'applyTeamMigrations').mockImplementationOnce(() => {
                throw new Error('boom')
            })
            expect(() => rawConn.applyTeamSchema()).toThrow('boom')
            expect((rawConn as unknown as { teamSchemaApplied: boolean }).teamSchemaApplied).toBe(false)
            spyMig.mockRestore()

            // B-B7: BackupManager export trims rawSanitized & listBackups has deterministic tie-break
            const exp1 = await adapter.exportToFile('  custom_b  ')
            const exp2 = await adapter.exportToFile('  custom_a  ')
            expect(exp1.filename).toBe('custom_b.db')
            const list = await adapter.listBackups()
            expect(list.some((b) => b.filename === exp2.filename)).toBe(true)
        } finally {
            await adapter.close()
        }

        // B-B6: YAML parser handles lone CR newlines and avoids single-quote strip underflow
        const parsedYaml = parseYamlFrontmatter("---\rtitle: 'cr-title'\rquote: '\r---\rBody text")
        expect(parsedYaml.metadata['title']).toBe('cr-title')
        expect(parsedYaml.metadata['quote']).toBe("'")
        expect(parsedYaml.body).toContain('Body text')

        // Check BackupManager standalone on :memory: rejects cleanly
        const memMgr = new BackupManager({ getDbPath: () => ':memory:' } as never)
        await expect(memMgr.exportToFile('x')).rejects.toThrow(':memory:')
    })

    it('D-M1..D-M5 & D-L1..D-L4: strict params, piped Buffer stdin, Kanban fencing, realpath loop, team suggestion & CLI config defer', async () => {
        // D-M1: list_projects and trigger_progress reject unknown keys
        const readTool = getProjectReadTools(makeCtx(), { loadConfig: () => ({}), coerceRegistryProjectNumber: () => undefined })[0]
        expect(readTool).toBeDefined()
        if (readTool === undefined) throw new Error('missing list_projects')
        const listRes = (await readTool.handler({ unexpected_extra: 1 })) as Record<string, unknown>
        expect(listRes['success']).toBe(false)

        const diagProgress = getDiagnosticTools(makeCtx()).find((t) => t.name === 'trigger_progress')
        expect(diagProgress).toBeDefined()
        if (diagProgress === undefined) throw new Error('missing trigger_progress')
        const progRes = (await diagProgress.handler({ extra: true })) as Record<string, unknown>
        expect(progRes['success']).toBe(false)

        // D-M3: piped stdin Buffer chunks decode multi-byte UTF-8 properly without corrupting surrogate sequences
        const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
        const beforeListeners = process.stdin.listenerCount('data')
        const pauseSpy = vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin)
        let scheduled = false
        const resumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => {
            if (!scheduled) {
                scheduled = true
                queueMicrotask(() => {
                    const utf8Buf = Buffer.from('Hello 😀 world', 'utf8')
                    process.stdin.emit('data', utf8Buf.subarray(0, 8))
                    process.stdin.emit('data', utf8Buf.subarray(8))
                    process.stdin.emit('end')
                })
            }
            return process.stdin
        })
        try {
            const text = await parseContent({})
            expect(text).toBe('Hello 😀 world')
            expect(resumeSpy).toHaveBeenCalled()
            expect(pauseSpy).toHaveBeenCalled()
            expect(process.stdin.listenerCount('data')).toBe(beforeListeners)
        } finally {
            if (origIsTTY !== undefined) Object.defineProperty(process.stdin, 'isTTY', origIsTTY)
        }

        // D-M4: addIssueToProject fences status even when move fails or status not found
        const projRes = await addIssueToProject(
            {
                getProjectKanban: () => Promise.resolve({ projectId: 'P1', statusFieldId: 'F1', statusOptions: [{ id: 'O1', name: 'Todo' }] }),
                addProjectItem: () => Promise.resolve({ success: true, itemId: 'I1' }),
                moveProjectItem: () => Promise.resolve({ success: false, error: 'denied' }),
            } as never,
            'owner',
            'repo',
            'N1',
            5,
            '<evil>Status</evil>'
        )
        expect(projRes.initialStatus?.status).toContain('&lt;evil&gt;')

        // D-M5: collectExternalMarkdownFiles pins realpathSync.native and re-checks safety
        const ioDir = makeTempDir('cli-io-')
        fs.writeFileSync(path.join(ioDir, 'note.md'), '# Note\nBody', 'utf8')
        const collected = await collectExternalMarkdownFiles(ioDir, 'obsidian', 10)
        expect(collected.parsedFiles).toHaveLength(1)

        // D-L1: team_get_recent error suggestion names mj.admin.listProjects()
        const teamGetRecent = getTeamCoreTools({
            db: {} as ToolContext['db'],
            teamDb: {} as ToolContext['teamDb'],
            config: { projectRegistry: { a: { project_number: 1 } } },
        }).find((t) => t.name === 'team_get_recent')
        expect(teamGetRecent).toBeDefined()
        if (teamGetRecent === undefined) throw new Error('missing team_get_recent')
        const teamErr = (await teamGetRecent.handler({ workspace_id: '*' })) as Record<string, unknown>
        expect(String(teamErr['suggestion'] ?? '')).toContain('mj.admin.listProjects({})')

        // D-L2: dumpConfig validates invalid logLevel and does not mutate process.env
        const errors: string[] = []
        const origAuthScopes = process.env['MCP_AUTH_SCOPES']
        buildServerOptions(
            {
                loadedConfigPath: undefined,
                resolve: (key: string) =>
                    key === 'logLevel'
                        ? 'invalid-level'
                        : key === 'authScopes'
                          ? 'read write'
                          : undefined,
                resolveInt: () => undefined,
                resolveNumber: () => undefined,
                resolveBool: () => undefined,
                resolveStringArray: () => undefined,
                isCliProvided: () => false,
                hasConfigFileKey: () => false,
            } as never,
            { dumpConfig: true },
            { name: () => 'serve', getOptionValueSource: () => undefined, opts: () => ({}) } as never,
            errors
        )
        expect(errors.length).toBeGreaterThan(0)
        expect(process.env['LOG_LEVEL']).toBe(origLogLevel)
        expect(process.env['MCP_AUTH_SCOPES']).toBe(origAuthScopes)

        // D-L4: import_markdown rejects project_number <= 0 before filesystem I/O & close_github_issue_with_entry rejects '*' early
        const impTool = getIoImportTools(makeCtx({ config: { allowedIoRoots: [ioDir] } })).find(
            (t) => t.name === 'import_markdown'
        )
        expect(impTool).toBeDefined()
        if (impTool === undefined) throw new Error('missing import_markdown')
        const impErr = (await impTool.handler({
            source_dir: path.join(ioDir, 'nonexistent'),
            project_number: 0,
        })) as Record<string, unknown>
        expect(impErr['success']).toBe(false)

        const ghGetSpy = vi.fn()
        const closeTool = getCloseGitHubIssueTool(makeCtx({ github: { getIssue: ghGetSpy } as never }))
        const closeErr = (await closeTool.handler({
            issue_number: 1,
            project_number: 5,
            workspace_id: '*',
        })) as Record<string, unknown>
        expect(closeErr['success']).toBe(false)
        expect(ghGetSpy).not.toHaveBeenCalled()
    })
})

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        db: {} as ToolContext['db'],
        ...overrides,
    }
}
