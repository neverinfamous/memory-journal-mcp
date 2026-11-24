import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import type { Request, Response } from 'express'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { BackupManager } from '../../src/database/sqlite-adapter/backup.js'
import { chunkedInPredicate } from '../../src/database/sqlite-adapter/row-helpers.js'
import { expandTagFilterValues } from '../../src/database/sqlite-adapter/tags.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { readResource } from '../../src/handlers/resources/index.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { hasToolCallRequestShape } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { resolveKnownFallbackAuditName } from '../../src/server/mcp-server/tool-registration/fallback-interceptors.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { extractAuditScopeFromArgs } from '../../src/audit/audit-query-helpers.js'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver.js'
import { matchRegistryByTagsOrContent } from '../../src/utils/workspace-registry-match.js'
import { SENSITIVE_KEY_RE, sanitizeErrorForLogging } from '../../src/utils/security-utils.js'
import { redactConfig } from '../../src/cli/dump-config.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { resolveReferences } from '../../src/github/commit-references/resolver.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { TeamCreateEntrySchema } from '../../src/handlers/tools/team/schemas/core-search-schemas.js'
import { ftsSearch } from '../../src/handlers/tools/search/fts.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { isPrivateOrLoopbackAddress } from '../../src/utils/network-safety.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { ConfigurationError } from '../../src/types/errors.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'

describe('Pass 43 Audit — Transport, Scope Parity, Secrets, Egress, Storage & Prompt', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let db: DatabaseAdapter

    beforeEach(async () => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
        vi.restoreAllMocks()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('M3 & L7: enforces tool-filter on whitespace URI rewrite, 8192B readResource cap, 10k prompt arg cap, and Array/null arguments', async () => {
        const disabledUriRes = (await callTool(
            'get_entry_by_id',
            { uri: '  memory://recent  ' },
            db,
            undefined,
            undefined,
            {
                runtime: new ServerRuntime(),
                filterConfig: parseToolFilter('starter,-read_resource'),
            }
        )) as Record<string, unknown>
        expect(disabledUriRes['success']).toBe(false)
        expect(disabledUriRes['code']).toBe('TOOL_DISABLED')

        await expect(readResource(`memory://briefing/${'a'.repeat(8200)}`, db)).rejects.toThrow(
            /8192 bytes/
        )
        expect(() =>
            getPrompt('adversarial-audit-security', { target: 'x'.repeat(10_001) }, db)
        ).toThrow(/10000 characters/)

        expect(
            hasToolCallRequestShape({ params: { name: 'search_entries', arguments: [1, 2] } })
        ).toBe(true)
        expect(
            hasToolCallRequestShape({ params: { name: 'search_entries', arguments: null } })
        ).toBe(true)
    })

    it('M4: preserves capability-flagged/admin prompt audit names & maps to SCOPES.ADMIN with HTTP session fallback', () => {
        expect(
            resolveKnownFallbackAuditName('optimize_journal', {
                name: 'optimize-journal',
                description: 'Optimize',
                handler: vi.fn(),
            } as never)
        ).toBe('optimize-journal')
        expect(
            resolveKnownFallbackAuditName('custom_admin_prompt', {
                name: 'custom-admin-prompt',
                description: 'Admin custom',
                capabilities: { requiresAdminScope: true },
                handler: vi.fn(),
            } as never)
        ).toBe('custom-admin-prompt')
        expect(getRequiredScope('optimize-journal')).toBe(SCOPES.ADMIN)

        const extracted = requestContextStorage.run(
            { requestId: 'req-m4', sessionId: 'http-sess-m4', ip: '127.0.0.1' },
            () => {
                setActiveSessionProject('ws-m4', 44)
                return extractAuditScopeFromArgs({})
            }
        )
        expect(extracted).toEqual({ workspaceId: 'ws-m4', projectNumber: 44 })
    })

    it('M5: unifies SENSITIVE_KEY_RE, redacts quoted CLI flags/nested dump-config & SQLCipher escaped quotes', () => {
        for (const k of [
            'privateKey',
            'encryptionKey',
            'authHeader',
            'passphrase',
            'cookie',
            'bearer',
            'key',
        ]) {
            expect(SENSITIVE_KEY_RE.test(k)).toBe(true)
        }
        expect(SENSITIVE_KEY_RE.test('publicKeyId')).toBe(false)

        expect(redactConfig({ args: ['--auth-token="s3cr3t"'], auth: { pass: 'x' } })).toEqual({
            args: ['--auth-token=[REDACTED]'],
            auth: { pass: '[REDACTED]' },
        })
        expect(sanitizeIssueInput(['serve', '--encryption-key', 'rawSecret'])).toEqual([
            'serve',
            '--encryption-key',
            '[REDACTED]',
        ])
        const scrubbedPragma = sanitizeErrorForLogging("PRAGMA key = 'pre''suf'")
        expect(scrubbedPragma).toContain("PRAGMA key = '[REDACTED]'")
        expect(scrubbedPragma).not.toContain('suf')
    })

    it('M6 & M7: blocks cross-repo commit reference GitHub API lookups and gates metrics user breakdown on SCOPES.AUDIT', async () => {
        const mockGh = {
            isApiAvailable: () => true,
            getIssue: vi.fn(),
            getPullRequest: vi.fn(),
        }
        const refs = await resolveReferences(
            [{ raw: 'other-org/secret-repo#1', number: 1, owner: 'other-org', repo: 'secret-repo', action: 'references' }],
            mockGh as never,
            'my-org',
            'my-repo'
        )
        expect(refs[0]?.type).toBe('unknown')
        expect(mockGh.getIssue).not.toHaveBeenCalled()
        expect(mockGh.getPullRequest).not.toHaveBeenCalled()

        const port = 22465 + Math.floor(Math.random() * 2000)
        const metrics = new MetricsAccumulator()
        metrics.recordUser('alice')
        const stopServer = startMetricsServer({ metrics } as never, port, {
            authToken: 'secret-token-pass43',
            authScopes: ['read'],
        })
        await new Promise((r) => setTimeout(r, 50))
        try {
            const metricsRes = await fetch(`http://127.0.0.1:${String(port)}/metrics`, {
                headers: { Authorization: 'Bearer secret-token-pass43' },
            })
            expect(metricsRes.status).toBe(200)
            const body = await metricsRes.text()
            expect(body).not.toContain('mcp_user_calls_total')

            const headRes = await fetch(`http://127.0.0.1:${String(port)}/health?check=1`, {
                method: 'HEAD',
            })
            expect(headRes.status).toBe(200)
            expect(await headRes.text()).toBe('')
        } finally {
            await stopServer()
        }
    })

    it('M8–M11 & L2/L5/L6/L8: covers author bounds, prototype guards, audit fencing, SSE send, backup cache, IPv6, ConfigResolver, IN buckets & revision', async () => {
        expect(
            TeamCreateEntrySchema.safeParse({ content: 'hello', author: 'a'.repeat(101) }).success
        ).toBe(false)

        const teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        try {
            vi.spyOn(teamDb, 'searchEntries').mockReturnValueOnce({
                entries: [
                    {
                        id: 1,
                        content: 'raw team body',
                        timestamp: '2026-11-19T00:00:00Z',
                        entryType: 'technical_note',
                        tags: [],
                        isPersonal: false,
                        author: 'Bob\x00\x07Evil',
                    } as never,
                ],
                nextCursor: undefined,
            })
            const fts = ftsSearch('raw', db, teamDb, { limit: 10, includeTeam: true })
            const teamHit = fts.entries.find((e) => e.source === 'team')
            expect(teamHit?.['author']).toBe('BobEvil')
        } finally {
            teamDb.close()
        }

        expect(() => expandTagFilterValues(['constructor', '__proto__', 'security'])).not.toThrow()
        expect(() =>
            matchRegistryByTagsOrContent(
                { content: 'hello' },
                { constructor: { project_number: 1 }, toString: { project_number: 2 } }
            )
        ).not.toThrow()

        const sanitizedAudit = sanitizeAuditEntryForEgress({
            timestamp: 'bad\nts',
            requestId: 'r1',
            tool: 'tool',
            category: 'bogus\n- x' as never,
            scope: 'read\nwrite',
            user: null,
            scopes: [],
            durationMs: 1,
            success: true,
        })
        expect(sanitizedAudit.category).toBe('read')
        expect(sanitizedAudit.timestamp).toContain('<untrusted_remote_content>')
        expect(sanitizedAudit.scope).toContain('<untrusted_remote_content>')

        const sse = new LegacySSEServerTransport('/messages', 'sess-pass43')
        sse.handleSseRequest(
            { on: vi.fn() } as unknown as Request,
            {
                writeHead: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
                writableEnded: true,
                destroyed: false,
            } as unknown as Response
        )
        await expect(sse.send({ jsonrpc: '2.0', method: 'ping' })).rejects.toThrow('Not connected')

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass43-'))
        try {
            fs.writeFileSync(path.join(tmpDir, 'a.db'), 'a')
            const fileB = path.join(tmpDir, 'b.db')
            fs.writeFileSync(fileB, 'b')
            const mgr = new BackupManager({ getBackupsDir: () => tmpDir } as never)
            expect(mgr.listBackups()).toHaveLength(2)
            fs.unlinkSync(fileB)
            expect(mgr.listBackups()).toHaveLength(1)

            const badYaml = path.join(tmpDir, 'array-config.yaml')
            fs.writeFileSync(badYaml, '- item1\n- item2\n', 'utf-8')
            expect(() => new ConfigResolver(new Command(), {}, badYaml)).toThrow(
                ConfigurationError
            )
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }

        for (const ip of ['fec0::1', '2001:2::1', '100::1', '2001:10::1']) {
            expect(isPrivateOrLoopbackAddress(ip)).toBe(true)
        }
        expect(isPrivateOrLoopbackAddress('203.0.113.1')).toBe(false)

        const bucket240 = chunkedInPredicate(
            Array.from({ length: 240 }, (_, i) => `t${String(i)}`),
            (p) => `tag IN (${p})`,
            'OR'
        )
        expect(bucket240.sql).not.toContain('json_each')
        const bucket241 = chunkedInPredicate(
            Array.from({ length: 241 }, (_, i) => `t${String(i)}`),
            (p) => `tag IN (${p})`,
            'OR'
        )
        expect(bucket241.sql).toContain('json_each(?)')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass79')
        const secDef = getSecurityAuditPromptDefinition()
        const rendered = await Promise.resolve(
            secDef.handler({ target: 'memory-journal-mcp' }, db)
        )
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-24-audit-pass79')
        expect(text).toContain('O_NOFOLLOW')
        expect(text).toContain('fec0::/10')
        expect(text).toContain('SENSITIVE_KEY_RE')
    })
})
