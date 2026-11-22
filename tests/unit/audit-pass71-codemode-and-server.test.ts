import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { z } from 'zod'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { resolveEffectiveProjectRegistry } from '../../src/codemode/normalizers/project-alias-helpers.js'
import { parseSqlStatement } from '../../src/codemode/sql-positional-binder.js'
import { validateNestedExecScope } from '../../src/codemode/worker/nested-exec-validation.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { createSecureDispatcher } from '../../src/handlers/tools/codemode/secure-dispatcher.js'
import { resolveCodeModeSessionContext } from '../../src/handlers/tools/codemode/session-context.js'
import { wrapToolHandlerWithInterceptors } from '../../src/handlers/tools/arg-interceptions.js'
import { resolveGitWorkingDir } from '../../src/handlers/tools/git-workdir.js'
import { passMetadataFilters } from '../../src/handlers/tools/search/team-search-helpers.js'
import { getTeamBackupTools } from '../../src/handlers/tools/team/backup-tools.js'
import { resolveToolCallAuditScope } from '../../src/audit/audit-file-helpers.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { searchAction } from '../../src/cli/commands/search.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { mcpLogger } from '../../src/utils/mcp-logger.js'
import { coerceNumber, coerceLimit } from '../../src/utils/query-helpers.js'
import {
    clearActiveSessionProject,
    setActiveSessionProject,
} from '../../src/utils/workspace-resolver.js'
import { writeTempAndRenameConfig } from '../../src/utils/config-manager-persist.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { JournalEntry, ToolContext, ToolDefinition } from '../../src/types/index.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY', 'TEAM_AUTHOR', 'USERNAME', 'USER', 'DB_PATH'] as const

describe('Pass 71 Audit — Code Mode Normalization, Authz Sequencing, Registry Isolation & Prompt', () => {
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
        clearActiveSessionProject()
        vi.restoreAllMocks()
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('H1: preserves entryId and maps keep -> is_archived on update_entry while protecting explicit id on single-ID tools', () => {
        const upd = applyArgInterceptions('update_entry', [{ entryId: 42, content: 'updated', keep: 1 }])
        expect('error' in upd).toBe(false)
        if ('args' in upd) {
            const rec = upd.args[0] as Record<string, unknown>
            expect(rec['entryId']).toBe(42)
            expect(rec['entry_id']).toBeUndefined()
            expect(rec['is_archived']).toBe(false)
        }

        const missing = applyArgInterceptions('update_entry', [{ keep: 1, content: 'no id' }])
        expect('error' in missing).toBe(true)

        const del = applyArgInterceptions('delete_entry', [{ entryId: 42, keep: 1 }])
        expect('error' in del).toBe(false)
        if ('args' in del) {
            const rec = del.args[0] as Record<string, unknown>
            expect(rec['entryId']).toBe(42)
            expect(rec['entry_id']).toBeUndefined()
        }
    })

    it('H2: never promotes target_workspace_id/scope keys or single-token metadata into executable write code', () => {
        const intercepted = applyArgInterceptions('mj_execute_code', [
            { workspace_id: 'alpha', target_workspace_id: 'docs', owner: 'fix' },
        ])
        expect('args' in intercepted).toBe(true)
        if ('args' in intercepted) {
            const rec = intercepted.args[0] as Record<string, unknown>
            expect(rec['code']).toBeUndefined()
        }

        const synth = resolveExecutionPayload(
            { workspace_id: 'alpha' } as never,
            { workspace_id: 'alpha', target_workspace_id: 'docs', branch: 'test', tagToken: 'update' },
            true,
            0
        )
        expect('earlyReturn' in synth).toBe(true)
        if ('earlyReturn' in synth) {
            expect(synth.earlyReturn['success']).toBe(true)
            expect(JSON.stringify(synth.earlyReturn)).not.toContain('createEntry')
        }
    })

    it('H3 & C-M1: routes camelCase entryId to updateEntry across context/JSON/broken-JS and inherits outer tags', () => {
        const ctxPayload = resolveExecutionPayload(
            { context: { entryId: 42, content: 'updated body' } } as never,
            { context: { entryId: 42, content: 'updated body' } },
            true,
            0
        )
        expect('executionCode' in ctxPayload && ctxPayload.executionCode).toContain('mj.updateEntry(')
        expect('executionCode' in ctxPayload && ctxPayload.executionCode).toContain('"entry_id":42')

        const jsonPayload = resolveExecutionPayload(
            { code: '{"entryId": 42, "content": "json update"}' } as never,
            {},
            true,
            0
        )
        expect('executionCode' in jsonPayload && jsonPayload.executionCode).toMatch(
            /mj(?:\.admin)?\.updateEntry\(/
        )

        const brokenRecovered = extractAndRecoverEntryCode(
            "mj.updateMemory({ entryId: 42, content: 'broken json recovery' }"
        )
        expect(brokenRecovered).toContain('mj.updateEntry(')
        expect(brokenRecovered).not.toContain('mj.createEntry(')

        const tagMerged = resolveExecutionPayload(
            {} as never,
            { entry: { type: 'technical_note' }, entry_id: 42, tags: ['security'] },
            true,
            0
        )
        expect('executionCode' in tagMerged && tagMerged.executionCode).toContain('"tags":["security"]')
    })

    it('H4: enforces team access boundary before autoVersion DB reads and dry_run early returns', async () => {
        delete process.env['TEAM_AUTHOR']
        delete process.env['USERNAME']
        delete process.env['USER']
        const tmpDir = makeTempDir('mj-p71-h4-')
        const db = new DatabaseAdapter(path.join(tmpDir, 'personal.db'))
        const teamDb = new DatabaseAdapter(path.join(tmpDir, 'team.db'))
        await db.initialize()
        await teamDb.initialize()
        try {
            const getEntrySpy = vi.spyOn(teamDb, 'getEntryById')
            const teamUpdateTool: ToolDefinition = {
                name: 'team_update_entry',
                title: 'Update Team Entry',
                description: 'Update team entry',
                group: 'team',
                inputSchema: z.object({ entry_id: z.number(), content: z.string().optional() }).loose(),
                handler: () => ({ success: true }),
            }
            const dispatcher = createSecureDispatcher({
                tools: [teamUpdateTool],
                sessionContext: { db, teamDb, config: {} } as ToolContext,
                projectId: 5,
                workspaceId: 'memory-journal-mcp',
                autoVersion: true,
                dryRun: true,
            })

            await expect(dispatcher('team_update_entry', { entry_id: 1, content: 'probe' })).rejects.toThrow(
                /TEAM_AUTHOR|Authentication/i
            )
            expect(getEntrySpy).not.toHaveBeenCalled()
        } finally {
            db.close()
            teamDb.close()
        }
    })

    it('A-M1 & A-M2: canonical coerceNumber/coerceLimit parsing and case-insensitive memory:// audit scope', () => {
        expect(coerceNumber('0x10')).toBeUndefined()
        expect(coerceNumber('1e2')).toBeUndefined()
        expect(coerceNumber('007')).toBeUndefined()
        expect(coerceNumber('9007199254740993')).toBeUndefined()
        expect(coerceNumber('-0')).toBe(0)
        expect(coerceLimit('00', 25)).toBe(25)
        expect(coerceLimit('0.5', 25)).toBe(25)
        expect(coerceLimit(false, 25)).toBe(25)
        expect(coerceLimit([], 25)).toBe(25)
        expect(coerceLimit(0, 25)).toBeNull()
        expect(coerceLimit('0', 25)).toBeNull()

        const upperScope = resolveToolCallAuditScope(
            'read_resource',
            { uri: 'MEMORY://BRIEFING/my-repo?project_number=16' },
            true,
            undefined,
            undefined
        )
        expect(upperScope).toEqual({ workspaceId: 'my-repo', projectNumber: 16 })

        const schemelessScope = resolveToolCallAuditScope(
            'read_resource',
            { uri: 'briefing/my-repo?project_number=16' },
            true,
            undefined,
            undefined
        )
        expect(schemelessScope).toEqual({ workspaceId: 'my-repo', projectNumber: 16 })
    })

    it('C-M2, C-M3 & C-L1..C-L3: rejects WHERE NULL, preserves session projectNumber on default, flattens filter & unescapes \\\\', async () => {
        const nullWhereUpd = parseSqlStatement(
            'UPDATE journal_entries SET content = ? WHERE id = ? AND project_number = ?',
            ['x', 42, null]
        )
        expect(nullWhereUpd.action).toBe('unmapped')

        const nullWhereSel = parseSqlStatement('SELECT * FROM journal_entries WHERE id = ? AND project_number = ?', [
            42,
            null,
        ])
        expect(nullWhereSel.action).toBe('unmapped')

        const tmpDir = makeTempDir('mj-p71-ctx-')
        const db = new DatabaseAdapter(path.join(tmpDir, 'personal.db'))
        await db.initialize()
        const sessionRuntime = {}
        try {
            setActiveSessionProject('unregistered-ws', 7, sessionRuntime)
            const resCtx = await resolveCodeModeSessionContext(
                {
                    db,
                    config: {
                        defaultWorkspaceId: 'default',
                        projectRegistry: {},
                        runtime: sessionRuntime as never,
                    },
                } as ToolContext,
                {} as never
            )
            expect('projectId' in resCtx && resCtx.projectId).toBe(7)
            expect('workspaceId' in resCtx && resCtx.workspaceId).toBe('unregistered-ws')
        } finally {
            clearActiveSessionProject(sessionRuntime)
            db.close()
        }

        const converted = convertKeysToSnakeCase({ filter: { workspaceId: 'beta', workspace_id: 'alpha' } })
        expect(converted['workspace_id']).toBe('alpha')
        const definedOverUndef = convertKeysToSnakeCase({ filter: { workspace_id: undefined, workspaceId: 'alpha' } })
        expect(definedOverUndef['workspace_id']).toBe('alpha')

        expect(healCodeModeScript("mj.executeCode(\"return 'a\\\\\\\\b'\")").trim()).toBe("return 'a\\\\b'")

        const nestedDefaultErr = validateNestedExecScope(
            { workspace_id: 'default' },
            undefined,
            5,
            { alpha: { path: process.cwd(), project_number: 5 } }
        )
        expect(nestedDefaultErr?.error).toMatch(/conflicts/i)
    })

    it('D-M1, D-M2 & D-M3: checks unnumbered git owner conflicts, isolates async registries, and parses space timestamps', async () => {
        const tmpDir = makeTempDir('mj-p71-dm-')
        const unnumberedDir = path.join(tmpDir, 'unnumbered')
        const otherDir = path.join(tmpDir, 'other')
        fs.mkdirSync(unnumberedDir, { recursive: true })
        fs.mkdirSync(otherDir, { recursive: true })
        const reg = {
            unnumbered: { path: unnumberedDir },
            other: { path: otherDir, project_number: 9 },
        }
        expect(() => resolveGitWorkingDir({ cwd: unnumberedDir, project_number: 9 }, { projectRegistry: reg })).toThrow(
            /belongs to workspace 'other'/
        )

        const seenA: unknown[] = []
        const seenB: unknown[] = []
        const regA = { repoA: { path: unnumberedDir, project_number: 1 } }
        const regB = { repoB: { path: otherDir, project_number: 2 } }
        const hA = wrapToolHandlerWithInterceptors(
            'test_a',
            async () => {
                await new Promise((r) => setTimeout(r, 15))
                seenA.push(resolveEffectiveProjectRegistry())
                return { success: true }
            },
            { projectRegistry: regA }
        )
        const hB = wrapToolHandlerWithInterceptors(
            'test_b',
            async () => {
                await new Promise((r) => setTimeout(r, 5))
                seenB.push(resolveEffectiveProjectRegistry())
                return { success: true }
            },
            { projectRegistry: regB }
        )
        await Promise.all([hA({}), hB({})])
        expect(seenA[0]).toEqual(regA)
        expect(seenB[0]).toEqual(regB)

        const entry = {
            id: 1,
            timestamp: '2026-05-01 12:00:00',
            entryType: 'technical_note',
            content: 'sqlite default timestamp',
            isPersonal: true,
        } as JournalEntry
        expect(passMetadataFilters(entry, { endDate: '2026-05-01' }, {} as never)).toBe(true)
        expect(passMetadataFilters(entry, { endDate: '2026-04-30' }, {} as never)).toBe(false)
    })

    it('A-L1..A-L3, B-L1, D-L1..D-L2 & prompt: roots mcpLogger cycle, expires preload JWKS, parses SQL quotes, handles dumpConfig/scopeNote & pass71', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const cyclic: { message: string; self?: unknown } = { message: 'loop' }
        cyclic.self = cyclic
        mcpLogger.log('error', 'pass71-cycle', cyclic)
        const logged = String(errSpy.mock.calls.at(-1)?.[0] ?? '')
        expect(logged).toContain('"self":"[Circular]"')

        const missingDirCfg = path.join(makeTempDir('mj-p71-persist-'), 'missing-subdir', 'config.json')
        expect(() => writeTempAndRenameConfig(missingDirCfg, '{}')).toThrow()

        let jwksHits = 0
        const server = http.createServer((_req, res) => {
            jwksHits++
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ keys: [] }))
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
        try {
            const addr = server.address()
            if (addr === null || typeof addr === 'string') throw new Error('Expected TCP address')
            let nowMs = 1_000_000
            vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
            const validator = new TokenValidator({
                issuer: `http://127.0.0.1:${String(addr.port)}`,
                jwksUri: `http://127.0.0.1:${String(addr.port)}/jwks.json`,
                audience: 'test',
                jwksCacheTtl: 10,
            })
            await validator.preload()
            expect(jwksHits).toBe(1)
            nowMs += 20_000
            await validator.validate('eyJhbGciOiJSUzI1NiIsImtpZCI6InQxIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig')
            expect(jwksHits).toBeGreaterThanOrEqual(2)
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()))
        }

        const conn = new NativeConnectionManager(':memory:')
        await conn.initialize()
        try {
            const ok = conn.exec('SELECT \'d\' AS "a;b\'c"')
            expect(ok.length).toBeGreaterThanOrEqual(0)
            expect(() => conn.exec('SELECT "a\'b"; DROP TABLE entries; SELECT "c\'d"')).toThrow(
                /Multi-statement queries via exec\(\) are strictly forbidden/
            )
        } finally {
            conn.close()
        }

        const stdoutChunks: string[] = []
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
            stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
            return true
        })
        vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('DUMP_EXIT')
        }) as never)
        const dummyCmd = new Command('search')
        await expect(searchAction(undefined, { dumpConfig: true } as never, dummyCmd)).rejects.toThrow('DUMP_EXIT')
        expect(stdoutChunks.join('')).toContain('"dbPath"')

        const backupDir = makeTempDir('mj-p71-team-bak-')
        const fakeTeamDb = {
            listBackups: () => [],
            getBackupsDir: () => backupDir,
        }
        const listBackupsTool = getTeamBackupTools({ teamDb: fakeTeamDb as never } as ToolContext).find(
            (t) => t.name === 'team_list_backups'
        )
        const res = (await listBackupsTool?.handler({ project_number: 5 })) as { scopeNote?: string }
        expect(res.scopeNote).toBe('Database-wide team backups')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass75')
        const def = getCodeQualityAuditPromptDefinition()
        const promptDb = new DatabaseAdapter(':memory:')
        await promptDb.initialize()
        let text: string
        try {
            const rendered = await def.handler({ target: 'memory-journal-mcp', copilot: 'false' }, promptDb)
            text = rendered.messages[0]?.content.text ?? ''
        } finally {
            promptDb.close()
        }
        expect(text).toContain('Prompt revision: 2026-11-22-audit-pass75')
        expect(text).toContain('worker-safe reader callbacks')
    })
})
