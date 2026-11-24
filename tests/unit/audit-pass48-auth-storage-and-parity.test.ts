import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import {
    sanitizeErrorForLogging,
    isPlaceholderAuthToken,
    markUntrustedContentInline,
} from '../../src/utils/security-utils.js'
import { assertSafeDirectoryPath, PathTraversalError } from '../../src/utils/path-safety.js'
import { scrubAuditArgs } from '../../src/audit/audit-arg-scrubber.js'
import { extractAuditScopeFromArgs } from '../../src/audit/audit-query-helpers.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { isUnsafeSymlinkOrSpecialFile } from '../../src/audit/audit-file-helpers.js'
import { getAuditResourceDef } from '../../src/audit/audit-resource.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { exceedsMaxToolInputElements } from '../../src/utils/tool-input-bounds.js'
import { isValidProjectPath, isForbiddenProjectKey } from '../../src/utils/project-registry-guards.js'
import { resolveProjectContextWithRegistry } from '../../src/utils/workspace-resolver-pure.js'
import { CreateEntrySchema } from '../../src/handlers/tools/core/schemas.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { linkRequestedRelationships } from '../../src/handlers/tools/relationship-linking.js'
import { queryEntriesSharingAnchors } from '../../src/database/sqlite-adapter/graph-pivots.js'
import {
    isAllowedBackupVirtualTable,
    assertSafeTableAndIndexDdl,
} from '../../src/database/sqlite-adapter/backup-ddl-validators.js'
import { assertSafeBackupSchemaPreIntegrity } from '../../src/database/sqlite-adapter/backup-schema-guard.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { buildAllowedHostHeaders } from '../../src/transports/http/security.js'
import { createSessionCreator, type McpRouteState } from '../../src/transports/http/server/protocol-route-handlers.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { resolveAuthorizedIncludeTeam, isTeamFilterAllowed } from '../../src/handlers/tools/search/helpers.js'
import {
    SearchEntriesSchemaMcp,
    SearchByDateRangeSchemaMcp,
    SemanticSearchSchemaMcp,
} from '../../src/handlers/tools/search/schemas.js'
import { getTeamCoreTools } from '../../src/handlers/tools/team/core-tools.js'
import { getTeamAnalyticsTools } from '../../src/handlers/tools/team/analytics-tools.js'
import { buildGitHistoryLines } from '../../src/handlers/resources/core/briefing/user-message-sections.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import { PermissionError, ValidationError } from '../../src/types/errors.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { ToolContext, ToolFilterConfig } from '../../src/types/index.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

describe('Audit Pass 48 — ReDoS, Schemas, Logging & Audit Pipeline (H1, H2, L1, L2, L5, L10)', () => {
    beforeEach(() => {
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()
            if (d !== undefined) fs.rmSync(d, { recursive: true, force: true })
        }
    })

    it('runs linear-time secret & fence sanitization without catastrophic backtracking (H1, L10)', () => {
        const start = performance.now()
        const advToken = `--auth-token=${'a'.repeat(40_000)}!`
        const scrubbed = sanitizeErrorForLogging(advToken)
        const advXml = `<untrusted_remote_content${' x'.repeat(15_000)}>payload`
        const fenced = markUntrustedContentInline(advXml)
        expect(performance.now() - start).toBeLessThan(150)
        expect(scrubbed).toContain('[REDACTED]')
        expect(scrubbed).not.toContain('!')
        expect(fenced).toContain('payload')

        const args = scrubAuditArgs({ token: 'secret', huge: `Bearer ${'x'.repeat(10_000)}` })
        expect(args?.['token']).toBe('[REDACTED]')
        expect(typeof args?.['huge']).toBe('string')
        expect(String(args?.['huge']).length).toBeLessThan(2100)
    })

    it('enforces workspace_id max(255), bounded AuditLogger lines, safe egress, and JWT client_id typing (H2, L1, L2, L5)', async () => {
        const longWs = 'w'.repeat(256)
        expect(() => CreateEntrySchema.parse({ content: 'ok', workspace_id: longWs })).toThrow()
        const scope = extractAuditScopeFromArgs({ workspace_id: `Bearer secret-${'a'.repeat(300)}` })
        expect(scope.workspaceId?.length).toBeLessThanOrEqual(255)
        expect(scope.workspaceId).not.toContain('secret-')

        const dir = makeTempDir('mj-pass48-audit-')
        const logPath = path.join(dir, 'audit.jsonl')
        const logger = new AuditLogger({ enabled: true, logPath, redact: true, maxSizeBytes: 1024 * 1024 })
        logger.log({
            timestamp: new Date().toISOString(),
            requestId: 'req-1',
            tool: 'test_tool',
            category: 'read',
            scope: 'read',
            user: 'u1',
            scopes: ['read'],
            durationMs: 1,
            tokenEstimate: 5,
            workspaceId: longWs,
            success: true,
            error: 'e'.repeat(300_000),
            args: { huge: 'z'.repeat(300_000) },
        })
        await logger.close()
        const line = fs.readFileSync(logPath, 'utf-8').trim()
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(262_144)
        expect(await isUnsafeSymlinkOrSpecialFile(dir)).toBe(true)
        expect(await isUnsafeSymlinkOrSpecialFile(logPath)).toBe(false)

        const def = getAuditResourceDef(() => ({
            config: { enabled: true, logPath, redact: true },
            droppedCount: 0,
            isStderrOnly: () => false,
            recent: async () => [
                {
                    timestamp: new Date().toISOString(),
                    requestId: 'r1',
                    tool: 'create_entry',
                    category: 'write',
                    scope: 'write',
                    user: 'alice',
                    scopes: ['write'],
                    durationMs: Number.POSITIVE_INFINITY,
                    tokenEstimate: Number.NaN,
                    success: false,
                    error: 'Bearer top-secret-jwt-9999',
                },
            ],
        }) as unknown as AuditLogger)
        const res = await def.handler('memory://audit', {} as never)
        expect(String(res.data)).toContain('total_tokens: 0')
        expect(String(res.data)).toContain('[REDACTED]')
        expect(String(res.data)).not.toContain('top-secret-jwt-9999')

        const validator = new TokenValidator({
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            issuer: 'https://auth.example.com',
            audience: 'mj-api',
        })
        const extract = Reflect.get(validator, 'extractClaims') as (p: Record<string, unknown>) => Record<string, unknown>
        const claims = extract.call(validator, { sub: 'alice', exp: 4_102_444_800, client_id: { bad: 1 } })
        expect('client_id' in claims).toBe(false)
    })
})

describe('Audit Pass 48 — HTTP Transport, Issue Logger & Config/CI Hardening (M6–M10, L4)', () => {
    it('enforces per-principal session cap (429) and tenant-isolated eviction (M6)', () => {
        const sseTransports = new Map()
        const sessionOwners = new Map<string, string>()
        const sessionLastActivity = new Map<string, number>()
        const now = Date.now()
        for (let i = 0; i < 20; i++) {
            const sid = `alice-${String(i)}`
            sseTransports.set(sid, { close: async () => undefined })
            sessionOwners.set(sid, 'alice')
            sessionLastActivity.set(sid, now)
        }
        const state: McpRouteState = {
            config: { port: 0, host: '127.0.0.1' },
            serverFactory: () => ({}) as never,
            activeServers: new Set(),
            sseTransports,
            sessionOwners,
            sessionLastActivity,
        }
        const creator = createSessionCreator(state)
        const jsonSpy = vi.fn()
        const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy })
        const res = { status: statusSpy } as unknown as Response
        const req = { headers: {}, query: {} } as unknown as Request
        const next: NextFunction = vi.fn()

        runWithAuthContext({ authenticated: true, claims: { sub: 'alice', scopes: ['read'], exp: 9999999999 } }, () => {
            creator(req, res, next)
        })
        expect(statusSpy).toHaveBeenCalledWith(429)

        for (let i = 20; i < 100; i++) {
            const sid = `bob-${String(i)}`
            sseTransports.set(sid, { close: async () => undefined })
            sessionOwners.set(sid, 'bob')
            sessionLastActivity.set(sid, now - 60_000)
        }
        statusSpy.mockClear()
        creator(req, res, next)
        expect(statusSpy).toHaveBeenCalledWith(503)
        expect(sseTransports.has('bob-20')).toBe(true)
    })

    it('validates placeholder tokens, publicOrigin URLs, issue logs, and CI/Docker files (M7–M10, L4)', () => {
        expect(isPlaceholderAuthToken('change_this_to_a_secure_token_for_production')).toBe(true)
        expect(isPlaceholderAuthToken('CHANGEME_PROD')).toBe(true)
        expect(isPlaceholderAuthToken('strong-random-32-char-token')).toBe(false)

        expect(buildAllowedHostHeaders('127.0.0.1', 'https://api.example.com:8443/mcp')).toContain('api.example.com:8443')
        expect(() => buildAllowedHostHeaders('127.0.0.1', 'javascript:alert(1)')).toThrow()

        const scrubbedIssue = sanitizeIssueInput({
            token: 'secret',
            args: ['--auth-token', 'raw-secret-123'],
            text: 'x'.repeat(700),
        }) as { token: string; args: string[]; text: string }
        expect(scrubbedIssue.token).toBe('[REDACTED]')
        expect(scrubbedIssue.args[1]).toBe('[REDACTED]')
        expect(scrubbedIssue.text).toContain('...[truncated]')

        const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf-8')
        expect(dockerfile).toContain('chmod 700 /app/data /app/logs')
        expect(dockerfile).toContain('chown -R appuser:appgroup /app/data /app/logs')
        const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/secrets-scanning.yml'), 'utf-8')
        expect(workflow).toContain('github.event.pull_request.base.sha')
    })
})

describe('Audit Pass 48 — SQLite DDL Guard, Bounds, Path Safety & Restore Lock (M1–M5, L12, L13)', () => {
    it('enforces virtual-table and table/index DDL allowlists pre-integrity (M1, M2)', () => {
        expect(
            isAllowedBackupVirtualTable(
                'fts_content',
                "CREATE VIRTUAL TABLE fts_content USING fts5(content, content='memory_journal', content_rowid='id', tokenize='porter unicode61')"
            )
        ).toBe(true)
        expect(
            isAllowedBackupVirtualTable(
                'fts_content',
                "CREATE VIRTUAL TABLE fts_content USING fts5(content, content='evil', content_rowid='id')"
            )
        ).toBe(false)
        expect(() =>
            assertSafeTableAndIndexDdl('table', 't', 'CREATE TABLE t (id INT, x INT GENERATED ALWAYS AS (1))')
        ).toThrow()
        expect(() =>
            assertSafeTableAndIndexDdl('index', 'i', 'CREATE INDEX i ON memory_journal(load_extension(content))')
        ).toThrow()

        const db = new Database(':memory:')
        try {
            db.exec('CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT)')
            db.exec("CREATE VIEW evil_view AS SELECT * FROM memory_journal")
            expect(() => assertSafeBackupSchemaPreIntegrity(db)).toThrow(/Disallowed SQLite view/)
        } finally {
            db.close()
        }
    })

    it('counts ArrayBuffer/DataView expando properties, blocks rogue UNC paths, and verifies restore locks (M3–M5, L12, L13)', () => {
        const view = new Uint8Array(100)
        expect(exceedsMaxToolInputElements(view, 50)).toBe(true)
        const buf = new ArrayBuffer(4)
        const expandoHolder = buf as unknown as Record<string, unknown>
        expandoHolder['extra'] = Array.from({ length: 10 }, (_, i) => i)
        expect(exceedsMaxToolInputElements(buf, 8)).toBe(true)

        const root = makeTempDir('mj-pass48-paths-')
        expect(() => assertSafeDirectoryPath('\\\\attacker-server\\share\\drop', [root])).toThrow(PathTraversalError)
        expect(isValidProjectPath('/bin/custom')).toBe(false)
        expect(isForbiddenProjectKey('__proto__')).toBe(true)

        const lockDir = path.join(root, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir)
        fs.writeFileSync(lockFile, JSON.stringify({ holdingPid: null }))
        expect(() => acquireRestoreLock(lockDir, lockFile, {})).toThrow(/holding the database lock/)

        const resolved = resolveProjectContextWithRegistry(
            { project_number: 7 },
            { defaultWorkspaceId: 'custom-ws', projectRegistry: {} }
        )
        expect(resolved.workspaceId).toBe('custom-ws')
    })
})

describe('Audit Pass 48 — Team Search, Filter Parity, Linking, Analytics & Prompts (H6, M16–M19, L17, AP1–AP6)', () => {
    it('fails closed on include_team when filtered or missing project_number in active registry (H6, M16)', () => {
        const disabledFilter: ToolFilterConfig = {
            raw: '-team_search',
            enabledTools: new Set(['search_entries']),
            excludedGroups: new Set(),
            rules: [],
        }
        expect(isTeamFilterAllowed('team_search', { filterConfig: disabledFilter })).toBe(false)
        expect(() =>
            resolveAuthorizedIncludeTeam('search_entries', true, { include_team: true }, null, undefined, {
                filterConfig: disabledFilter,
            })
        ).toThrow(PermissionError)
        expect(
            resolveAuthorizedIncludeTeam('search_entries', true, {}, null, undefined, {
                filterConfig: disabledFilter,
            })
        ).toBe(false)
        expect(() =>
            resolveAuthorizedIncludeTeam('search_entries', true, { include_team: true }, null, undefined, {
                projectRegistry: { 'repo-a': { project_number: 5, path: '/tmp/a' } },
            }, 'repo-a', undefined)
        ).toThrow(ValidationError)
        expect(SearchEntriesSchemaMcp.parse({ query: 'test' }).include_team).toBeUndefined()
        expect(
            SearchByDateRangeSchemaMcp.parse({ start_date: '2026-01-01', end_date: '2026-01-02' }).include_team
        ).toBeUndefined()
        expect(SemanticSearchSchemaMcp.parse({ query: 'test' }).include_team).toBeUndefined()
    })

    it('gates pre-create links, enforces project scoping in relationship linking & anchors, and checks team analytics (M17–M19, L17, AP1–AP6)', async () => {
        const createEntrySpy = vi.fn()
        const disabledLinkFilter: ToolFilterConfig = {
            raw: '-link_entries',
            enabledTools: new Set(['create_entry']),
            excludedGroups: new Set(),
            rules: [],
        }
        const coreTools = getCoreTools({
            db: { createEntry: createEntrySpy } as unknown as IDatabaseAdapter,
            config: {
                filterConfig: disabledLinkFilter,
                projectRegistry: { 'repo-a': { project_number: 5, path: '/tmp/a' } },
            },
        } as unknown as ToolContext)
        const createTool = coreTools.find((t) => t.name === 'create_entry')
        const createRes = (await createTool?.handler({
            content: 'hello',
            project_number: 5,
            workspace_id: 'repo-a',
            relationships: [{ targetId: 1, relationType: 'references' }],
        })) as Record<string, unknown>
        expect(createRes['success']).toBe(false)
        expect(createEntrySpy).not.toHaveBeenCalled()

        const warnings = linkRequestedRelationships(
            {
                getEntryById: () => ({ projectNumber: null }),
                linkEntries: vi.fn(),
            },
            10,
            [{ targetId: 11, relationType: 'references' }],
            'repo-a',
            5
        )
        expect(warnings[0]).toContain('has no project_number')

        const db = new Database(':memory:')
        try {
            db.exec(`
                CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, entry_type TEXT, content TEXT, timestamp TEXT, workspace_id TEXT, project_number INTEGER, deleted_at TEXT);
                CREATE TABLE entry_anchors (entry_id INTEGER, anchor_path TEXT);
            `)
            db.exec(`
                INSERT INTO memory_journal VALUES (1, 'note', 'src', '2026-11-20T00:00:00Z', 'ws', 5, NULL);
                INSERT INTO memory_journal VALUES (2, 'note', 'same', '2026-11-20T00:00:00Z', 'ws', 5, NULL);
                INSERT INTO memory_journal VALUES (3, 'note', 'other', '2026-11-20T00:00:00Z', 'ws', 9, NULL);
                INSERT INTO entry_anchors VALUES (1, 'a.ts'), (2, 'a.ts'), (3, 'a.ts');
            `)
            const shared = queryEntriesSharingAnchors(db, 1, '2026-11-01T00:00:00Z', 10, 'ws', 5)
            expect(shared.map((r) => r.entryId)).toEqual([2])
        } finally {
            db.close()
        }

        const teamCtx = {
            db: {} as IDatabaseAdapter,
            teamDb: { getStatistics: vi.fn(), listTags: vi.fn() } as unknown as IDatabaseAdapter,
            config: { projectRegistry: { 'repo-a': { project_number: 5, path: '/tmp/a' } } },
        } as unknown as ToolContext
        const statsTool = getTeamAnalyticsTools(teamCtx).find((t) => t.name === 'team_get_statistics')
        const tagsTool = getTeamCoreTools(teamCtx).find((t) => t.name === 'team_list_tags')
        expect(((await statsTool?.handler({})) as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR')
        expect(((await tagsTool?.handler({})) as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR')

        const linesNull = buildGitHistoryLines({
            entryCount: 1,
            github: { repo: null, prCount: 0, issueCount: 0 },
            gitHistory: {
                commits: [{ hash: 'abcdef12', message: 'msg', date: '2026-11-20' }],
                stats: { total: 1, highImpact: 1, lowImpact: 0, avgConfidence: 1 },
            },
        } as never)
        expect(linesNull.join('\n')).not.toContain('https://github.com/null')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass87')
        const secDef = getSecurityAuditPromptDefinition()
        const promptRes = await secDef.handler(
            { target: 'all' },
            { searchByDateRange: () => [] } as unknown as IDatabaseAdapter
        )
        expect(promptRes.messages[0]?.content.text).toContain('root-owned `/app` in Docker')
        expect(promptRes.messages[0]?.content.text).toContain('PR base SHA secret scanning')
        expect(promptRes.messages[0]?.content.text).toContain('non-string `client_id` exclusion')
    })
})
