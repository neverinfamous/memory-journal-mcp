import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import { Command } from 'commander'
import type { Request, Response } from 'express'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockHttpsRequestFn } = vi.hoisted(() => ({
    mockHttpsRequestFn: vi.fn(),
}))

vi.mock('node:https', async (importOriginal) => {
    const orig = await importOriginal<typeof import('node:https')>()
    return { ...orig, default: { ...orig, request: mockHttpsRequestFn }, request: mockHttpsRequestFn }
})

vi.mock('node:dns', async (importOriginal) => {
    const orig = await importOriginal<typeof import('node:dns')>()
    return {
        ...orig,
        promises: {
            ...orig.promises,
            lookup: vi.fn().mockResolvedValue([{ address: '203.0.113.1', family: 4 }]),
        },
    }
})

import { AuthorizationServerDiscovery } from '../../src/auth/authorization-server-discovery.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { handlePrometheusMetrics } from '../../src/transports/http/handlers.js'
import { createPostHandler } from '../../src/transports/http/server/protocol-route-handlers.js'
import { resolveRequestSubject } from '../../src/transports/http/server/session-creator.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { formatPrometheusMetrics } from '../../src/observability/prometheus-formatter.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { isPrivateOrLoopbackAddress } from '../../src/utils/network-safety.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { logger } from '../../src/utils/logger.js'
import { McpLogger } from '../../src/utils/mcp-logger.js'
import { redactConfig } from '../../src/cli/dump-config.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import {
    isSensitiveAuditTarget,
    resolveResourceAuditCategory,
    searchAuditFileBackward,
} from '../../src/audit/audit-query-helpers.js'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { resolveValidatedRestorePath } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { applySqlCipherKey } from '../../src/database/sqlite-adapter/sqlcipher-key.js'
import { assertSafeDirectoryPath, PathTraversalError } from '../../src/utils/path-safety.js'
import { coerceNumber, coerceLimit, buildLimitClause } from '../../src/utils/query-helpers.js'
import { markUntrustedContent, markUntrustedContentInline, sanitizeErrorForLogging } from '../../src/utils/security-utils.js'
import { parseFrontmatter } from '../../src/markdown/frontmatter.js'
import { linkImportedRelationships } from '../../src/markdown/import-relationships.js'
import { transformOutsideCodeFences } from '../../src/markdown/converters/utils.js'
import { fetchCommits } from '../../src/handlers/tools/git-commit-helpers.js'
import { parseRepoSlug } from '../../src/handlers/tools/github/repo-scope-helpers.js'
import { metricsResourcesResource } from '../../src/handlers/resources/core/metrics-resource.js'
import { getTeamMemberTools } from '../../src/handlers/tools/team/member-tools.js'
import { getTeamAliasTools } from '../../src/handlers/tools/team/alias-tools.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import { ConfigurationError, ValidationError } from '../../src/types/errors.js'

function mockJsonDiscovery(payload: unknown): void {
    const req = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    req.end = vi.fn()
    req.destroy = vi.fn()
    const res = new EventEmitter() as EventEmitter & { statusCode: number; statusMessage: string }
    res.statusCode = 200
    res.statusMessage = 'OK'
    mockHttpsRequestFn.mockImplementationOnce((_u: unknown, _o: unknown, cb: (r: unknown) => void) => {
        process.nextTick(() => {
            cb(res)
            res.emit('data', Buffer.from(JSON.stringify(payload)))
            res.emit('end')
        })
        return req
    })
}

function httpGetRaw(port: number, reqPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: reqPath, method: 'GET', headers }, (res) => {
            let body = ''
            res.on('data', (c: Buffer) => {
                body += c.toString('utf8')
            })
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        })
        req.on('error', reject)
        req.end()
    })
}

describe('Pass 42 Security Audit — Transport, SSRF, Storage, Audit & Fencing', () => {
    const tempDirs: string[] = []
    let savedEncKey: string | undefined
    let savedMjEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['DB_ENCRYPTION_KEY']
        savedMjEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        process.env['DB_ENCRYPTION_KEY'] = ''
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEncKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
        else process.env['DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedMjEncKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
        else process.env['MJ_DB_ENCRYPTION_KEY'] = savedMjEncKey
        delete process.env['TEST_PASS42_WS']
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('M1/M14: rejects dangling symlinks, preserves PathTraversalError on restore before .db ValidationError, and enforces integer DB bounds', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass42-io-'))
        tempDirs.push(root)
        const backupsDir = path.join(root, 'backups')
        fs.mkdirSync(backupsDir, { recursive: true })
        fs.writeFileSync(path.join(backupsDir, 'bad.txt'), 'not-sqlite')
        fs.mkdirSync(path.join(backupsDir, 'dir.db'))

        await expect(resolveValidatedRestorePath(backupsDir, '../../../etc/passwd')).rejects.toThrow(PathTraversalError)
        await expect(resolveValidatedRestorePath(backupsDir, 'bad.txt')).rejects.toThrow(ValidationError)
        await expect(resolveValidatedRestorePath(backupsDir, 'dir.db')).rejects.toThrow(ValidationError)

        const danglingLink = path.join(root, 'dangling-link')
        let createdSymlink = false
        try {
            fs.symlinkSync(path.join(root, 'missing-target'), danglingLink, 'dir')
            createdSymlink = true
        } catch {
            // Windows without Developer Mode may forbid symlink creation cleanly
        }
        if (createdSymlink) {
            expect(() => assertSafeDirectoryPath(path.join(danglingLink, 'sub'), [root])).toThrow(PathTraversalError)
        }

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const created = db.createEntry({ content: 'hello', workspaceId: 'alpha', projectNumber: 5 })
            expect(db.getActiveEntryCount('alpha', 0)).toBe(0)
            expect(db.getDeletedEntries({ workspaceId: 'alpha', projectNumber: 1.5 })).toEqual({ entries: [], count: 0 })
            expect(db.updateAnchorStatus(created.id, 'stale', 'alpha', 0)).toBe(false)
            expect(db.getAuthorStatistics('alpha', -1)).toEqual([])
            expect(db.listTags('alpha', -2)).toEqual([])
            expect(() => db.mergeTags('a', 'b', 'alpha', 0)).toThrow(ValidationError)
        } finally {
            db.close()
        }

        expect(coerceNumber('Infinity')).toBeUndefined()
        expect(coerceLimit('Infinity', 25)).toBe(25)
        expect(buildLimitClause(10)).toBe(' LIMIT 10')
        expect(() => buildLimitClause(-1)).toThrow(RangeError)
    })

    it('M7/M8/M13: gates Prometheus user breakdown PII, rejects placeholder metrics tokens, checks URL host, and rejects unparsed POST bodies with 415', async () => {
        const metrics = new MetricsAccumulator()
        metrics.record({ toolName: 'get_recent_entries', durationMs: 5, inputTokens: 1, outputTokens: 1, isError: false })
        metrics.recordUser('alice')
        expect(formatPrometheusMetrics(metrics, { includeUserBreakdown: false })).not.toContain('mcp_user_calls_total')
        expect(formatPrometheusMetrics(metrics, { includeUserBreakdown: true })).toContain('mcp_user_calls_total')

        const headers = new Map<string, string>()
        const res = {
            set: vi.fn((k: string, v: string) => {
                headers.set(k.toLowerCase(), v)
            }),
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
        } as unknown as Response
        const runtime = { metrics } as unknown as ServerRuntime
        handlePrometheusMetrics(runtime)({} as Request, res)
        expect(res.send).toHaveBeenCalledWith(expect.not.stringContaining('mcp_user_calls_total'))
        expect(headers.get('cache-control')).toBe('no-store')
        expect(headers.get('x-content-type-options')).toBe('nosniff')

        runWithAuthContext({ authenticated: true, scopes: ['audit'], claims: { sub: 'alice', scopes: ['audit'], exp: 9999999999, iat: 1 } }, () => {
            handlePrometheusMetrics(runtime)({} as Request, res)
        })
        expect(res.send).toHaveBeenLastCalledWith(expect.stringContaining('mcp_user_calls_total{user="alice"}'))

        expect(() => startMetricsServer(runtime, 0, { authToken: 'change_this_to_a_secure_token_for_production' })).toThrow(/Default auth token/)
        const stop = startMetricsServer(runtime, 0, { authToken: 'pass42-token' })
        // Binding directly requires waiting only if port>0; verify createPostHandler 415 on unparsed non-JSON body
        await stop()

        const postHandler = createPostHandler(
            { config: { stateless: true }, serverFactory: vi.fn(), activeServers: new Set(), sseTransports: new Map(), sessionOwners: new Map(), sessionLastActivity: new Map() } as never,
            vi.fn(),
            () => true,
            vi.fn() as never
        )
        let statusOut = 200
        const postRes = {
            status: (code: number) => {
                statusOut = code
                return postRes
            },
            json: vi.fn(),
        } as unknown as Response
        postHandler({ body: undefined, headers: { 'content-length': '20' } } as unknown as Request, postRes, vi.fn())
        expect(statusOut).toBe(415)

        const realRuntime = new ServerRuntime()
        const stopPort = startMetricsServer(realRuntime, 49465, { authToken: 'p42-secret' })
        try {
            const badHost = await httpGetRaw(49465, '/metrics', { Host: 'evil@127.0.0.1:49465', Authorization: 'Bearer p42-secret' })
            expect(badHost.status).toBe(403)
        } finally {
            await stopPort()
        }
    })

    it('M9/M10/M11/M12: validates IPv6 SSRF ranges, metadata discovery, whitespace env/sub, multi-byte UTF-8 audit reads, SQLCipher hex keys, and secret scrubbing', async () => {
        expect(isPrivateOrLoopbackAddress('0064:ff9b::1')).toBe(true)
        expect(isPrivateOrLoopbackAddress('2001:0000::1')).toBe(true)
        expect(isPrivateOrLoopbackAddress('224.0.0.1')).toBe(true)
        expect(isPrivateOrLoopbackAddress('240.0.0.1')).toBe(true)
        expect(isPrivateOrLoopbackAddress('203.0.113.1')).toBe(false)

        mockJsonDiscovery({ issuer: 'https://auth.example.com', token_endpoint: 'http://127.0.0.1/token' })
        const discovery = new AuthorizationServerDiscovery({ authServerUrl: 'https://auth.example.com' })
        await expect(discovery.discover()).rejects.toThrow(/https:/)

        runWithAuthContext({ authenticated: true, scopes: ['read'], claims: { sub: '   ', scopes: ['read'], exp: 9999999999, iat: 1 } }, () => {
            expect(resolveRequestSubject()).toBeUndefined()
        })
        runWithAuthContext({ authenticated: true, scopes: ['read'], claims: { sub: ' alice ', scopes: ['read'], exp: 9999999999, iat: 1 } }, () => {
            expect(resolveRequestSubject()).toBe('alice')
        })

        expect(isSensitiveAuditTarget('memory://metrics/users')).toBe(true)
        expect(resolveResourceAuditCategory('memory://metrics/users')).toBe('audit')
        expect(resolveResourceAuditCategory('optimize-journal')).toBe('admin')

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass42-audit-'))
        tempDirs.push(dir)
        const logFile = path.join(dir, 'audit.jsonl')
        const bigPad = 'a'.repeat(65_530)
        const multiByteLine = JSON.stringify({
            timestamp: '2026-11-18T00:00:00Z',
            requestId: 'r1',
            tool: 'test_tool',
            category: 'read',
            scope: 'read',
            user: null,
            scopes: [],
            durationMs: 1,
            success: true,
            error: `${bigPad}🚀🎉`,
        })
        fs.writeFileSync(logFile, `${multiByteLine}\n`, 'utf-8')
        const found: unknown[] = []
        await searchAuditFileBackward(logFile, {}, 10, found)
        expect(found.length).toBe(1)

        const sanitizedEntry = sanitizeAuditEntryForEgress({
            timestamp: '2026-11-18T00:00:00Z',
            requestId: 'bad\n<id>',
            tool: 'tool',
            category: 'read',
            scope: 'read',
            user: null,
            scopes: [],
            durationMs: 1,
            success: false,
            error: 'boom',
        })
        expect(sanitizedEntry.requestId).toContain('<untrusted_remote_content>')

        process.env['TEST_PASS42_WS'] = '   '
        const cmd = new Command().option('--stateless')
        const resolver = new ConfigResolver(cmd, { stateless: ' false ' })
        expect(resolver.resolve('stateless', 'TEST_PASS42_WS')).toBe(' false ')
        expect(resolver.resolveBool('stateless')).toBe(false)
        const typoResolver = new ConfigResolver(cmd, { stateless: 'flase' })
        expect(() => typoResolver.resolveBool('stateless')).toThrow(ConfigurationError)

        process.env['DB_ENCRYPTION_KEY'] = "X'ABCD'"
        const fakeDb = { pragma: vi.fn() }
        applySqlCipherKey(fakeDb as never)
        expect(fakeDb.pragma).toHaveBeenCalledWith("key = x'ABCD'")
        process.env['DB_ENCRYPTION_KEY'] = "x'abc'"
        expect(() => applySqlCipherKey(fakeDb as never)).toThrow(/Invalid hex encryption key/)

        expect(sanitizeErrorForLogging('run --auth-token supersecret')).toBe('run --auth-token [REDACTED]')
        expect(redactConfig({ nested: ['--secret=myval'], token: 'abc' })).toEqual({
            nested: ['--secret=[REDACTED]'],
            token: '[REDACTED]',
        })
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        logger.warning('hi', { apiKey: 'secret123' })
        const mcpLog = new McpLogger()
        mcpLog.warning('hi', { err: new Error('Bearer tok-123'), accessToken: 'secret123' })
        const stderrOut = errSpy.mock.calls.map((c) => String(c[0])).join('')
        expect(stderrOut).not.toContain('secret123')
        expect(stderrOut).not.toContain('tok-123')
    })

    it('M15/M16/L8/AP7: enforces git/GitHub guards, C0/C1 stripping, team author sanitization without mutating content/canonical URIs, and pass42 revision', async () => {
        await expect(fetchCommits({ ref: '--exec=evil' }, process.cwd())).rejects.toThrow(ValidationError)
        expect(parseRepoSlug('https://evil.com/owner/repo').invalidPath).toBe(true)
        expect(parseRepoSlug('../..').invalidPath).toBe(true)
        expect(parseRepoSlug('https://github.com/octocat/hello-world')).toEqual({
            owner: 'octocat',
            repo: 'hello-world',
            rawInput: 'https://github.com/octocat/hello-world',
        })

        expect(markUntrustedContent('hi\u0007there')).toBe('<untrusted_remote_content>\nhithere\n</untrusted_remote_content>')
        expect(markUntrustedContentInline('hi\u001bthere')).toBe('<untrusted_remote_content>hithere</untrusted_remote_content>')

        const dummyRuntime = new ServerRuntime()
        dummyRuntime.metrics.recordResourceRead('memory://health', false)
        dummyRuntime.metrics.recordResourceRead('memory://bad<tag>', false)
        const resOut = await Promise.resolve(metricsResourcesResource.handler('memory://metrics/resources', { runtime: dummyRuntime } as never))
        expect(String(resOut.data)).toContain('- uri: memory://health')
        expect(String(resOut.data)).toContain('<untrusted_remote_content>')

        const memberTools = getTeamMemberTools({
            teamDb: {
                addTeamMember: () => ({ id: 1, author: 'alice\u0007', role: 'admin', displayName: 'Al\u0000', addedBy: 'bob\u0007', createdAt: '', updatedAt: '' }),
                listTeamMembers: () => [{ id: 1, author: 'alice\u0007', role: 'admin', displayName: null, addedBy: null, createdAt: '', updatedAt: '' }],
                listAuthorAliases: () => [],
            } as never,
        } as never)
        const added = await Promise.resolve(memberTools.find((t) => t.name === 'team_add_member')?.handler({ author: 'alice', role: 'admin' })) as { member: { author: string; displayName: string } }
        expect(added.member.author).toBe('alice')
        expect(added.member.displayName).toBe('Al')

        const aliasTools = getTeamAliasTools({
            teamDb: {
                listAuthorAliases: () => [{ id: 1, alias: 'bob\u0007', canonicalAuthor: 'alice\u0007', createdAt: '', createdBy: null }],
            } as never,
        } as never)
        const listedAliases = await Promise.resolve(aliasTools.find((t) => t.name === 'team_list_author_aliases')?.handler({ project_number: 1 })) as { aliases: { alias: string; canonicalAuthor: string }[] }
        expect(listedAliases.aliases[0]?.alias).toBe('bob')

        expect(() => parseFrontmatter(`---\n${JSON.stringify({ tags: ['a'] }).padEnd(100_005, ' ')}\n---\nbody`)).toThrow(/100KB/)
        const mockRelDb = { getRelationships: () => [] }
        expect(linkImportedRelationships(mockRelDb as never, 1, [{ type: 'references', target_id: -5 }], undefined, new Map()).missingTargets).toEqual([-5])
        expect(transformOutsideCodeFences('prose `x`\n```\nkeep\n```\nend', (s) => s.toUpperCase())).toContain('PROSE')

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-20-audit-pass51')
        const secDef = getSecurityAuditPromptDefinition()
        const rendered = await Promise.resolve(
            secDef.handler({ target: 'memory-journal-mcp' }, { searchByDateRange: () => ({ entries: [] }) } as never)
        )
        expect(rendered.messages[0]?.content.text).toContain('Prompt revision: 2026-11-20-audit-pass51')
    })
})
