import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Request, Response } from 'express'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { releaseRestoreLock } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { sanitizeErrorForLogging } from '../../src/utils/security-utils.js'
import { normalizeAndAliasToolCall } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { auditOperation } from '../../src/audit/interceptor.js'
import { extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import {
    setActiveSessionProject,
    getActiveSessionProject,
} from '../../src/utils/workspace-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { assertSafeChildFile, assertSafeFilePath } from '../../src/utils/path-safety.js'
import { validateImportedFileEntry } from '../../src/markdown/importer-scope.js'
import { readAndConvertExternalMarkdownFiles } from '../../src/handlers/tools/team/io-scope-helpers.js'
import { coerceIntString, coerceFiniteNumberString } from '../../src/handlers/tools/schemas.js'
import { updateConfigurationSchema } from '../../src/handlers/tools/admin/update_configuration.js'
import { SearchEntriesSchema } from '../../src/handlers/tools/search/schemas.js'
import { GetRecentEntriesSchema } from '../../src/handlers/tools/core/schemas.js'
import {
    TeamGetStatisticsSchema,
    TeamSemanticSearchSchema,
} from '../../src/handlers/tools/team/schemas/analytics-vector-schemas.js'
import { getTeamVectorTools } from '../../src/handlers/tools/team/vector-tools.js'
import { resolveGitWorkingDir } from '../../src/handlers/tools/git-workdir.js'
import {
    writeProjectRegistryFile,
    readProjectRegistryFile,
    readCachedConfigObject,
} from '../../src/utils/registry-config-file.js'
import { parseZodErrorsFromMessage } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { getUnreleasedChangelog } from '../../src/handlers/tools/git-commit-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ServerOptions, ToolContext, ToolDefinition } from '../../src/types/index.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY'] as const

const TEST_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: process.cwd(), project_number: 16 },
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
    const found = tools.find((t) => t.name === name)
    if (found === undefined) throw new Error(`Expected tool '${name}'`)
    return found
}

describe('Pass 68 Audit — Storage, Locks, Schemas, Transport, Workdir & Prompt', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string, local = false): string {
        const base = local ? path.join(process.cwd(), '.test-output', 'vitest') : os.tmpdir()
        fs.mkdirSync(base, { recursive: true })
        const dir = fs.mkdtempSync(path.join(base, prefix))
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

    it('TB-M1 & TB-M2: scrubs scheme auth headers ahead of flags and ignores prototype registry keys', () => {
        const scrubbed = sanitizeErrorForLogging(
            'Request failed Authorization: Bearer ghp_secretTokenValue123456 --secret=myCliSecret'
        )
        expect(scrubbed).not.toContain('ghp_secretTokenValue123456')
        expect(scrubbed).not.toContain('myCliSecret')

        const reqParams: { name?: string; arguments?: Record<string, unknown> } = {
            name: 'get_recent_entries',
            arguments: { workspace_id: 'toString' },
        }
        normalizeAndAliasToolCall(reqParams, {
            projectRegistry: TEST_REGISTRY,
        } as unknown as ServerOptions)
        expect(reqParams.arguments?.['project_number']).toBeUndefined()
    })

    it('TB-M3, TB-M4, TB-M5 & TB-M6: skips prompt URI extraction, clears stale session proj, closes SSE safely & rejects blank paths', async () => {
        const logDir = makeTempDir('mj-p68-audit-')
        const logPath = path.join(logDir, 'audit.jsonl')
        const auditLogger = new AuditLogger({
            enabled: true,
            logPath,
            redact: false,
            auditReads: true,
            maxSizeBytes: 1_000_000,
        })
        try {
            await auditOperation(auditLogger, 'prompt', 'custom-prompt', () => Promise.resolve('ok'), {
                resourceUri: 'memory://briefing/other-repo?project_number=99',
            })
            const rows = await auditLogger.recent(5)
            const promptRow = rows.find((r) => r.tool === 'prompt:custom-prompt')
            expect(promptRow).toBeDefined()
            expect(promptRow?.workspaceId).toBeUndefined()
        } finally {
            await auditLogger.close()
        }

        const runtime = new ServerRuntime()
        setActiveSessionProject(undefined, 5, runtime)
        setActiveSessionProject('  companion  ', undefined, runtime)
        const sessionState = getActiveSessionProject(runtime)
        expect(sessionState.workspaceId).toBe('companion')
        expect(sessionState.projectNumber).toBeUndefined()

        const transport = new LegacySSEServerTransport('/messages', 'sess-p68')
        const onClose = vi.fn()
        transport.onclose = onClose
        const fakeReq = { destroyed: false, on: vi.fn(), off: vi.fn() } as unknown as Request
        const fakeRes = {
            writableEnded: false,
            destroyed: false,
            setTimeout: vi.fn(),
            writeHead: vi.fn(),
            write: vi.fn(),
            end: () => {
                throw new Error('socket write failure')
            },
        } as unknown as Response
        transport.handleSseRequest(fakeReq, fakeRes)
        expect(() => transport.close()).toThrow('socket write failure')
        expect(onClose).toHaveBeenCalledTimes(1)

        expect(() => assertSafeChildFile(logDir, '')).toThrow()
        expect(() => assertSafeFilePath('   ', [logDir])).toThrow()
    })

    it('TB-M7, TB-M8 & TB-M9: normalizes lock dir keys, fails closed on foreign/missing lock & validates strict timestamp separators', async () => {
        const dir = makeTempDir('mj-p68-lock-')
        const lockDir = path.join(dir, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        const lockDirWithSep = `${lockDir}${path.sep}`

        const acquired = acquireRestoreLock(lockDirWithSep, lockFile)
        expect(acquired.stale).not.toBe(true)
        releaseRestoreLock(lockDir, lockFile, 'wrong-nonce')
        expect(fs.existsSync(lockDir)).toBe(true)

        releaseRestoreLock(lockDir, lockFile, acquired.token)
        expect(fs.existsSync(lockDir)).toBe(false)

        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(
            lockFile,
            JSON.stringify({ pid: process.pid + 999999, nonce: 'foreign', timestamp: Date.now() }),
            'utf-8'
        )
        releaseRestoreLock(lockDir, lockFile, 'foreign')
        expect(fs.existsSync(lockFile)).toBe(true)

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const importOpts = { workspaceId: 'companion', project_number: 16 }
            expect(() =>
                validateImportedFileEntry(
                    {
                        filename: 'ok-space.md',
                        body: 'ok',
                        metadata: { timestamp: '2026-11-21 12:30:00' },
                    },
                    db,
                    importOpts
                )
            ).not.toThrow()
            expect(() =>
                validateImportedFileEntry(
                    {
                        filename: 'ok-t.md',
                        body: 'ok',
                        metadata: { timestamp: '2026-11-21T12:30:00Z' },
                    },
                    db,
                    importOpts
                )
            ).not.toThrow()
            expect(() =>
                validateImportedFileEntry(
                    {
                        filename: 'bad-sep.md',
                        body: 'bad',
                        metadata: { timestamp: '2026-11-21X12:30:00' },
                    },
                    db,
                    importOpts
                )
            ).toThrow(/ISO 8601/)
            const created = db.createEntry({
                content: 'valid date format',
                workspaceId: 'companion',
                projectNumber: 16,
                timestamp: '2026-11-21',
            })
            expect(created.timestamp).toBe('2026-11-21T00:00:00.000Z')
            expect(() =>
                db.createEntry({
                    content: 'bad separator',
                    workspaceId: 'companion',
                    projectNumber: 16,
                    timestamp: '2026-11-21X12:00:00',
                })
            ).toThrow(/ISO 8601/)
        } finally {
            db.close()
        }
    })

    it('TB-M17: external directory import pins realpath, closes directory stream and skips symlinks', async () => {
        const importDir = makeTempDir('mj-p68-ext-', true)
        fs.writeFileSync(
            path.join(importDir, 'note.md'),
            '---\ntitle: Test\n---\nBody content\n',
            'utf-8'
        )
        try {
            fs.symlinkSync(
                path.join(importDir, 'note.md'),
                path.join(importDir, 'link.md')
            )
        } catch {
            // Symlink creation can require elevated privileges on some Windows hosts; test still verifies dir close & realpath pinning.
        }
        const res = await readAndConvertExternalMarkdownFiles(
            importDir,
            50,
            'obsidian',
            undefined,
            [importDir],
            undefined
        )
        expect(res.parsedFiles.length).toBe(1)
        expect(res.errors).toEqual([])
    })

    it('TB-M18, TB-M19 & TB-M20: canonical numeric coercion, team vector stats scope & unregistered git cwd rejection', () => {
        expect(coerceIntString('16')).toBe(16)
        expect(coerceIntString('0')).toBe(0)
        expect(coerceIntString('01')).toBe('01')
        expect(coerceIntString('-0')).toBe('-0')
        expect(coerceIntString('0x10')).toBe('0x10')

        expect(coerceFiniteNumberString('0.25')).toBe(0.25)
        expect(coerceFiniteNumberString('1e5')).toBe('1e5')
        expect(coerceFiniteNumberString('01.5')).toBe('01.5')
        expect(coerceFiniteNumberString('-0')).toBe('-0')

        expect(updateConfigurationSchema.parse({ briefing_entries: '7', project_number: '16' })).toMatchObject({
            briefing_entries: 7,
            project_number: 16,
        })
        expect(SearchEntriesSchema.parse({ limit: '15', fts_weight: '1.5' })).toMatchObject({
            limit: 15,
            fts_weight: 1.5,
        })
        expect(GetRecentEntriesSchema.parse({ offset: '0', limit: '12' })).toMatchObject({
            offset: 0,
            limit: 12,
        })
        expect(TeamGetStatisticsSchema.parse({ project_number: '5' }).project_number).toBe(5)
        expect(TeamSemanticSearchSchema.parse({ entry_id: '3', similarity_threshold: '0.4' })).toMatchObject({
            entry_id: 3,
            similarity_threshold: 0.4,
        })
        expect(() => SearchEntriesSchema.parse({ limit: '01' })).toThrow()

        const statsTool = requireTool(
            getTeamVectorTools({
                db: {} as ToolContext['db'],
                teamDb: {} as ToolContext['teamDb'],
                teamVectorManager: {
                    getStats: () => ({ itemCount: 9, modelName: 'test-model', dimensions: 384 }),
                } as unknown as NonNullable<ToolContext['teamVectorManager']>,
                runtime: new ServerRuntime(),
            }),
            'team_get_vector_index_stats'
        )
        const badStats = statsTool.handler({ project_number: 'abc' }) as Record<string, unknown>
        expect(badStats['success']).toBe(false)
        expect(badStats['available']).toBe(false)
        expect(badStats['code']).toBe('VALIDATION_ERROR')

        const unscopedStats = statsTool.handler({}) as Record<string, unknown>
        expect(unscopedStats['success']).toBe(true)
        expect('scopeNote' in unscopedStats).toBe(false)

        const scopedStats = statsTool.handler({ workspace_id: 'companion' }) as Record<string, unknown>
        expect(scopedStats['success']).toBe(true)
        expect(scopedStats['scopeNote']).toBe('Database-wide team vector index statistics')

        const unregisteredDir = makeTempDir('mj-p68-unreg-', true)
        expect(() =>
            resolveGitWorkingDir(
                { cwd: unregisteredDir, workspace_id: 'companion', project_number: 16 },
                {
                    allowedIoRoots: [unregisteredDir],
                    projectRegistry: {
                        companion: { path: path.join(os.tmpdir(), 'some-other-repo'), project_number: 16 },
                    },
                }
            )
        ).toThrow(/not registered/)
    })

    it('Low & AP1–AP4: registry cache invalidation, Zod error suffix, changelog + 1 lookahead & Pass 68 prompt checks', async () => {
        const cfgDir = makeTempDir('mj-p68-cfg-')
        const cfgFile = path.join(cfgDir, 'registry.json')
        writeProjectRegistryFile(cfgFile, { projectRegistry: { alpha: { path: cfgDir, project_number: 1 } } })
        readProjectRegistryFile(cfgFile)
        writeProjectRegistryFile(cfgFile, { projectRegistry: { beta: { path: cfgDir, project_number: 2 } } })
        const cachedAfterWrite = readCachedConfigObject(cfgFile)
        expect(cachedAfterWrite).toMatchObject({ projectRegistry: { beta: { project_number: 2 } } })

        const parsedZod = parseZodErrorsFromMessage(
            'Input error: [ANTI-HALLUCINATION] bad value: [{"path":["limit"],"message":"Too small"}]'
        )
        expect(parsedZod).toBe('limit: Too small')

        const extractedScope = extractAuditScopeFromUri('memory://kanban/%ZZ/16')
        expect(extractedScope.projectNumber).toBe(16)

        const gitDir = makeTempDir('mj-p68-chlog-')
        const runGit = (args: string[]): string =>
            execFileSync('git', args, {
                cwd: gitDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            }).trim()
        runGit(['init'])
        runGit(['config', 'user.email', 'test@example.com'])
        runGit(['config', 'user.name', 'Test User'])
        fs.writeFileSync(path.join(gitDir, 'file.txt'), 'v1\n', 'utf-8')
        runGit(['add', '.'])
        runGit(['commit', '-m', 'feat: first'])
        fs.writeFileSync(path.join(gitDir, 'file.txt'), 'v2\n', 'utf-8')
        runGit(['add', '.'])
        runGit(['commit', '-m', 'feat: second'])

        const exactCap = await getUnreleasedChangelog(gitDir, { maxCount: 2, summary: true })
        expect(exactCap.commits.length).toBe(2)
        expect(exactCap.truncated).toBe(false)

        fs.writeFileSync(path.join(gitDir, 'file.txt'), 'v3\n', 'utf-8')
        runGit(['add', '.'])
        runGit(['commit', '-m', 'feat: third'])
        const overCap = await getUnreleasedChangelog(gitDir, { maxCount: 2, summary: true })
        expect(overCap.commits.length).toBe(2)
        expect(overCap.truncated).toBe(true)

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass87')
        const promptDb = new DatabaseAdapter(':memory:')
        await promptDb.initialize()
        let cqText: string
        try {
            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                promptDb
            )
            cqText = cqRes.messages[0]?.content.text ?? ''
        } finally {
            promptDb.close()
        }
        expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass87')
        expect(cqText).toContain('normalizeLockDirKey')
        expect(cqText).toContain('releaseRestoreLock')
        expect(cqText).toContain('realpathSync.native')
        expect(cqText).toContain('registryFileCache')
        expect(cqText).toContain("lastIndexOf(': [')")
    }, 30_000)
})
