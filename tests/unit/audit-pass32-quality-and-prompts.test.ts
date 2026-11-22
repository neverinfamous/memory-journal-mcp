/**
 * Pass 32 Quality, Zod 4 Schema, Transport, SQLite, Code Mode & Prompt Regression Suite
 * Covers M2-M12, L1-L8, and AP1-AP4.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { createAuthMiddleware as createOAuthMiddleware } from '../../src/auth/middleware.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { createAuthMiddleware as createBearerMiddleware } from '../../src/transports/http/handlers.js'
import { HttpTransport } from '../../src/transports/http/index.js'
import { writeVerifiedBackupFile } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { sanitizeFtsQuery } from '../../src/database/sqlite-adapter/entries/search/fts-sanitizer.js'
import { extractParameters } from '../../src/handlers/resources/help-schema-params.js'
import { safeDecodeUriSegment } from '../../src/handlers/resources/uri-and-fencing.js'
import { getKanbanTemplateDefinitions } from '../../src/handlers/resources/templates-kanban.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { getZodTypeString } from '../../src/codemode/type-generator.js'
import { instrumentToolDefinitions } from '../../src/handlers/tools/arg-interceptions.js'
import { GitHistoryOptionsSchemaMcp } from '../../src/handlers/tools/git-schemas.js'
import { createSandboxExecutor } from '../../src/codemode/worker/nested-exec-scope.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { disposeCodemodeResources } from '../../src/handlers/tools/codemode/singleton-state.js'
import { getTeamIoTools } from '../../src/handlers/tools/team/io-tools.js'
import { getGitTools } from '../../src/handlers/tools/git.js'
import { matchSuggestion } from '../../src/utils/errors/suggestions.js'
import { parseAuditLine } from '../../src/audit/audit-query-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import type { IDatabaseConnection } from '../../src/database/core/interfaces.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 32 Quality, Transport, SQLite, Schema & Prompt Regressions (M2-M12, L1-L8, AP1-AP4)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string
    let savedEnv: NodeJS.ProcessEnv

    beforeEach(async () => {
        savedEnv = { ...process.env }
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass32-qual-'))
    })

    afterEach(() => {
        disposeCodemodeResources()
        vi.restoreAllMocks()
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) delete process.env[key]
        }
        Object.assign(process.env, savedEnv)
        db.close()
        teamDb.close()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('M2: createAuthMiddleware sets AuthInfo.expiresAt in seconds (claims.exp)', async () => {
        const validator = Object.create(TokenValidator.prototype) as TokenValidator
        validator.validate = vi.fn().mockResolvedValueOnce({
            valid: true,
            claims: { sub: 'oauth-user', scopes: ['read'], exp: 1790000123, iat: 1790000000 },
        })
        const middleware = createOAuthMiddleware({
            tokenValidator: validator,
            resourceServer: {
                getResourceUri: () => 'https://mcp.example.com',
                getWWWAuthenticateHeader: () => 'Bearer realm="mcp"',
            } as never,
        })

        const req = {
            path: '/mcp',
            headers: { authorization: 'Bearer test-jwt' },
        } as unknown as Record<string, unknown>
        const next = vi.fn()
        await middleware(req as never, { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never, next)

        expect(next).toHaveBeenCalled()
        expect((req['auth'] as { expiresAt?: number }).expiresAt).toBe(1790000123)
    })

    it('M3 & L6a: startMetricsServer rejects placeholder tokens on non-loopback binds and closes in-flight listen cleanly', async () => {
        const runtime = new ServerRuntime()
        process.env['MJ_METRICS_HOST'] = '0.0.0.0'
        expect(() =>
            startMetricsServer(runtime, 0, {
                authToken: 'change_this_to_a_secure_token_for_production',
            })
        ).toThrow(/default auth token|placeholder|loopback|token/i)

        delete process.env['MJ_METRICS_HOST']
        const stop = startMetricsServer(runtime, 0)
        await expect(stop()).resolves.toBeUndefined()
    })

    it('M4 & L6b: bearer middleware ignores trailing commas/whitespace and HttpTransport runs auth before body parsing', async () => {
        process.env['MCP_AUTH_SCOPES'] = 'read, write,   '
        const bearerMw = createBearerMiddleware('valid-secret-123')
        const req = {
            path: '/mcp',
            headers: { authorization: 'Bearer valid-secret-123' },
            socket: { remoteAddress: '127.0.0.1' },
        } as unknown as Record<string, unknown>
        const next = vi.fn()
        bearerMw(req as never, { status: vi.fn().mockReturnThis(), json: vi.fn() } as never, next)
        expect((req['auth'] as { scopes: string[] }).scopes).toEqual(['read', 'write'])

        const transport = new HttpTransport(
            {
                port: 0,
                host: '127.0.0.1',
                stateless: true,
                authToken: 'secret-token-xyz',
                enableRateLimit: true,
                rateLimitWindowMs: 60_000,
                rateLimitMaxRequests: 100,
            },
            undefined
        )
        const serverStub = {
            connect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
        } as unknown as Parameters<HttpTransport['start']>[0]
        await transport.start(serverStub)
        try {
            const addr = (
                transport as unknown as {
                    httpServer?: { address: () => { port: number } | string | null }
                }
            ).httpServer?.address()
            const port = typeof addr === 'object' && addr !== null ? addr.port : 0
            expect(port).toBeGreaterThan(0)
            // Send intentionally malformed JSON with bad auth: must return 401 before body-parser's 400 SyntaxError.
            const resp = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: 'Bearer wrong-token',
                },
                body: '{malformed-json',
            })
            expect(resp.status).toBe(401)
        } finally {
            await transport.stop()
        }
    })

    it('M5, M6 & M7: stages verified backups, rebuilds FTS5 atomically, strips trailing FTS operators, and matches facet tags', async () => {
        const targetBackup = path.join(tmpDir, 'named.db')
        fs.writeFileSync(targetBackup, 'EXISTING-VALID-BACKUP-SENTINEL', 'utf-8')
        const failingConn: IDatabaseConnection = {
            initialize: async () => undefined,
            close: () => undefined,
            exec: () => [],
            run: () => undefined,
            pragma: () => undefined,
            getDbPath: () => path.join(tmpDir, 'nonexistent-source.db'),
        }
        await expect(writeVerifiedBackupFile(failingConn, targetBackup)).rejects.toThrow()
        expect(fs.readFileSync(targetBackup, 'utf-8')).toBe('EXISTING-VALID-BACKUP-SENTINEL')

        expect(sanitizeFtsQuery('foo AND /-')).toBe('foo')

        db.createEntry({
            content: 'Facet token verification entry',
            tags: ['Security-Audit'],
            workspaceId: 'memory-journal-mcp',
        })
        const facets = db.getSearchFacets('Facet', {
            tags: ['SECURITY-AUDIT'],
            workspaceId: 'memory-journal-mcp',
        })
        expect(facets.tags.some((t) => t.name === 'security-audit')).toBe(true)

        const fileDbPath = path.join(tmpDir, 'rebuild.db')
        const fileDb = new DatabaseAdapter(fileDbPath)
        await fileDb.initialize()
        try {
            fileDb.createEntry({
                content: 'rebuild-unique-marker-token',
                workspaceId: 'memory-journal-mcp',
            })
        } finally {
            fileDb.close()
        }
        const BetterSqlite3 = (await import('better-sqlite3')).default
        const rawDb = new BetterSqlite3(fileDbPath)
        try {
            // Empty FTS5 index before reopening to trigger deferred transactional rebuild.
            rawDb.exec("INSERT INTO fts_content(fts_content) VALUES ('delete-all')")
        } finally {
            rawDb.close()
        }

        const reopened = new DatabaseAdapter(fileDbPath)
        await reopened.initialize()
        try {
            await vi.waitFor(
                () => {
                    expect(
                        reopened.searchEntries('rebuild-unique-marker-token', {
                            workspaceId: 'memory-journal-mcp',
                        }).entries
                    ).toHaveLength(1)
                },
                { timeout: 2500 }
            )
        } finally {
            reopened.close()
        }
    })

    it('M8: introspects Zod 4 ZodStringFormat/ZodPrefault/ZodUnion/ZodIntersection and preserves transform pipe extensions', () => {
        const complexSchema = z.object({
            email: z.email(),
            role: z.string().prefault('member'),
            choice: z.union([z.string(), z.number()]),
            merged: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
        })
        const params = extractParameters(complexSchema)
        const byName = new Map(params.map((p) => [p.name, p]))
        expect(byName.get('email')?.type).toBe('string')
        expect(byName.get('role')?.required).toBe(false)
        expect(byName.get('choice')?.type).toBe('string | number')
        expect(getZodTypeString(complexSchema.shape.merged)).toBe('{ a: string } & { b: number }')

        const instrumented = instrumentToolDefinitions([
            {
                name: 'get_git_history',
                title: 'Git History',
                description: 'Git history',
                group: 'git',
                inputSchema: GitHistoryOptionsSchemaMcp,
                annotations: { readOnlyHint: true },
                handler: (p) => p,
            },
        ])
        const parsed = (instrumented[0]?.inputSchema as z.ZodType).parse({
            maxCount: 5,
            use_test_db: true,
        }) as Record<string, unknown>
        expect(parsed['maxCount']).toBe(5)
    })

    it('M9 & M10: routes nested { query } to search, blocks nested cross-workspace escape, and resolves METHOD_ALIASES before arg interception', async () => {
        const searchSpy = vi.fn().mockResolvedValue({ success: true, entries: [] })
        const createSpy = vi.fn().mockResolvedValue({ success: true })
        const sandboxExec = createSandboxExecutor({
            shimMj: {
                core: { createEntry: createSpy },
                search: { searchEntries: searchSpy },
            },
            vmContextRef: { current: undefined },
            timeoutMs: 5000,
            readonlyMode: false,
            dryRunMode: false,
            useTestDbMode: false,
            pinnedWorkspaceRaw: 'memory-journal-mcp',
            pinnedProjectRaw: 5,
            projectRegistryRaw: TEST_REGISTRY,
            runIsolatedNestedCode: async () => ({ success: true }),
        })
        await sandboxExec({ query: 'oauth token' })
        expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'oauth token' }))
        expect(createSpy).not.toHaveBeenCalled()

        const escapeRes = (await sandboxExec({
            workspace_id: 'other-repo',
            code: 'return 1',
        })) as Record<string, unknown>
        expect(escapeRes['success']).toBe(false)
        expect(escapeRes['code']).toBe('VALIDATION_ERROR')

        const rpcSpy = vi.fn().mockResolvedValue({ success: true })
        const mj = buildApiProxy(rpcSpy, { core: ['create_entry', 'update_entry'] })
        await (
            mj['core'] as { update: (id: number, body: { text: string }) => Promise<unknown> }
        ).update(42, { text: 'Via update alias' })
        expect(rpcSpy).toHaveBeenCalledWith('core', 'update_entry', [
            { entry_id: 42, content: 'Via update alias' },
        ])
    })

    it('M11, M12 & L1-L8: team_import_markdown sets isPersonal=false, git patterns/kanban/URI guards hold, and utility polish works', async () => {
        process.env['TEAM_AUTHOR'] = 'Alice'
        const mdDir = path.join(tmpDir, 'team-md')
        fs.mkdirSync(mdDir, { recursive: true })
        fs.writeFileSync(
            path.join(mdDir, 'note.md'),
            '---\n{"tags":["team"]}\n---\n\nTeam imported content',
            'utf-8'
        )
        const teamImportTool = getTeamIoTools({
            db,
            teamDb,
            config: {
                teamDefaultRole: 'admin',
                projectRegistry: TEST_REGISTRY,
                allowedIoRoots: [tmpDir],
            },
        }).find((t) => t.name === 'team_import_markdown')
        const importRes = (await teamImportTool?.handler({
            source_dir: mdDir,
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
        })) as Record<string, unknown>
        expect(importRes['success']).toBe(true)
        const imported = teamDb.getRecentEntries(5, undefined, undefined, undefined, undefined, 'memory-journal-mcp')
            .entries[0]
        expect(imported?.isPersonal).toBe(false)

        const gitDir = path.join(tmpDir, 'git-proto')
        fs.mkdirSync(gitDir, { recursive: true })
        execFileSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir, stdio: 'ignore' })
        execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: gitDir, stdio: 'ignore' })
        execFileSync('git', ['commit', '--allow-empty', '-m', 'feat(constructor): proto test'], {
            cwd: gitDir,
            stdio: 'ignore',
        })
        execFileSync('git', ['commit', '--allow-empty', '-m', 'fix(__proto__): proto two'], {
            cwd: gitDir,
            stdio: 'ignore',
        })
        const patternsTool = getGitTools({
            db,
            config: { allowedIoRoots: [tmpDir] },
        }).find((t) => t.name === 'analyze_commit_patterns')
        const patternsRes = (await patternsTool?.handler({ cwd: gitDir })) as Record<string, unknown>
        expect(patternsRes['success']).toBe(true)

        expect(() => safeDecodeUriSegment('bad%00seg')).toThrow()
        const kanbanDyn = getKanbanTemplateDefinitions().find((d) => d.uri.includes('{+repo}'))
        await expect(
            kanbanDyn?.handler('memory://kanban/other-repo/5', {
                db,
                briefingConfig: { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: TEST_REGISTRY },
            })
        ).rejects.toThrow()

        // L2 mergeTags chunking (> 500 entries)
        db.createEntries(
            Array.from({ length: 505 }, (_, i) => ({
                content: `Tag row ${String(i)}`,
                tags: ['old-tag'],
                workspaceId: 'memory-journal-mcp',
            }))
        )
        const mergeRes = db.mergeTags('old-tag', 'new-tag', 'memory-journal-mcp')
        expect(mergeRes.entriesUpdated).toBe(505)

        // L3 matchSuggestion & L5 dryRun & L7 parseAuditLine & L8 team.md & AP1-AP4
        expect(matchSuggestion('Invalid option: expected one of entry_type')?.suggestion).toContain('maintenance')
        expect(parseAuditLine('null')).toBeNull()
        expect(parseAuditLine('42')).toBeNull()
        expect(parseAuditLine('[]')).toBeNull()
        expect(parseAuditLine('{"id":1}')).toBeNull()

        const teamMd = fs.readFileSync(
            path.join(process.cwd(), 'src', 'constants', 'instructions', 'markdown', 'team.md'),
            'utf-8'
        )
        expect(teamMd).not.toContain('--team-author')

        const execTool = getCodeModeTools({
            db,
            config: { codemodeEnabled: true, projectRegistry: TEST_REGISTRY, runtime: new ServerRuntime() },
        }).find((t) => t.name === 'mj_execute_code')
        const dryRes = (await execTool?.handler({
            dryRun: true,
            code: 'return await mj.core.getRecentEntries({ limit: 1 })',
        })) as Record<string, unknown>
        expect(dryRes['simulated']).toBe(true)

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass73')
        const cqText = (
            getCodeQualityAuditPromptDefinition().handler(
                { target: 'memory-journal-mcp' },
                db,
                undefined,
                undefined,
                { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: TEST_REGISTRY }
            ).messages[0]?.content as { text: string }
        ).text
        expect(cqText).toContain("$canon = @(@('src'")
        expect(cqText).toContain("createRequire(path.join(process.cwd(), 'package.json'))('typescript')")
    }, 30000)
})
