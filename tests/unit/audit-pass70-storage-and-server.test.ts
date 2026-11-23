import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { getAnalyticsTools } from '../../src/handlers/tools/analytics.js'
import { extractAndRecoverSqlCode } from '../../src/handlers/tools/codemode/sql-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { normalizeDispatchParams } from '../../src/handlers/tools/codemode/dispatch-scope.js'
import { readNestedQuerySearch } from '../../src/codemode/worker/nested-exec-payload.js'
import { passMetadataFilters } from '../../src/handlers/tools/search/team-search-helpers.js'
import { visualizeAction } from '../../src/cli/commands/visualize.js'
import { listBoundedDirectoryEntries } from '../../src/handlers/tools/core/dummy-healing/fs-view-helpers.js'
import { readBriefingConfigEntry as readFromBaselines } from '../../src/utils/config-manager-baselines.js'
import { readBriefingConfigEntry as readFromHelpers } from '../../src/utils/config-manager-helpers.js'
import * as auditQueryHelpers from '../../src/audit/audit-query-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { JournalEntry, ServerOptions, ToolContext, ToolDefinition } from '../../src/types/index.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY', 'DB_PATH', 'TEAM_DB_PATH'] as const

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    'org/my-repo': { path: process.cwd(), project_number: 5 },
    'other/my-repo': { path: process.cwd(), project_number: 19 },
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`Expected tool '${name}'`)
    return found
}

describe('Pass 70 Audit — Schemas, Recovery, Scope Dispatch, CLI Visualize, Cycles & Prompt', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
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
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined && fs.existsSync(d)) {
                fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
            }
        }
    })

    it('P70-M4: GetStatisticsSchemaMcp promotes timeframe when SDK parses before handler under agentHealing=false', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            db.createEntry({ content: 'Stat row', entryType: 'technical_note' })
            const ctx: ToolContext = { db, config: {} as ServerOptions }
            const statsTool = requireTool(getAnalyticsTools(ctx), 'get_statistics')
            const sdkSchema = (statsTool.inputSchema as z.ZodObject<z.ZodRawShape>).partial().loose()

            const parsedBySdk = sdkSchema.parse({ timeframe: 'month' })
            const res = (await statsTool.handler(parsedBySdk)) as {
                groupBy?: string
                totalEntries?: number
            }
            expect(res.groupBy).toBe('month')
            expect(res.totalEntries).toBe(1)

            const defaultParsed = sdkSchema.parse({})
            const defaultRes = (await statsTool.handler(defaultParsed)) as { groupBy?: string }
            expect(defaultRes.groupBy).toBe('week')
        } finally {
            db.close()
        }
    })

    it('P70-M1 & M2: extractAndRecoverSqlCode rejects invalid WHERE literals and .strict() empty-schema columns', () => {
        expect(extractAndRecoverSqlCode('SELECT * FROM relationships WHERE id = 0')).toBeNull()
        expect(extractAndRecoverSqlCode("SELECT * FROM tags WHERE workspace_id = ''")).toBeNull()
        expect(extractAndRecoverSqlCode('SELECT * FROM tags WHERE project_number = 0')).toBeNull()
        expect(extractAndRecoverSqlCode("SELECT * FROM projects WHERE workspace_id = 'alpha'")).toBeNull()
        expect(extractAndRecoverSqlCode('SELECT * FROM team_members WHERE project_number = 5')).toBeNull()

        expect(extractAndRecoverSqlCode('SELECT * FROM projects')).toBe('return await mj.admin.listProjects({});')
        expect(extractAndRecoverSqlCode("SELECT * FROM author_aliases WHERE workspace_id = 'alpha'")).toBe(
            'return await mj.team.teamListAuthorAliases({"workspace_id":"alpha"});'
        )
    })

    it('P70-M3: recoverFromContextField enforces compatible scope inheritance and updateEntry routing', () => {
        const emptyCtx = { db: {} as ToolContext['db'], config: {} as ServerOptions }
        const isolated = resolveExecutionPayload(
            {
                workspace_id: 'other',
                project_number: 99,
                context: { workspace_id: 'default', content: 'Context body' },
            },
            emptyCtx,
            true,
            Date.now()
        )
        expect('executionCode' in isolated).toBe(true)
        if ('executionCode' in isolated) {
            expect(isolated.executionCode).toContain('mj.createEntry(')
            expect(isolated.executionCode).toContain('"workspace_id":"default"')
            expect(isolated.executionCode).not.toContain('"project_number":99')
        }

        const updated = resolveExecutionPayload(
            {
                context: {
                    entry_id: 42,
                    content: 'Patched body',
                    tags: ['tag-a'],
                    target_workspace_id: 'dest-ws',
                    type: 'bugfix',
                },
            },
            emptyCtx,
            true,
            Date.now()
        )
        expect('executionCode' in updated).toBe(true)
        if ('executionCode' in updated) {
            expect(updated.executionCode).toContain('mj.updateEntry(')
            expect(updated.executionCode).toContain('"entry_id":42')
            expect(updated.executionCode).toContain('"entry_type":"bugfix"')
            expect(updated.executionCode).toContain('"target_workspace_id":"dest-ws"')
            expect(updated.executionCode).toContain('"tags":["tag-a"]')
            expect(updated.executionCode).not.toContain('Journal Entry')
        }
    })

    it('P70-L1 & L2: dispatch-scope handles owner/repo callerRepoHint and readNestedQuerySearch preserves limit', async () => {
        const sessionContext: ToolContext = {
            db: {} as ToolContext['db'],
            config: { projectRegistry: TEST_REGISTRY } as ServerOptions,
        }
        const dummyTool: ToolDefinition = {
            name: 'search_entries',
            title: 'Search Entries',
            description: 'Search',
            group: 'search',
            inputSchema: z.object({
                query: z.string(),
                workspace_id: z.string().optional(),
                project_number: z.number().optional(),
            }),
            handler: async () => ({}),
        }

        const sameRepo = await normalizeDispatchParams(
            dummyTool,
            { query: 'x', repo: 'org/my-repo' },
            { sessionContext, projectId: 5, workspaceId: 'org/my-repo', explicitWorkspace: true }
        )
        expect(sameRepo.params?.['workspace_id']).toBe('org/my-repo')
        expect(sameRepo.params?.['project_number']).toBe(5)

        const foreignRepo = await normalizeDispatchParams(
            dummyTool,
            { query: 'x', repo: 'other/my-repo' },
            { sessionContext, projectId: 5, workspaceId: 'org/my-repo', explicitWorkspace: true }
        )
        expect(foreignRepo.params?.['project_number']).toBe(19)
        expect(foreignRepo.params?.['workspace_id']).toBeUndefined()

        expect(readNestedQuerySearch({ query: 'term', limit: -5 })?.limit).toBe(-5)
        expect(readNestedQuerySearch({ query: 'term', limit: 'abc' })?.limit).toBe('abc')
    })

    it('P70-L3..L8: visualize escapes Mermaid fences/CRLF, filters default workspace, closes opendir, breaks cycles & bumps prompt', async () => {
        const tmpDir = makeTempDir('mj-p70-vis-')
        const dbPath = path.join(tmpDir, 'vis.db')
        process.env['DB_PATH'] = dbPath
        const db = new DatabaseAdapter(dbPath)
        await db.initialize()
        try {
            const e1 = db.createEntry({ content: 'Line1\r\n```js\r\n[demo] "q"', entryType: 'technical_note' })
            const e2 = db.createEntry({ content: 'Target', entryType: 'technical_note' })
            db.linkEntries(e1.id, e2.id, 'references')
        } finally {
            db.close()
        }

        const chunks: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
            chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString())
            return true
        })
        const cmd = new Command('vis')
        vi.spyOn(cmd, 'getOptionValueSource').mockReturnValue('cli')
        await visualizeAction({ db: dbPath }, cmd)
        const out = chunks.join('')
        const fenceCount = (out.match(/```/g) ?? []).length
        expect(fenceCount).toBe(2)
        expect(out).not.toContain('\r')
        expect(out).toContain('(demo)')

        const minimalEntry = {
            id: 1,
            timestamp: '2026-11-22T00:00:00Z',
            entryType: 'technical_note',
            content: 'x',
            isPersonal: true,
            tags: [],
        } as unknown as JournalEntry
        expect(passMetadataFilters(minimalEntry, { workspaceId: 'default' }, {} as ToolContext['db'])).toBe(true)
        expect(passMetadataFilters(minimalEntry, { workspaceId: 'other' }, {} as ToolContext['db'])).toBe(false)

        const closeMock = vi.fn().mockResolvedValue(undefined)
        vi.spyOn(fs.promises, 'opendir').mockResolvedValue({
            close: closeMock,
            [Symbol.asyncIterator]: async function* () {
                await Promise.resolve()
                yield* []
                throw new Error('STOP_EARLY')
            },
        } as unknown as fs.Dir)
        await expect(listBoundedDirectoryEntries(tmpDir)).rejects.toThrow('STOP_EARLY')
        expect(closeMock).toHaveBeenCalledTimes(1)

        expect(readFromBaselines).toBe(readFromHelpers)
        expect('searchAuditFileBackward' in auditQueryHelpers).toBe(false)

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-23-audit-pass77')
        const promptDb = new DatabaseAdapter(':memory:')
        await promptDb.initialize()
        let cqText: string
        try {
            const res = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                promptDb
            )
            cqText = res.messages[0]?.content.text ?? ''
        } finally {
            promptDb.close()
        }
        expect(cqText).toContain('Prompt revision: 2026-11-23-audit-pass77')
        expect(cqText).toContain('omitting `.default(...)` on canonical keys')
        expect(cqText).toContain('SQL recovery column allowlists')
    })
})
