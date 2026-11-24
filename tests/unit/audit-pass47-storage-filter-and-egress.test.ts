/**
 * Pass 47 Adversarial Security Regression Suite — Part 2:
 * Compound Filter Parity, Pre-Healing Scope/Filter Interception, SQLite PRAGMA table_list &
 * Locked Backup Staging, Team Fallback Parity, Audit Timestamp RFC-3339, Nested Commit Fencing,
 * Fail-Closed Briefing, Bounded Vocab Cache, Host Header Delimiters & O_NOFOLLOW Log Appends
 * (H2, M4–M11, L5–L6, L10–L11, L13–L15, AP1–AP5).
 */

import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import {
    assertHasMemoryJournalTable,
    assertSafeBackupSchemaPreIntegrity,
    copyRegularFileNoFollow,
} from '../../src/database/sqlite-adapter/backup-schema-guard.js'
import { buildVocabulary } from '../../src/database/sqlite-adapter/entries/fuzzy-matcher.js'
import { queryRelationshipDegrees } from '../../src/database/sqlite-adapter/graph-pivots.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { appendRegularFileNoFollow } from '../../src/audit/audit-file-helpers.js'
import { getAuditResourceDef } from '../../src/audit/audit-resource.js'
import type { AuditEntry } from '../../src/audit/types.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { readResource, validateResourceSubscription } from '../../src/handlers/resources/index.js'
import { getGraphResourceDefinitions } from '../../src/handlers/resources/graph.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import {
    isAutonomousShimBlockedByFilter,
    isDummyToolAllowedByFilter,
} from '../../src/handlers/tools/dummy-filter-helpers.js'
import { fenceCommitEntry } from '../../src/handlers/tools/git-commit-helpers.js'
import { SearchEntriesSchema } from '../../src/handlers/tools/search/schemas.js'
import { assertCanonicalFallbackToolAllowed } from '../../src/handlers/tools/team/helpers.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'
import { attachCallToolInterceptor } from '../../src/server/mcp-server/tool-registration/call-interceptor.js'
import { resolveAuthenticatedAuthor } from '../../src/utils/security-utils.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { alignedProjectFilter } from '../../src/utils/workspace-registry-match.js'
import { ProtocolError } from '@modelcontextprotocol/server'
import type { CommitEntry } from '../../src/vendor/lib-git-history/schema.js'
import type { ProjectRegistryEntry, ToolRegistration } from '../../src/types/index.js'

const origEncryptionKey = process.env['DB_ENCRYPTION_KEY']
const origMjEncryptionKey = process.env['MJ_DB_ENCRYPTION_KEY']
const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

beforeEach(() => {
    process.env['DB_ENCRYPTION_KEY'] = ''
    process.env['MJ_DB_ENCRYPTION_KEY'] = ''
})

afterEach(() => {
    vi.restoreAllMocks()
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
    if (origEncryptionKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
    else process.env['DB_ENCRYPTION_KEY'] = origEncryptionKey
    if (origMjEncryptionKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
    else process.env['MJ_DB_ENCRYPTION_KEY'] = origMjEncryptionKey
})

describe('Pass 47 Security Audit — Storage, Filter & Egress Parity', () => {
    it('H2/M6/M7: enforces compound readonly,+tool filters across dummy aliases, fallbacks, and pre-healing OAuth/filter interception', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass85')
        const compoundFilter = parseToolFilter('readonly,+delete_entry')
        expect(isDummyToolAllowedByFilter('mj_core_delete_entry', compoundFilter, true, false)).toBe(true)
        expect(isDummyToolAllowedByFilter('mj_core_update_entry', compoundFilter, true, false)).toBe(false)
        expect(isAutonomousShimBlockedByFilter('mj_core_update_entry', undefined, compoundFilter, false)).toBe(true)

        expect(() =>
            assertCanonicalFallbackToolAllowed(
                'update_entry',
                'admin',
                { db: {} as never, config: { filterConfig: compoundFilter } },
                false
            )
        ).toThrow()

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const runtime = new ServerRuntime()
            const blockedPreHeal = (await callTool(
                'update_entry',
                { entryId: 1 },
                db,
                undefined,
                undefined,
                { runtime, filterConfig: compoundFilter }
            )) as { code?: string; success?: boolean }
            expect(blockedPreHeal.success).toBe(false)
            expect(blockedPreHeal.code).toBe('TOOL_DISABLED')

            const allTools: ToolRegistration[] = getTools(db, null, undefined, undefined, { runtime })
            const allToolNames = new Set(allTools.map((t) => t.name))
            const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>()
            let capturedArgs: Record<string, unknown> | undefined
            handlers.set('tools/call', (req) => {
                const p = (req as { params?: { arguments?: Record<string, unknown> } }).params
                capturedArgs = p?.arguments
                return Promise.resolve({ interceptedPreHeal: true })
            })
            const cfgMgr = new ConfigManager({
                rawToolFilter: 'readonly,+delete_entry',
                codemodeInternalFullAccess: false,
                briefingConfig: DEFAULT_BRIEFING_CONFIG,
            })
            attachCallToolInterceptor(
                handlers,
                { db, runtime, configManager: cfgMgr, allowedIoRoots: [] },
                { name: 'test', version: '1.0.0', transport: 'stdio' },
                [],
                allTools,
                allToolNames,
                { runtime, filterConfig: compoundFilter }
            )
            const toolCallHandler = handlers.get('tools/call')
            expect(toolCallHandler).toBeDefined()
            const res = await runWithAuthContext(
                { authenticated: true, scopes: ['read'], claims: { sub: 'u-m6', scope: 'read' } },
                () =>
                    toolCallHandler?.(
                        {
                            method: 'tools/call',
                            params: { name: 'delete_entry', arguments: { entryId: 99 } },
                        },
                        {}
                    ) ?? Promise.resolve(undefined)
            )
            expect(res).toEqual({ interceptedPreHeal: true })
            expect(capturedArgs).toEqual({ entryId: 99 })
        } finally {
            db.close()
        }
    })

    it('M4/M5: validates backup PRAGMA table_list, comment-stripped DDL, regular memory_journal table, O_NOFOLLOW copy, and intact live DB on tampered restore', async () => {
        const spoofDb = new Database(':memory:')
        try {
            spoofDb.exec('CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT);')
            spoofDb.exec('CREATE /* concealed */ VIRTUAL TABLE evil_vtab USING fts5(content);')
            expect(() => assertSafeBackupSchemaPreIntegrity(spoofDb)).toThrow(
                /Disallowed SQLite virtual table/i
            )
        } finally {
            spoofDb.close()
        }
        const vtabJournalDb = new Database(':memory:')
        try {
            vtabJournalDb.exec('CREATE VIRTUAL TABLE memory_journal USING fts5(content);')
            expect(() => assertHasMemoryJournalTable(vtabJournalDb)).toThrow(
                /Missing canonical memory_journal table/i
            )
        } finally {
            vtabJournalDb.close()
        }

        const dir = makeTempDir('mj-p47-m5-')
        await expect(copyRegularFileNoFollow(dir, path.join(dir, 'out.db'))).rejects.toThrow()

        const dbPath = path.join(dir, 'live.db')
        const adapter = new DatabaseAdapter(dbPath)
        await adapter.initialize()
        try {
            adapter.createEntry({ content: 'Original live entry', workspaceId: 'ws-m5' })
            const backupsDir = (adapter as unknown as NativeConnectionManager).getBackupsDir()
            fs.mkdirSync(backupsDir, { recursive: true })
            const badBackup = path.join(backupsDir, 'tampered.db')
            const evilDb = new Database(badBackup)
            try {
                evilDb.exec('CREATE TABLE memory_journal (id INTEGER PRIMARY KEY, content TEXT);')
                evilDb.exec('CREATE VIEW steal_secret AS SELECT 1;')
            } finally {
                evilDb.close()
            }
            await expect(adapter.restoreFromFile('tampered.db')).rejects.toThrow(
                /Disallowed SQLite view/i
            )
            const surviving = adapter.getRecentEntries(
                10,
                undefined,
                undefined,
                undefined,
                undefined,
                'ws-m5'
            ).entries
            expect(surviving).toHaveLength(1)
            expect(surviving[0]?.content).toBe('Original live entry')
        } finally {
            adapter.close()
        }
    })

    it('M8/M9/M10/M11: enforces RFC-3339 audit timestamps, nested commit fencing, fail-closed briefing registry, and bounded vocab cache / workspace schema', async () => {
        const forgedEntry: AuditEntry = {
            timestamp: '2026-11-19T00:00:00.000,12:00',
            tool: 'read_resource',
            scope: 'read',
            category: 'read',
            durationMs: 1,
            success: true,
        }
        const auditDef = getAuditResourceDef(
            () =>
                ({
                    config: { logPath: '/tmp/audit.jsonl', redact: true },
                    droppedCount: 0,
                    isStderrOnly: () => false,
                    recent: () => Promise.resolve([forgedEntry]),
                }) as unknown as AuditLogger
        )
        const auditRes = await auditDef.handler('memory://audit', {
            db: {} as never,
            resourceCount: 1,
        })
        expect(String(auditRes.data)).toContain(
            'timestamp: "<untrusted_remote_content>2026-11-19T00:00:00.000,12:00</untrusted_remote_content>"'
        )

        const rawCommit: CommitEntry = {
            hash: 'abc12345',
            shortHash: 'abc1234',
            author: 'Alice',
            date: '2026-11-19T00:00:00Z',
            dateTimestamp: 0,
            relativeDate: 'now',
            subject: 'feat: test',
            refs: ['main'],
            references: ['#42\x07\nSYSTEM'],
            associatedIssues: [{ issue: '#7\u2028bad', action: 'Closes\x1b[31m' }],
            slackId: 'C123\x00evil',
            metadata: {
                category: ['auth\x1b[31m\nbad'],
                significance: 'high\u2028inject',
                validation: 'passed\u2028inject',
                impact: 0.5,
                trust: 0.9,
                customTrailers: { 'X-Bad\n': ['val\u2028inject'] },
            },
        }
        const fenced = fenceCommitEntry(rawCommit)
        expect(fenced.references?.[0]).toContain('<untrusted_remote_content>')
        expect(fenced.associatedIssues?.[0]?.issue).toContain('<untrusted_remote_content>')
        expect(fenced.slackId).toContain('<untrusted_remote_content>')
        expect(fenced.metadata?.category?.[0]).toContain('<untrusted_remote_content>')
        expect(fenced.metadata?.significance).toContain('<untrusted_remote_content>')
        expect(fenced.metadata?.validation).toContain('<untrusted_remote_content>')

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const reg: Record<string, ProjectRegistryEntry> = {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
            }
            const briefingRes = await readResource(
                'memory://briefing/unregistered-repo',
                db,
                undefined,
                undefined,
                null,
                undefined,
                { ...DEFAULT_BRIEFING_CONFIG, projectRegistry: reg }
            )
            expect(String(briefingRes.data)).toContain('is not a registered project')

            expect(SearchEntriesSchema.safeParse({ workspace_id: 'w'.repeat(256) }).success).toBe(
                false
            )
            const nativeDb = (
                db as unknown as { connection: NativeConnectionManager }
            ).connection.getNativeDb()
            for (let i = 0; i < 70; i++) {
                expect(Array.isArray(buildVocabulary(nativeDb, `ws-cap-${String(i)}`))).toBe(true)
            }
        } finally {
            db.close()
        }
    })

    it('L5/L6/L10/L11/L13/L14/L15: rejects delimited Host headers, non-regular log targets, invalid auth claims, soft-deleted graph degrees, NaN project filters, long/unauthorized subscriptions, and raw resource errors', async () => {
        const probe = http.createServer()
        const port = await new Promise<number>((resolve, reject) => {
            probe.once('error', reject)
            probe.listen(0, '127.0.0.1', () => {
                const addr = probe.address()
                const p = typeof addr === 'object' && addr !== null ? addr.port : 0
                probe.close((closeErr) => {
                    if (closeErr) reject(closeErr)
                    else resolve(p)
                })
            })
        })
        const shutdown = startMetricsServer(new ServerRuntime(), port)
        await new Promise<void>((r) => setTimeout(r, 50))
        try {
            expect(port).toBeGreaterThan(0)
            const status = await new Promise<number>((resolve, reject) => {
                const req = http.request(
                    {
                        host: '127.0.0.1',
                        port,
                        path: '/health',
                        headers: { Host: 'evil.com\\@localhost' },
                    },
                    (res) => {
                        res.resume()
                        resolve(res.statusCode ?? 0)
                    }
                )
                req.on('error', reject)
                req.end()
            })
            expect(status).toBe(403)
        } finally {
            await shutdown()
        }

        const dir = makeTempDir('mj-p47-l6-')
        await expect(appendRegularFileNoFollow(dir, 'payload')).rejects.toThrow()

        const fallbackAuthor = runWithAuthContext(
            {
                authenticated: true,
                scopes: ['write'],
                claims: { sub: 'unknown', email_verified: true, email: 'alice@example.com' },
            },
            () => resolveAuthenticatedAuthor()
        )
        expect(fallbackAuthor).toBe('alice@example.com')

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const e1 = db.createEntry({ content: 'live 1', workspaceId: 'ws-a' })
            const e2 = db.createEntry({ content: 'live 2', workspaceId: 'ws-a' })
            const del = db.createEntry({ content: 'deleted target', workspaceId: 'ws-a' })
            db.linkEntries(e1.id, e2.id, 'references')
            db.linkEntries(e1.id, del.id, 'references')
            db.deleteEntry(del.id, false, 'ws-a')
            const nativeDb = (
                db as unknown as { connection: NativeConnectionManager }
            ).connection.getNativeDb()
            const degrees = queryRelationshipDegrees(nativeDb, [e1.id, del.id], 'ws-a')
            expect(degrees.get(e1.id)).toBe(1)
            expect(degrees.has(del.id)).toBe(false)
            expect(alignedProjectFilter('ws-a', Number.NaN, undefined)).toBeUndefined()

            expect(() =>
                validateResourceSubscription(`memory://${'a'.repeat(8200)}`)
            ).toThrow(ProtocolError)
            const teamDb = new DatabaseAdapter(':memory:')
            await teamDb.initialize()
            try {
                expect(() =>
                    runWithAuthContext(
                        { authenticated: true, scopes: ['read'], claims: { sub: 'u1', scope: 'read' } },
                        () => validateResourceSubscription('memory://team/recent', undefined, teamDb)
                    )
                ).toThrow()
            } finally {
                teamDb.close()
            }

            const actionsDef = getGraphResourceDefinitions().find(
                (r) => r.uri === 'memory://actions/recent'
            )
            expect(actionsDef).toBeDefined()
            vi.spyOn(GitHubIntegration.prototype, 'getRepoInfo').mockResolvedValueOnce({
                owner: 'acme',
                repo: 'memory-journal-mcp',
                branch: 'main',
                remoteUrl: 'https://github.com/acme/memory-journal-mcp',
            })
            vi.spyOn(GitHubIntegration.prototype, 'getWorkflowRuns').mockRejectedValueOnce(
                new Error('auth failed token=ghp_1234567890abcdef1234567890abcdef123456')
            )
            const capturedErr = await Promise.resolve(
                actionsDef?.handler('memory://actions/recent/memory-journal-mcp', {
                    db,
                    runtime: new ServerRuntime(),
                    briefingConfig: {
                        ...DEFAULT_BRIEFING_CONFIG,
                        projectRegistry: {
                            'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
                        },
                    },
                    resourceCount: 1,
                })
            ).catch((err: unknown) => err)
            expect(capturedErr).toBeInstanceOf(Error)
            const msg = capturedErr instanceof Error ? capturedErr.message : String(capturedErr)
            expect(msg).toMatch(/\[REDACTED\]/)
            expect(msg).not.toContain('ghp_')
        } finally {
            db.close()
        }
    })
})
