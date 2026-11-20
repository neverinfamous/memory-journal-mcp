/**
 * Pass 46 Adversarial Security Regression Suite — Part 2:
 * SQLite Backup Schema/Cipher Guards, Audit Bounds, Filter/Team Parity,
 * Drive-Relative Paths, JWT typ, \u2028/\u2029 Fencing, Secret/Error Scrubbing & Supply Chain
 * (H4, M4–M7, M10–M12, L1–L3, L5–L10, AP1–AP5).
 */

import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const joseMockState = vi.hoisted(() => ({
    typ: 'at+jwt' as string | undefined,
}))

vi.mock('jose', async (importOriginal) => {
    const actual = await importOriginal<typeof import('jose')>()
    return {
        ...actual,
        createRemoteJWKSet: vi.fn(() => vi.fn()),
        jwtVerify: vi.fn(async () => ({
            payload: {
                sub: 'user-pass46',
                scope: 'read write',
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
            protectedHeader: {
                alg: 'RS256',
                ...(joseMockState.typ !== undefined ? { typ: joseMockState.typ } : {}),
            },
        })),
    }
})

import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { assertIncomingBackupIntact } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { searchAuditFileBackward } from '../../src/audit/audit-file-helpers.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import { shareCreatedEntryWithTeam } from '../../src/handlers/tools/core/create-entry-helpers.js'
import { isDummyToolAllowedByFilter } from '../../src/handlers/tools/dummy-filter-helpers.js'
import {
    DUMMY_HEALING_TOOL_NAMES,
    projectAliasTarget,
} from '../../src/handlers/tools/core/dummy-healing/alias-catalog.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { handleCrossTeamSearch } from '../../src/handlers/tools/search/cross-team.js'
import { getTeamResourceDefinitions } from '../../src/handlers/resources/team.js'
import { getInsightResourceDefinitions } from '../../src/handlers/resources/insights.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { assertSafeFilePath, hasUnsafeAdsColon, PathTraversalError } from '../../src/utils/path-safety.js'
import { safeDecodeUriSegment, sliceUntrustedInline } from '../../src/handlers/resources/uri-and-fencing.js'
import {
    fenceNonCanonicalRefOrKey,
    markUntrustedContentInline,
    sanitizeAuthor,
    sanitizeErrorForLogging,
} from '../../src/utils/security-utils.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { formatToolFailure } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { toThrownValidationResponse } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { formatCliError } from '../../src/cli/commands/cli-output.js'
import { readMetricsSnapshotFile, writeMetricsSnapshotFile } from '../../src/observability/metrics-persistence.js'
import { assertSafeConfigWriteTargetSync, readSafeRegularConfigTextSync } from '../../src/utils/config-file-safety.js'
import { generateSummaryPrompt } from '../../src/handlers/prompts/workflow-helpers.js'
import { getLoadBriefingPromptDefinitions } from '../../src/handlers/prompts/load-briefing.js'
import { buildStatsSnippet } from '../../src/handlers/prompts/optimizer-snippets.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import { ValidationError } from '../../src/types/errors.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

function field(obj: unknown, key: string): unknown {
    return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined
}

const REGISTRY = {
    'memory-journal-mcp': { path: path.resolve('/repos/memory-journal-mcp'), project_number: 5 },
}

describe('Pass 46 Storage, Auth, Filter Parity & Transport Regressions', () => {
    const tempDirs: string[] = []
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let savedTeamAuthor: string | undefined

    function makeTempDir(prefix = 'mj-pass46-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        savedTeamAuthor = process.env['TEAM_AUTHOR']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        joseMockState.typ = 'at+jwt'
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedTeamAuthor !== undefined) process.env['TEAM_AUTHOR'] = savedTeamAuthor
        else delete process.env['TEAM_AUTHOR']
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('H4/L5: enables trusted_schema=OFF, guards restore schemas/headers, sanitizes %, and revokes NULL alias', async () => {
        const dir = makeTempDir()
        const dbPath = path.join(dir, 'main.db')
        const conn = new NativeConnectionManager(dbPath)
        await conn.initialize()
        try {
            const native = conn.getNativeDb()
            expect(native.pragma('trusted_schema', { simple: true })).toBe(0)
            native
                .prepare('INSERT INTO author_aliases (alias, canonical_author, workspace_id) VALUES (?, ?, NULL)')
                .run('legacy_bob', 'Bob')
        } finally {
            conn.close()
        }

        const adapter = new DatabaseAdapter(dbPath)
        await adapter.initialize()
        try {
            const exported = await adapter.exportToFile('valid%name')
            expect(exported.filename).not.toContain('%')
            await expect(assertIncomingBackupIntact(exported.path)).resolves.toBeUndefined()

            const viewDbPath = path.join(dir, 'evil-view.db')
            const viewDb = new Database(viewDbPath)
            try {
                viewDb.exec('CREATE TABLE memory_journal (id INTEGER PRIMARY KEY); CREATE VIEW evil_v AS SELECT 1;')
            } finally {
                viewDb.close()
            }
            await expect(assertIncomingBackupIntact(viewDbPath)).rejects.toThrow(/Disallowed SQLite view/)

            const trigDbPath = path.join(dir, 'evil-trig.db')
            const trigDb = new Database(trigDbPath)
            try {
                trigDb.exec(
                    'CREATE TABLE memory_journal (id INTEGER PRIMARY KEY); CREATE TRIGGER evil_t AFTER INSERT ON memory_journal BEGIN DELETE FROM memory_journal; END;'
                )
            } finally {
                trigDb.close()
            }
            await expect(assertIncomingBackupIntact(trigDbPath)).rejects.toThrow(/Disallowed SQLite trigger/)

            expect(() => adapter.removeAuthorAlias('legacy_bob', '*')).toThrow()
            expect(adapter.removeAuthorAlias('legacy_bob', 'default')).toBe(true)

            process.env['MJ_DB_ENCRYPTION_KEY'] = 'deadbeef-test-secret'
            await expect(assertIncomingBackupIntact(exported.path)).rejects.toThrow(
                /Unencrypted SQLite backup header rejected/
            )
        } finally {
            adapter.close()
        }
    })

    it('M4: bounds audit collection args and line bytes strictly below backward reader maxLineBytes', async () => {
        const dir = makeTempDir()
        const logPath = path.join(dir, 'audit.jsonl')
        const audit = new AuditLogger({ enabled: true, logPath, redact: false })
        const interceptor = createAuditInterceptor(audit)

        const bigPayload = {
            items: Array.from({ length: 120 }, (_v, idx) => `${String(idx)}-${'x'.repeat(2048)}`),
        }
        await interceptor.around('create_entry', bigPayload, async () => ({ ok: true }))
        await audit.close()

        const rawLines = fs.readFileSync(logPath, 'utf-8').trim().split('\n')
        expect(rawLines).toHaveLength(1)
        expect(Buffer.byteLength(rawLines[0] ?? '', 'utf8')).toBeLessThanOrEqual(262_144)

        const results: AuditEntry[] = []
        const page = await searchAuditFileBackward(logPath, {}, 10, results)
        expect(page.skippedLines).toBe(0)
        expect(results).toHaveLength(1)

        const over1MbPath = path.join(dir, 'huge-line.jsonl')
        fs.writeFileSync(
            over1MbPath,
            `${JSON.stringify({ timestamp: '2026-11-19T00:00:00Z', tool: 'x', args: { pad: 'y'.repeat(1_100_000) } })}\n`,
            'utf8'
        )
        const hugeResults: AuditEntry[] = []
        const hugePage = await searchAuditFileBackward(over1MbPath, {}, 10, hugeResults)
        expect(hugePage.skippedLines).toBe(1)
        expect(hugeResults).toHaveLength(0)
    })

    it('M5/M6/M7/L6: enforces share_with_team filters, maps mj.projects.*, and fails closed on team resources/cross-team search', async () => {
        process.env['TEAM_AUTHOR'] = 'Alice'
        const personalDb = new DatabaseAdapter(':memory:')
        const teamDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            expect(() =>
                shareCreatedEntryWithTeam(
                    {
                        db: personalDb,
                        teamDb,
                        config: { runtime: new ServerRuntime(), filterConfig: parseToolFilter('starter,-team') },
                    },
                    { content: 'hello', workspaceId: 'memory-journal-mcp', projectNumber: 5, isPersonal: false }
                )
            ).toThrow(/disabled by active tool filter/)

            expect(
                isDummyToolAllowedByFilter('team-session-summary', parseToolFilter('starter,-team'), true)
            ).toBe(false)
            expect(projectAliasTarget('projects_list_projects')).toBe('list_projects')
            expect(projectAliasTarget('projects_get_projects')).toBe('list_projects')
            expect(projectAliasTarget('projects_get_project')).toBe('get_project')
            expect(DUMMY_HEALING_TOOL_NAMES.has('mj.projects.listProjects')).toBe(true)
            expect(getRequiredScope('mj.admin.getProjects')).toBe('read')
            expect(getRequiredScope('mj_admin_get_projects')).toBe('read')

            await expect(
                handleCrossTeamSearch(
                    {
                        query: 'test',
                        workspace_id: '*',
                        limit: 5,
                        sort_by: 'timestamp',
                        fuzzy_match: false,
                        include_archived: false,
                    },
                    { db: personalDb, teamDb, config: { runtime: new ServerRuntime(), projectRegistry: REGISTRY } }
                )
            ).rejects.toThrow(ValidationError)

            const statsDef = getTeamResourceDefinitions().find((r) => r.uri === 'memory://team/statistics')
            const statsRes = await statsDef?.handler('memory://team/statistics', {
                db: personalDb,
                teamDb,
                briefingConfig: { projectRegistry: REGISTRY },
                runtime: { teamDefaultRole: 'viewer' },
            })
            expect(field(statsRes?.data, 'code')).toBe(-32602)

            const collabDef = getInsightResourceDefinitions().find(
                (r) => r.uri === 'memory://insights/team-collaboration'
            )
            await expect(async () =>
                collabDef?.handler('memory://insights/team-collaboration', {
                    db: personalDb,
                    teamDb,
                    briefingConfig: { projectRegistry: REGISTRY },
                    runtime: { teamDefaultRole: 'viewer' },
                })
            ).rejects.toThrow(/explicit project_number/)
        } finally {
            personalDb.close()
            teamDb.close()
        }
    })

    it('M10/M11/M12/L1/L3/L7-L10: validates drive-relative paths, u2028/u2029, typ header, error scrubbing, files & prompts', async () => {
        const dir = makeTempDir()
        expect(hasUnsafeAdsColon('C:')).toBe(true)
        expect(hasUnsafeAdsColon('C:rel.md')).toBe(true)
        expect(() => assertSafeFilePath('C:rel.md', [dir])).toThrow(PathTraversalError)

        expect(() => safeDecodeUriSegment('bad%E2%80%A8seg')).toThrow(/Control characters/)
        expect(markUntrustedContentInline('a\u2028b\u2029c')).toBe('<untrusted_remote_content>a b c</untrusted_remote_content>')
        expect(sliceUntrustedInline('x\u2028y', 50)).toBe('<untrusted_remote_content>x y</untrusted_remote_content>')
        expect(fenceNonCanonicalRefOrKey('sub\u2028id', true)).toContain('<untrusted_remote_content>')
        expect(sanitizeAuthor('Alice\u2028\u2029')).toBe('Alice')

        const validator = new TokenValidator({
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            issuer: 'https://auth.example.com',
            audience: 'memory-journal-mcp',
        })
        joseMockState.typ = 'rt+jwt'
        expect((await validator.validate('tok')).valid).toBe(false)
        joseMockState.typ = 'application/at+jwt'
        expect((await validator.validate('tok')).valid).toBe(true)

        const metricsPath = path.join(dir, 'metrics.json')
        await writeMetricsSnapshotFile(metricsPath, '{"ok":true}')
        expect(await readMetricsSnapshotFile(metricsPath)).toBe('{"ok":true}')
        const cfgPath = path.join(dir, 'cfg.json')
        assertSafeConfigWriteTargetSync(cfgPath)
        fs.writeFileSync(cfgPath, '{"x":1}')
        expect(readSafeRegularConfigTextSync(cfgPath)?.content).toBe('{"x":1}')

        expect(
            sanitizeErrorForLogging('--auth_token="sec\\"ret" --db_encryption_key=mysecret123')
        ).not.toContain('mysecret123')
        expect(formatCliError(new Error('Bearer ghp_1234567890abcdef failed'))).not.toContain('ghp_')
        const toolFail = formatToolFailure(new Error('boom at C:\\secret\\file.db'), 'x', {})
        expect(String(toolFail['error'])).not.toContain('secret')
        const thrownResp = toThrownValidationResponse({ code: -32602, message: 'Invalid /Users/alice/tok' }, {})
        expect(String(field(thrownResp?.structuredContent, 'error'))).not.toContain('/Users/alice')
        const handlerErr = formatHandlerError(new ValidationError('fail /Users/alice/key', { inner: new Error('ghp_abc123') }))
        expect(handlerErr.error).not.toContain('/Users/alice')

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const promptRes = generateSummaryPrompt(
                db,
                undefined,
                'personal',
                'memory-journal-mcp',
                { projectRegistry: REGISTRY },
                undefined
            )
            expect(promptRes.messages[0]?.content.text).toContain('project_number: 5')

            const lbDef = getLoadBriefingPromptDefinitions()[0]
            const lbRes = await lbDef?.handler(
                {},
                db,
                undefined,
                undefined,
                { projectRegistry: { 'evil|name\n# h1': { path: 'C:/ws/a', project_number: 5 } } }
            )
            expect(lbRes?.messages[0]?.content.text).toContain('evil\\|name # h1')
            expect(lbRes?.messages[0]?.content.text).toContain('C:/ws/a')

            const baseStats = db.getStatistics('week', undefined, undefined, true)
            vi.spyOn(db, 'getStatistics').mockReturnValueOnce({
                ...baseStats,
                totalEntries: 1,
                projectBreakdown: [{ name: 'bad|proj\nx', project_number: 5, entry_count: 1 }],
            })
            const snippet = buildStatsSnippet(db)
            expect(snippet).toContain('bad\\|proj x')
            const secDef = getSecurityAuditPromptDefinition()
            const rendered = await Promise.resolve(secDef.handler({ target: 'memory-journal-mcp' }, db))
            const promptText = rendered.messages[0]?.content.text ?? ''
            expect(promptText).toContain('explore')
            expect(promptText).toContain('generalPurpose')
            expect(promptText).toContain('trusted_schema = OFF')
        } finally {
            db.close()
        }

        const dockerfile = fs.readFileSync(path.resolve('Dockerfile'), 'utf-8')
        expect(dockerfile).toContain('ARG SQLITE_VEC_SHA256=')
        expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm')
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-20-audit-pass56')
    })
})
