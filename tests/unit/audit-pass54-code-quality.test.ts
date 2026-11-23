/**
 * Pass 54 Adversarial Code-Quality Audit Regression Tests
 * Covers H1, M1–M9, L1–L8, and AP1–AP2.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { extractAndRecoverEntryCode } from '../../src/handlers/tools/codemode/json-entry-recovery.js'
import { cleanSqlText } from '../../src/codemode/sql-positional-binder.js'
import {
    createCallableShim,
    wrapDelegatingTool,
    createSchemaShim,
    createEmptyFallback,
} from '../../src/codemode/worker/namespace-shims.js'
import {
    createAdaptersShim,
    createDbDomainProxy,
    createSystemDatabaseDomainProxy,
} from '../../src/codemode/worker/mj-shim-db-domains.js'
import { createFactoryFnProxy, createUnknownGroupRejectionProxy } from '../../src/codemode/proxy-helpers.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { coerceNumericValue } from '../../src/codemode/api/key-normalizer-postprocess.js'
import { CodeModeSecurityManager } from '../../src/codemode/security.js'
import {
    extractAuditScopeFromArgs,
    extractAuditScopeFromUri,
} from '../../src/audit/audit-query-helpers.js'
import { scrubAuditArgs } from '../../src/audit/audit-arg-scrubber.js'
import { sanitizeAuditEntryForEgress } from '../../src/audit/audit-resource.js'
import { formatHandlerError } from '../../src/utils/error-helpers.js'
import { MemoryJournalMcpError } from '../../src/types/errors.js'
import { sanitizeIssueInput } from '../../src/utils/issue-logger.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { convertLogseq } from '../../src/markdown/converters/logseq.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver-session.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { getCoreTools } from '../../src/handlers/tools/core/tools.js'
import { getAnalyticsTools } from '../../src/handlers/tools/analytics.js'
import { getAgentContextResource } from '../../src/handlers/resources/core/agent-context.js'
import { getGitHubResourceDefinitions } from '../../src/handlers/resources/github.js'
import { getRelationshipTools } from '../../src/handlers/tools/relationships.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/database-adapter.js'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import type { ToolContext } from '../../src/types/index.js'
import type { ResourceContext } from '../../src/handlers/resources/shared.js'

function assertImmutableProxy(proxy: object): void {
    expect(Object.isExtensible(proxy)).toBe(true)
    expect(() => Object.preventExtensions(proxy)).toThrow(TypeError)
    expect(() => {
        ;(proxy as Record<string, unknown>)['__polluted'] = 1
    }).toThrow(TypeError)
    expect(() => Object.defineProperty(proxy, '__polluted', { value: 1 })).toThrow(TypeError)
    expect(() => {
        delete (proxy as Record<string, unknown>)['name']
    }).toThrow(TypeError)
    expect(() => Object.setPrototypeOf(proxy, {})).toThrow(TypeError)
}

describe('Pass 54 Adversarial Code-Quality Regressions', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        setActiveSessionProject(null, null)
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('H1: ignores commented-out .prepare(DELETE) and recovers live .prepare(SELECT)', () => {
        const code = [
            '// db.prepare("DELETE FROM memory_journal WHERE id = 1").run();',
            'const row = db.prepare("SELECT * FROM memory_journal WHERE id = ?").get(2);',
        ].join('\n')
        const recovered = extractAndRecoverPreparedStatementCode(code)
        expect(recovered).not.toBeNull()
        expect(recovered).toContain('mj.core.getEntryById')
        expect(recovered).not.toContain('deleteEntry')
    })

    it('M1: enforces IMMUTABLE_PROXY_TRAPS on shim/helper/revisions proxies and preserves Symbol reads', () => {
        const shimMj: Record<string, unknown> = {}
        const sym = Symbol('tag')
        const wrapped = wrapResult({
            history: [{ revisionId: 1, content: 'hi', [sym]: 'ok' }],
        }) as { revisions: Array<Record<string | symbol, unknown>> }
        const revisions = wrapped.revisions
        expect(revisions[0]?.[sym]).toBe('ok')

        for (const proxy of [
            createCallableShim(shimMj),
            wrapDelegatingTool(() => undefined, () => undefined) as object,
            createSchemaShim(shimMj),
            createEmptyFallback() as object,
            createAdaptersShim('adapters'),
            createDbDomainProxy(shimMj, shimMj),
            createSystemDatabaseDomainProxy(shimMj, shimMj),
            createFactoryFnProxy(shimMj),
            createUnknownGroupRejectionProxy('nope', 'bad'),
            revisions[0] as object,
        ]) {
            assertImmutableProxy(proxy)
        }
    })

    it('M2: cleanSqlText preserves -- and /* */ inside SQL string literals', () => {
        const sql =
            "-- leading comment\nINSERT INTO memory_journal (content) VALUES ('keep /* comment */ and\n-- dash line') /* trailing */"
        const cleaned = cleanSqlText(sql)
        expect(cleaned).toBe(
            "INSERT INTO memory_journal (content) VALUES ('keep /* comment */ and\n-- dash line')"
        )
    })

    it('M3: ignores commented workspace_id and project_number during fuzzy entry recovery', () => {
        const code = [
            "mj.core.createEntry({",
            "  // workspace_id: 'evil-ws', project_number: 999,",
            "  content: 'hello world',",
            "  workspace_id: 'real-ws',",
            "  project_number: 5",
            ")",
        ].join('\n')
        const recovered = extractAndRecoverEntryCode(code)
        expect(recovered).not.toBeNull()
        expect(recovered).toContain('"workspace_id":"real-ws"')
        expect(recovered).toContain('"project_number":5')
        expect(recovered).not.toContain('evil-ws')
    })

    it('M4: prevents session projectNumber bleed across workspaces and preserves wildcard audit queries', () => {
        const reqCtx = { ephemeralSessionProject: { workspaceId: 'alpha', projectNumber: 11 } }
        expect(extractAuditScopeFromArgs({ workspace_id: 'beta' }, reqCtx)).toEqual({
            workspaceId: 'beta',
        })
        expect(extractAuditScopeFromArgs({ workspace_id: '*' }, reqCtx)).toEqual({})
        expect(extractAuditScopeFromUri('memory://audit?workspace_id=beta', reqCtx)).toEqual({
            workspaceId: 'beta',
        })
        expect(extractAuditScopeFromUri('memory://audit?workspace_id=*', reqCtx)).toEqual({})
        expect(
            extractAuditScopeFromUri('memory://audit?workspace_id=*&project_number=7', reqCtx)
        ).toEqual({
            projectNumber: 7,
        })
        expect(extractAuditScopeFromArgs({}, reqCtx)).toEqual({
            workspaceId: 'alpha',
            projectNumber: 11,
        })
    })

    it('M5 & M6 & L1: sanitizers handle Date, Invalid Date, URL, Error, and bigint safely', () => {
        const validDate = new Date('2026-11-20T00:00:00.000Z')
        const invalidDate = new Date('not-a-date')
        const url = new URL('https://example.com/path')
        const err = new Error('boom')

        const mcpErr = new MemoryJournalMcpError('failed', 'INTERNAL_ERROR', 'internal', {
            details: { validDate, invalidDate, url, big: 42n },
        })
        const formatted = formatHandlerError(mcpErr)
        expect(formatted.details).toEqual({
            validDate: '2026-11-20T00:00:00.000Z',
            invalidDate: 'Invalid Date',
            url: 'https://example.com/path',
            big: '42',
        })
        expect(() => JSON.stringify(formatted)).not.toThrow()

        const issueClean = sanitizeIssueInput({ validDate, invalidDate, url, err }) as Record<string, unknown>
        expect(issueClean['validDate']).toBe('2026-11-20T00:00:00.000Z')
        expect(issueClean['invalidDate']).toBe('Invalid Date')
        expect(issueClean['url']).toBe('https://example.com/path')
        expect(issueClean['err']).toBe('Error: boom')

        const auditArg = scrubAuditArgs({ validDate, invalidDate, url }) as Record<string, unknown>
        expect(auditArg['validDate']).toBe('2026-11-20T00:00:00.000Z')
        expect(auditArg['invalidDate']).toBe('Invalid Date')
        expect(auditArg['url']).toBe('https://example.com/path')

        const egress = sanitizeAuditEntryForEgress({
            timestamp: '2026-11-20T00:00:00.000Z',
            tool: 'test_tool',
            scope: 'read',
            category: 'core',
            durationMs: 1,
            success: true,
            args: { invalidDate, url },
        })
        const egressArgs = egress.args as Record<string, unknown>
        expect(egressArgs['invalidDate']).toBe('Invalid Date')
        expect(String(egressArgs['url'])).toContain('https://example.com/path')
    })

    it('M7: acquireRestoreLock reclaims orphaned empty lock directory in fallback path', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-lock-p54-'))
        tempDirs.push(tmp)
        const lockDir = path.join(tmp, 'restore.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir)
        const past = new Date(Date.now() - 60_000)
        fs.utimesSync(lockDir, past, past)

        const origRename = fs.renameSync
        const renameSpy = Object.getOwnPropertyDescriptor(fs, 'renameSync')
        if (renameSpy?.configurable === true) {
            Object.defineProperty(fs, 'renameSync', {
                value: () => {
                    const e = new Error('EXDEV') as NodeJS.ErrnoException
                    e.code = 'EXDEV'
                    throw e
                },
                configurable: true,
            })
        }
        try {
            expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).not.toThrow()
            expect(fs.existsSync(lockFile)).toBe(true)
        } finally {
            if (renameSpy?.configurable === true) {
                Object.defineProperty(fs, 'renameSync', { value: origRename, configurable: true })
            }
        }
    })

    it('M8: memory://github/status/{owner}/{repo} resolves registered short-name Kanban project', async () => {
        let kanbanCalledWith: number | undefined
        const infoSpy = vi
            .spyOn(GitHubIntegration.prototype, 'getRepoInfo')
            .mockResolvedValue({ owner: 'neverinfamous', repo: 'short-repo', branch: 'main' })
        const ctxSpy = vi.spyOn(GitHubIntegration.prototype, 'getRepoContext').mockResolvedValue({
            repoInfo: { owner: 'neverinfamous', repo: 'short-repo', branch: 'main' },
            commit: null,
            issues: [],
            pullRequests: [],
            workflowRuns: [],
            milestones: [],
        } as unknown as Awaited<ReturnType<GitHubIntegration['getRepoContext']>>)
        const kanbanSpy = vi
            .spyOn(GitHubIntegration.prototype, 'getProjectKanban')
            .mockImplementation(async (_o: string, projNum: number) => {
                kanbanCalledWith = projNum
                return { columns: [], totalItems: 0 } as unknown as Awaited<
                    ReturnType<GitHubIntegration['getProjectKanban']>
                >
            })
        try {
            const statusRes = getGitHubResourceDefinitions().find(
                (r) => r.uri === 'memory://github/status/{+repo}'
            )
            expect(statusRes).toBeDefined()
            const ctx = {
                db: {} as ResourceContext['db'],
                briefingConfig: {
                    projectRegistry: {
                        'short-repo': { path: process.cwd(), project_number: 42 },
                    },
                },
            } as unknown as ResourceContext
            await statusRes?.handler('memory://github/status/neverinfamous/short-repo', ctx)
            expect(kanbanCalledWith).toBe(42)
        } finally {
            infoSpy.mockRestore()
            ctxSpy.mockRestore()
            kanbanSpy.mockRestore()
        }
    })

    it('M9: visualize_relationships source=team honors relationship_type, limit, include_content, and tags', async () => {
        const personalDb = new DatabaseAdapter(':memory:')
        const teamDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            const e1 = teamDb.createEntry({
                content: 'Alpha secret body',
                tags: ['t1'],
                workspaceId: 'ws',
                projectNumber: 5,
            })
            const e2 = teamDb.createEntry({
                content: 'Beta body',
                tags: ['t2'],
                workspaceId: 'ws',
                projectNumber: 5,
            })
            const e3 = teamDb.createEntry({
                content: 'Gamma body',
                tags: ['t3'],
                workspaceId: 'ws',
                projectNumber: 5,
            })
            teamDb.linkEntries(e1.id, e2.id, 'implements', undefined, 'ws')
            teamDb.linkEntries(e1.id, e3.id, 'references', undefined, 'ws')

            const ctx: ToolContext = {
                db: personalDb,
                teamDb,
                config: {
                    teamDefaultRole: 'admin',
                    projectRegistry: { ws: { path: process.cwd(), project_number: 5 } },
                },
            }
            const visTool = getRelationshipTools(ctx).find((t) => t.name === 'visualize_relationships')
            expect(visTool).toBeDefined()
            const res = (await visTool?.handler({
                source: 'team',
                workspace_id: 'ws',
                project_number: 5,
                tags: ['t1', 't2'],
                relationship_type: 'implements',
                include_content: false,
                limit: 5,
            })) as Record<string, unknown>
            expect(res['success']).toBe(true)
            expect(res['entry_count']).toBe(2)
            expect(res['relationship_count']).toBe(1)
            expect(String(res['mermaid'])).not.toContain('Alpha secret body')
        } finally {
            personalDb.close()
            teamDb.close()
        }
    })

    it('L2: convertLogseq does not close code fences on lines with trailing non-whitespace', () => {
        const md = ['```md', '```not-a-close', '- TODO stay literal', '```'].join('\n')
        const converted = convertLogseq(md, 'note.md')
        expect(converted.body).toContain('- TODO stay literal')
    })

    it('L4 & L5: coerceNumericValue scopes 0 to read-only methods and validateResultSize handles bigint', () => {
        expect(coerceNumericValue('project_number', '0', 'create_entry')).toBeUndefined()
        expect(coerceNumericValue('project_number', '0', 'search_entries')).toEqual({ value: 0 })

        const sec = new CodeModeSecurityManager({ maxResultSize: 1024 })
        const cyclicWithBigInt: Record<string, unknown> = { count: 99n }
        cyclicWithBigInt['self'] = cyclicWithBigInt
        // Force JSON fallback by including a function (uncloneable by v8.serialize)
        cyclicWithBigInt['fn'] = () => 1
        const check = sec.validateResultSize(cyclicWithBigInt)
        expect(check.valid).toBe(true)
    })

    it('L6 & L7 & L8: defaultWorkspaceId trim/lowercase, mj.admin.listProjects hint, get_statistics description', async () => {
        const agentCtxRes = getAgentContextResource()
        const out = await agentCtxRes.handler('memory://agent-context/default', {
            db: { getRecentEntries: () => ({ entries: [] }) } as unknown as ResourceContext['db'],
            briefingConfig: { defaultWorkspaceId: ' DEFAULT ', defaultProjectNumber: 9 },
        } as unknown as ResourceContext)
        expect(String(out.data)).toContain('Project Number: 9')

        const personalDb = new DatabaseAdapter(':memory:')
        await personalDb.initialize()
        try {
            const ctx: ToolContext = { db: personalDb }
            const coreCreate = getCoreTools(ctx).find((t) => t.name === 'create_entry')
            const res = (await coreCreate?.handler({ content: 'hello' })) as Record<string, unknown>
            expect(String(res['suggestion'])).toContain('mj.admin.listProjects()')

            const statsTool = getAnalyticsTools(ctx).find((t) => t.name === 'get_statistics')
            const schemaJson = JSON.stringify(statsTool?.inputSchema)
            expect(schemaJson).not.toContain('does not filter by project_number itself')
        } finally {
            personalDb.close()
        }
    })

    it('AP1–AP2: bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass54 and includes Pass 54 guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-23-audit-pass78')
        const def = getCodeQualityAuditPromptDefinition()
        const res = def.handler(
            { target: 'memory-journal-mcp' },
            {
                searchEntries: () => ({ entries: [] }),
                searchByDateRange: () => ({ entries: [] }),
            } as unknown as ResourceContext['db']
        ) as { messages: Array<{ content: { text: string } }> }
        const text = res.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-23-audit-pass78')
        expect(text).toContain('cleanSqlText')
        expect(text).toContain('sql-prepared-recovery.ts')
        expect(text).toContain('Number.isNaN(d.getTime())')
        expect(text).toContain('revisions')
    })
})
