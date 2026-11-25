import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { VectorOperations } from '../../src/database/sqlite-adapter/vector-operations.js'
import { getAuthorStatistics } from '../../src/database/sqlite-adapter/insights/team-collaboration.js'
import { getCrossProjectInsights } from '../../src/database/sqlite-adapter/insights/cross-project.js'
import { getStatistics } from '../../src/database/sqlite-adapter/entries/statistics.js'
import { computeDigest } from '../../src/database/sqlite-adapter/entries/digest.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/manager.js'
import { recoverStructuredJsonCode } from '../../src/handlers/tools/codemode/json-entry-structured.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { buildSandboxUserContext } from '../../src/handlers/tools/codemode/sandbox-user-context.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { hasUnsupportedSqlTrailingClause } from '../../src/codemode/sql-clause-validator.js'
import { extractNestedTimeoutMs } from '../../src/codemode/worker/nested-exec-payload.js'
import { isProjectStringValue } from '../../src/codemode/worker/nested-exec-validation.js'
import { applyDomainToolInterceptions } from '../../src/codemode/normalizers/domain-tool-interceptions.js'
import { wireProjectAndTeamAliasesHelper } from '../../src/codemode/api/journal-api-aliases.js'
import {
    AddAuthorAliasSchema,
    ConsolidateAuthorsSchema,
    ListAuthorAliasesSchema,
    RemoveAuthorAliasSchema,
    ResolveAuthorSchema,
} from '../../src/handlers/tools/team/alias-schemas.js'
import { getSearchEntriesTool } from '../../src/handlers/tools/search/search-entries.js'
import { executeSemanticSearch } from '../../src/handlers/tools/search/semantic-search-helpers.js'
import { executeTeamSemanticSearch } from '../../src/handlers/tools/team/vector-helpers.js'
import { handleCrossTeamSearch } from '../../src/handlers/tools/search/cross-team.js'
import { buildServerOptions } from '../../src/cli/server-options-builder.js'
import {
    resolveDatabasePaths,
    resolveInstructionLevelOption,
    resolveMaxToolInputElementsOption,
} from '../../src/cli/server-options-groups.js'
import { parseLogLevelOption } from '../../src/cli/server-options-parsers.js'
import {
    safeCoerceDefaultProject,
    safeCoerceNumber,
    safeCoercePositiveInt,
} from '../../src/cli/schemas.js'
import { projectListAction } from '../../src/cli/commands/project.js'
import { pruneAction } from '../../src/cli/commands/admin.js'
import { resolveAutoContext } from '../../src/cli/commands/entry-payload-helpers.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import {
    CODE_QUALITY_PROMPT_REVISION,
    getCodeQualityAuditPromptDefinition,
} from '../../src/handlers/prompts/adversarial-code-quality.js'

describe('Pass 83 Audit — Code Mode Dispatch, Search, Insights & CLI Hardening', () => {
    let savedEnc: string | undefined
    let savedDbEnc: string | undefined
    let savedDbPath: string | undefined
    let savedCfg: string | undefined
    let savedPruneExcl: string | undefined
    const tempDirs: string[] = []

    const makeTempDir = (prefix: string): string => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(d)
        return d
    }

    beforeEach(() => {
        savedEnc = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEnc = process.env['DB_ENCRYPTION_KEY']
        savedDbPath = process.env['DB_PATH']
        savedCfg = process.env['MEMORY_JOURNAL_CONFIG']
        savedPruneExcl = process.env['PRUNE_EXCLUDE_TAGS']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['DB_PATH'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        process.exitCode = undefined
        if (savedEnc === undefined) Reflect.deleteProperty(process.env, 'MJ_DB_ENCRYPTION_KEY')
        else process.env['MJ_DB_ENCRYPTION_KEY'] = savedEnc
        if (savedDbEnc === undefined) Reflect.deleteProperty(process.env, 'DB_ENCRYPTION_KEY')
        else process.env['DB_ENCRYPTION_KEY'] = savedDbEnc
        if (savedDbPath === undefined) Reflect.deleteProperty(process.env, 'DB_PATH')
        else process.env['DB_PATH'] = savedDbPath
        if (savedCfg === undefined) Reflect.deleteProperty(process.env, 'MEMORY_JOURNAL_CONFIG')
        else process.env['MEMORY_JOURNAL_CONFIG'] = savedCfg
        if (savedPruneExcl === undefined) Reflect.deleteProperty(process.env, 'PRUNE_EXCLUDE_TAGS')
        else process.env['PRUNE_EXCLUDE_TAGS'] = savedPruneExcl
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('H1-H3: flat named tool calls, whitespace-padded SQL project_number scope, and flat entry_id update/lookup recovery', () => {
        const flatTool = recoverStructuredJsonCode(
            JSON.stringify({ tool: 'get_recent_entries', limit: 3, timeout: 1500, dry_run: true })
        )
        expect(flatTool).toContain('{"limit":3}')
        expect(flatTool).not.toContain('timeout')
        expect(flatTool).not.toContain('dry_run')

        const wrappedTool = recoverStructuredJsonCode(
            JSON.stringify({ payload: { tool: 'get_recent_entries', limit: 4 }, workspace_id: 'ws', use_test_db: true })
        )
        expect(wrappedTool).toContain('"limit":4')
        expect(wrappedTool).toContain('"workspace_id":"ws"')
        expect(wrappedTool).toContain('"use_test_db":true')

        const delSql = extractAndRecoverSqlCode(
            "DELETE FROM memory_journal WHERE id = 12 AND project_number = ' 5 '"
        )
        expect(delSql).toContain('mj.admin.deleteEntry({"entry_id":12,"project_number":5})')

        const mismatchUpdate = extractAndRecoverSqlCode(
            "UPDATE memory_journal SET project_number = 9 WHERE id = 12 AND project_number = ' 5 '"
        )
        expect(mismatchUpdate).toBeNull()

        const flatMetaUpdate = resolveExecutionPayload(
            {} as never,
            {
                entry_id: 5,
                tags: ['audit-fix'],
                auto_context: '{"commits":["abc"]}',
                expected_version: 2,
            },
            true,
            0
        )
        expect('executionCode' in flatMetaUpdate).toBe(true)
        if ('executionCode' in flatMetaUpdate) {
            expect(flatMetaUpdate.executionCode).toContain('mj.admin.updateEntry')
            expect(flatMetaUpdate.executionCode).toContain('"entry_id":5')
            expect(flatMetaUpdate.executionCode).toContain('"tags":["audit-fix"]')
            expect(flatMetaUpdate.executionCode).toContain('"expected_version":2')
            expect(flatMetaUpdate.executionCode).toContain('"auto_context":"{\\"commits\\":[\\"abc\\"]}"')
        }

        const idOnly = resolveExecutionPayload({} as never, { entry_id: 5 }, true, 0)
        expect('executionCode' in idOnly).toBe(true)
        if ('executionCode' in idOnly) {
            expect(idOnly.executionCode).toContain('mj.core.getEntryById({ entry_id: 5 })')
        }

        const blankId = resolveExecutionPayload({} as never, { entry_id: '' }, true, 0)
        expect('earlyReturn' in blankId).toBe(true)
        if ('earlyReturn' in blankId) {
            expect(blankId.earlyReturn['success']).toBe(false)
        }
    })

    it('M1-M2: strict author-alias interceptions per tool and integer VM timeout clamping', () => {
        const resolveArgs = applyDomainToolInterceptions('team_resolve_author', [
            { q: 'Alex', project_number: 5 },
        ])
        expect('args' in resolveArgs).toBe(true)
        if ('args' in resolveArgs) {
            expect(ResolveAuthorSchema.parse(resolveArgs.args[0])).toEqual({
                author: 'Alex',
                project_number: 5,
            })
        }

        const removeArgs = applyDomainToolInterceptions('team_remove_author_alias', [
            { q: 'Alex', project_number: 5 },
        ])
        expect('args' in removeArgs).toBe(true)
        if ('args' in removeArgs) {
            expect(RemoveAuthorAliasSchema.parse(removeArgs.args[0])).toEqual({
                alias: 'Alex',
                project_number: 5,
            })
        }

        const listArgs = applyDomainToolInterceptions('team_list_author_aliases', [
            { q: 'alex', project_number: 5 },
        ])
        expect('args' in listArgs).toBe(true)
        if ('args' in listArgs) {
            expect(ListAuthorAliasesSchema.parse(listArgs.args[0])).toEqual({
                canonical_author: 'alex',
                project_number: 5,
            })
        }

        const consolidateArgs = applyDomainToolInterceptions('team_consolidate_authors', [
            { query: 'alex', author: 'alex', project_number: 5 },
        ])
        expect('args' in consolidateArgs).toBe(true)
        if ('args' in consolidateArgs) {
            expect(ConsolidateAuthorsSchema.parse(consolidateArgs.args[0])).toEqual({
                canonical_author: 'alex',
                project_number: 5,
            })
        }

        const addArgs = applyDomainToolInterceptions('team_add_author_alias', [
            { text: 'Alex', to: 'alex-dev', project_number: 5 },
        ])
        expect('args' in addArgs).toBe(true)
        if ('args' in addArgs) {
            expect(AddAuthorAliasSchema.parse(addArgs.args[0])).toEqual({
                alias: 'Alex',
                canonical_author: 'alex-dev',
                project_number: 5,
            })
        }

        expect(ExecuteCodeSchema.parse({ code: '1', timeout: 0.5 }).timeout).toBe(1)
        expect(ExecuteCodeSchema.parse({ code: '1', timeout: '1.5' }).timeout).toBe(2)
        expect(extractNestedTimeoutMs({ timeout: 0.5 }, 5000)).toBe(1)
        expect(extractNestedTimeoutMs({ timeout: '1.5' }, 1.2)).toBe(2)
    })

    it('M3 & L5: rejects blank semantic queries, avoids blank hybrid embeddings, and deduplicates cross_team_search labels', async () => {
        const searchCandidatesMock = vi.fn().mockResolvedValue([])
        const ftsMock = vi.fn().mockReturnValue({ entries: [], nextCursor: undefined })
        const searchTool = getSearchEntriesTool({
            db: { searchEntries: ftsMock, getTagsForEntries: () => new Map() } as never,
            vectorManager: { searchCandidates: searchCandidatesMock, search: vi.fn().mockResolvedValue([]) } as never,
        })[0]

        const blankSemantic = (await searchTool?.handler({
            query: '   ',
            mode: 'semantic',
            tags: ['arch'],
        })) as { success: boolean; code?: string }
        expect(blankSemantic.success).toBe(false)
        expect(blankSemantic.code).toBe('VALIDATION_ERROR')

        const blankHybrid = (await searchTool?.handler({
            query: '',
            mode: 'hybrid',
            tags: ['arch'],
        })) as { success: boolean }
        expect(blankHybrid.success).toBe(true)
        expect(searchCandidatesMock).not.toHaveBeenCalled()
        expect(ftsMock).toHaveBeenCalled()

        const semBlank = (await executeSemanticSearch(
            {
                db: {} as never,
                vectorManager: { search: vi.fn(), getStats: () => ({ itemCount: 0 }) } as never,
            },
            { query: '   ' }
        )) as { success: boolean; code?: string }
        expect(semBlank.success).toBe(false)
        expect(semBlank.code).toBe('VALIDATION_ERROR')

        const teamSemBlank = (await executeTeamSemanticSearch(
            {
                db: {} as never,
                teamDb: {} as never,
                teamVectorManager: { search: vi.fn(), getStats: () => ({ itemCount: 0 }) } as never,
            },
            { query: '   ', project_number: 5, workspace_id: 'ws' }
        )) as { success: boolean; code?: string }
        expect(teamSemBlank.success).toBe(false)
        expect(teamSemBlank.code).toBe('VALIDATION_ERROR')

        const searchTeamMock = vi.fn().mockReturnValue({ entries: [], nextCursor: undefined })
        const crossRes = await handleCrossTeamSearch(
            { query: 'auth', limit: 10, sort_by: 'timestamp', team_dbs: ['primary', 'primary'] },
            {
                db: {} as never,
                teamDb: { searchEntries: searchTeamMock, getAuthorsForEntries: () => new Map() } as never,
                config: { additionalTeamDbs: { primary: '/tmp/primary.db' } },
            }
        )
        expect(crossRes.searched_dbs).toEqual(['primary'])
        expect(searchTeamMock).toHaveBeenCalledTimes(1)
    })

    it('M4-M9 & L9: CLI --no-json precedence, blank/non-string auditLog & dbPath, logLevel/instructionLevel/maxToolInputElements, excludeTags, safeCoerce*, and autoContextFile', async () => {
        const dir = makeTempDir('mj-p83-cli-')
        const cfgFile = path.join(dir, 'config.json')
        fs.writeFileSync(cfgFile, JSON.stringify({ projectRegistry: { demo: { path: dir, project_number: 7 } } }), 'utf-8')
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgFile

        const stdoutChunks: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            stdoutChunks.push(String(chunk))
            return true
        })
        const rootProg = new Command().option('--json').option('--config <path>')
        const subProg = rootProg.command('list').option('--json').option('--no-json').option('--config <path>')
        rootProg.parse(['node', 'mj', '--json', 'list', '--no-json', '--config', cfgFile])
        await projectListAction(subProg.opts<Record<string, unknown>>(), subProg)
        const listOut = stdoutChunks.join('')
        expect(listOut).toContain('demo:')
        expect(listOut.trim().startsWith('{')).toBe(false)

        const badCfgPath = path.join(dir, 'bad-config.json')
        fs.writeFileSync(badCfgPath, JSON.stringify({ auditLog: 123, db: '' }), 'utf-8')
        const fakeCmd: CliCommandLike = { name: () => 'serve', getOptionValueSource: () => 'default' }
        const badResolver = new ConfigResolver(fakeCmd, {}, badCfgPath)
        const configErrors: string[] = []
        buildServerOptions(badResolver, {}, fakeCmd, configErrors)
        expect(configErrors.some((e) => e.includes('audit-log') || e.includes('auditLog'))).toBe(true)
        expect(configErrors.some((e) => e.includes('database path') || e.includes('db'))).toBe(true)

        const wsEnvCfg = path.join(dir, 'ws-env.json')
        const customDb = path.join(dir, 'custom.db')
        fs.writeFileSync(wsEnvCfg, JSON.stringify({ dbPath: customDb }), 'utf-8')
        process.env['DB_PATH'] = '   '
        const wsResolver = new ConfigResolver(fakeCmd, {}, wsEnvCfg)
        const wsErrs: string[] = []
        const resolvedPaths = resolveDatabasePaths(wsResolver, (fn, fb) => {
            try {
                return fn()
            } catch (e) {
                wsErrs.push(e instanceof Error ? e.message : String(e))
                return fb
            }
        })
        expect(wsErrs).toEqual([])
        expect(resolvedPaths.db).toBe(customDb)

        expect(() => parseLogLevelOption('')).toThrow(/blank log level/i)
        expect(parseLogLevelOption(' info ')).toBe('info')
        const blankLvlErrs: string[] = []
        const blankLvlResolver = new ConfigResolver(
            { name: () => 'serve', getOptionValueSource: () => 'cli' },
            { instructionLevel: '', maxToolInputElements: '' },
            undefined
        )
        const catchIntoErrs = <T>(fn: () => T, fb: T): T => {
            try {
                return fn()
            } catch (e) {
                blankLvlErrs.push(e instanceof Error ? e.message : String(e))
                return fb
            }
        }
        resolveInstructionLevelOption(blankLvlResolver, catchIntoErrs)
        resolveMaxToolInputElementsOption(blankLvlResolver, catchIntoErrs)
        expect(blankLvlErrs.length).toBe(2)

        const pruneDbPath = path.join(dir, 'prune.db')
        const pruneDb = new DatabaseAdapter(pruneDbPath)
        await pruneDb.initialize()
        pruneDb.createEntry({
            entryType: 'technical_note',
            content: 'pruneable note',
            tags: ['architecture'],
            timestamp: '2020-01-01T00:00:00Z',
        })
        pruneDb.close()
        process.env['PRUNE_EXCLUDE_TAGS'] = 'architecture'
        const pruneCmd = new Command()
        stdoutChunks.length = 0
        await pruneAction(
            {
                db: pruneDbPath,
                excludeTags: '',
                dryRun: true,
                pruneOlderThanDays: 1,
                importanceThreshold: 1,
                json: true,
            },
            pruneCmd
        )
        const prunePayload = JSON.parse(stdoutChunks.join('')) as { prunedCount?: number; deletedCount?: number }
        expect((prunePayload.prunedCount ?? prunePayload.deletedCount ?? 0) >= 1).toBe(true)

        expect(safeCoerceNumber.safeParse('').success).toBe(false)
        expect(safeCoercePositiveInt.safeParse('').success).toBe(false)
        expect(safeCoerceDefaultProject.safeParse('').success).toBe(false)
        expect(() => resolveAutoContext(undefined, '', {})).toThrow(/--auto-context-file/i)
    })

    it('L1-L4, L6-L8, L10-L11 & AP: SQL LIMIT;, max_bytes, auto-route aliases, negative project strings, tie-breakers, vector limit guards, scripts & Pass 83 prompt revision', async () => {
        expect(hasUnsupportedSqlTrailingClause('SELECT * FROM memory_journal LIMIT 5;', 'select')).toBe(false)

        const uc = buildSandboxUserContext({ max_bytes: 2048 } as never, {} as never, undefined, undefined, undefined)
        expect(uc.requestedMaxResultSize).toBe(2048)

        const teamGetEntryById = vi.fn().mockResolvedValue({ success: true, entry: { id: 99 } })
        const coreGetEntryById = vi.fn().mockResolvedValue({
            success: false,
            code: 'RESOURCE_NOT_FOUND',
            suggestion: 'Try team_get_entry_by_id for entry_id 99',
        })
        const coreGroup: Record<string, unknown> = { getEntryById: coreGetEntryById }
        wireProjectAndTeamAliasesHelper({
            core: coreGroup,
            search: {},
            admin: {},
            relationships: {},
            team: { teamGetEntryById },
            hasDispatcher: false,
            registryProvider: undefined,
            copyFnSchema: () => undefined,
        })
        const getEntryFn = coreGroup['getEntryById'] as (...args: unknown[]) => Promise<unknown>
        await getEntryFn(99, { workspace_id: '', workspace: 'adamic', project_number: '', projectNumber: 16 })
        expect(teamGetEntryById).toHaveBeenCalledWith(
            expect.objectContaining({ entry_id: 99, workspace_id: 'adamic', project_number: 16 })
        )

        expect(isProjectStringValue('-5')).toBe(false)
        expect(isProjectStringValue('1.5')).toBe(false)

        const conn = new NativeConnectionManager(':memory:')
        await conn.initialize()
        try {
            conn.applyTeamSchema()
            const dbNative = conn.getNativeDb()
            dbNative.prepare(`INSERT INTO memory_journal (content, entry_type, author, workspace_id, project_number, timestamp) VALUES ('a', 'technical_note', 'zoe', 'ws', 20, '2020-01-01T00:00:00Z')`).run()
            dbNative.prepare(`INSERT INTO memory_journal (content, entry_type, author, workspace_id, project_number, timestamp) VALUES ('b', 'technical_note', 'ada', 'ws', 10, '2020-01-02T00:00:00Z')`).run()
            expect(getAuthorStatistics(conn, 'ws').map((r) => r.author)).toEqual(['ada', 'zoe'])
            const cpi = getCrossProjectInsights(conn, { workspaceId: 'ws', minEntries: 1, inactiveThresholdDays: 1 })
            expect(cpi.projects.map((p) => p['project_number'])).toEqual([10, 20])
            expect(cpi.inactiveProjects.map((p) => p.project_number)).toEqual([10, 20])

            const stats = getStatistics({ db: dbNative } as never, 'week', undefined, undefined, true, 'ws') as {
                projectBreakdown: { project_number: number }[]
            }
            expect(stats.projectBreakdown.map((p) => p.project_number)).toEqual([10, 20])

            const digest = computeDigest(dbNative, 'ws')
            expect(digest.staleProjects.map((p) => p.projectNumber)).toEqual([20, 10])

            const vecOps = new VectorOperations(conn)
            expect(vecOps.searchVectors(new Float32Array([0.1, 0.2]), -1)).toEqual([])
            const initSpy = vi.fn().mockResolvedValue(undefined)
            const vm = Object.create(VectorSearchManager.prototype) as VectorSearchManager & { initialize: typeof initSpy }
            vm.initialize = initSpy
            expect(await vm.searchCandidates('q', 0)).toEqual([])
            expect(await vm.search('q', -1)).toEqual([])
            expect(initSpy).not.toHaveBeenCalled()
        } finally {
            conn.close()
        }

        const syncSrc = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'sync-vendor.ts'), 'utf-8')
        expect(syncSrc).toContain('Invalid blank --upstream-root path.')
        const printSummarySrc = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'print-summary.ts'), 'utf-8')
        expect(printSummarySrc.indexOf('try {')).toBeLessThan(printSummarySrc.indexOf('await db.initialize()'))

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
        expect(CODE_QUALITY_PROMPT_REVISION).toBe('2026-11-24-audit-pass93')
        const cqDef = getCodeQualityAuditPromptDefinition()
        const cqRes = await cqDef.handler(
            { target: 'src', copilot: 'false' },
            { searchByDateRange: () => [] } as unknown as Parameters<typeof cqDef.handler>[1]
        )
        const cqText = (cqRes as { messages?: { content?: { text?: string } }[] }).messages?.[0]?.content?.text ?? ''
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass93')
        expect(cqText).toContain('recoverNamedToolCall')
        expect(cqText).toContain('isJsonOutput')
    })
})
