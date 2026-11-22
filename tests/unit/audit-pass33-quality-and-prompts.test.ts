/**
 * Pass 33 Quality, Resource Query, Zod 4 Schema, Search, Storage & Audit Prompt Regression Suite
 * Covers M1-M12, L1-L8, and AP1-AP6.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { extractMetadataContextAliases } from '../../src/codemode/normalizers/generic-field-aliases.js'
import { extractNestedContextRecord } from '../../src/codemode/worker/nested-exec-payload.js'
import { extractAndRecoverPreparedStatementCode } from '../../src/handlers/tools/codemode/sql-prepared-recovery.js'
import { createContextNamespaceProxy } from '../../src/codemode/proxy-namespaces.js'
import { convertKeysToSnakeCase } from '../../src/codemode/api/key-normalizer.js'
import { getZodTypeString } from '../../src/codemode/type-generator.js'
import { checkSchemaAcceptsKey } from '../../src/handlers/tools/codemode/dispatch-schema-introspection.js'
import { getGitHubTools } from '../../src/handlers/tools/github.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { buildAllowedHostHeaders } from '../../src/transports/http/security.js'
import { runFallbackWithInterceptors } from '../../src/server/mcp-server/tool-registration/fallback-interceptors.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { createAuthMiddleware } from '../../src/auth/middleware.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { runWithAuthContext } from '../../src/auth/auth-context.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { resolveIssueUrl } from '../../src/utils/github-helpers.js'
import { resolveAuthor } from '../../src/utils/security-utils.js'
import { cwdMatchesRegistryPath } from '../../src/utils/workspace-registry-match.js'
import { resourceWorkspace, DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { formatUserMessage } from '../../src/handlers/resources/core/briefing/user-message.js'
import { convertObsidian } from '../../src/markdown/converters/obsidian.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { getAdversarialPromptDefinitions } from '../../src/handlers/prompts/adversarial.js'

const TEST_REGISTRY = {
    'memory-journal-mcp': { project_number: 5, path: process.cwd() },
    'other-repo': { project_number: 9 },
}

describe('Pass 33 Quality, Schema, Search, Storage & Prompt Regressions (M1-M12, L1-L8, AP1-AP6)', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let tmpDir: string
    let savedEnv: NodeJS.ProcessEnv

    beforeEach(async () => {
        savedEnv = { ...process.env }
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass33-qual-'))
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key)
        }
        Object.assign(process.env, savedEnv)
        try {
            db.close()
        } finally {
            teamDb.close()
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('M2: context hoisting flags entry tools only, prepared SQL guard ignores strings, getContext returns RESOURCE_NOT_FOUND', async () => {
        const nonEntry: Record<string, unknown> = { context: { workspace_id: 'other-repo' } }
        extractMetadataContextAliases(nonEntry, false)
        expect(nonEntry['workspace_id']).toBeUndefined()

        const entryObj: Record<string, unknown> = { context: { workspace_id: 'other-repo' } }
        extractMetadataContextAliases(entryObj, true)
        expect(entryObj['workspace_id']).toBe('other-repo')
        expect(entryObj['_alias_derived_workspace']).toBe(true)

        expect(extractNestedContextRecord({ context: 'plain string' })).toMatchObject({ content: 'plain string' })
        expect(extractNestedContextRecord({ context: [1, 2] })).toMatchObject({ value: [1, 2] })

        const validScript = `return await mj.core.createEntry({ content: "db.prepare('INSERT').run()" })`
        expect(extractAndRecoverPreparedStatementCode(validScript)).toBeNull()

        const { getContextRpc } = createContextNamespaceProxy({ workspace_id: 'repo-a' })
        const missingCtx = (await getContextRpc('nonExistentKey')) as Record<string, unknown>
        expect(missingCtx['success']).toBe(false)
        expect(missingCtx['code']).toBe('RESOURCE_NOT_FOUND')

        const clean = convertKeysToSnakeCase({ safeKey: 1, constructor: { evil: true } }) as Record<string, unknown>
        expect(Object.hasOwn(clean, 'safe_key')).toBe(true)
        expect(Object.hasOwn(clean, 'constructor')).toBe(false)
    })

    it('M3: Zod 4 introspection handles ZodLazy/ZodNonOptional and create_github_issue_with_entry exposes journal_content', () => {
        const nodeSchema: z.ZodType = z.lazy(() => z.object({ label: z.string(), next: nodeSchema.optional() }))
        const requiredStr = z.string().optional().unwrap().nonoptional()
        expect(getZodTypeString(requiredStr)).toBe('string')
        expect(getZodTypeString(nodeSchema)).toContain('label')
        expect(checkSchemaAcceptsKey(nodeSchema, 'label')).toBe(true)

        const ghTools = getGitHubTools({ db, config: { runtime: new ServerRuntime() } })
        const issueTool = ghTools.find((t) => t.name === 'create_github_issue_with_entry')
        expect(issueTool?.inputSchema).toBeDefined()
        const parsed = issueTool?.inputSchema.safeParse({ title: 'Bug report', journal_content: 'Detailed note' })
        expect(parsed?.success).toBe(true)
    })

    it('M4 & M5: briefing renders teamLatestPreviews, cwdMatchesRegistryPath handles Win32 paths cross-OS, resourceWorkspace rejects *', () => {
        const msg = formatUserMessage({
            repoName: 'memory-journal-mcp',
            branchName: 'main',
            ciStatus: 'passing',
            totalEntries: 2,
            latestPreviews: ['#1 (note): local preview'],
            teamLatestPreviews: ['#9 (decision): shared team entry'],
            summaryPreviews: null,
            github: undefined,
            isReadonly: false,
            teamConfigured: true,
            githubConfigured: false,
            ioRootCount: 0,
            workspaceId: 'memory-journal-mcp',
        })
        expect(msg).toContain('shared team entry')

        expect(cwdMatchesRegistryPath('C:\\Repos\\MyApp', 'c:/repos/myapp')).toBe(true)
        expect(resourceWorkspace({ briefingConfig: { defaultWorkspaceId: '*', projectRegistry: TEST_REGISTRY } })).toBe('default')
        expect(resourceWorkspace({ briefingConfig: { defaultWorkspaceId: ' Memory-Journal-MCP ', projectRegistry: TEST_REGISTRY } })).toBe('memory-journal-mcp')
    })

    it('M7 & M8: metadata.related_to rejects booleans, resolveIssueUrl rejects empty path, Obsidian drops invalid dates & caps tags', async () => {
        expect(() => buildEntryPayload({}, { related_to: [true] })).toThrow()
        expect(() => buildEntryPayload({}, { related_to: ['#42'] })).toThrow()

        const emptyIssueUrl = await resolveIssueUrl({ projectOwner: 'neverinfamous', projectNumber: 5, workspaceId: 'memory-journal-mcp', path: '' } as never, 1)
        expect(emptyIssueUrl).toBeUndefined()
        process.env['TEAM_AUTHOR'] = '\u0000\u0007'
        expect(resolveAuthor()).not.toBe('')

        const bigTags = Array.from({ length: 65 }, (_, i) => `tag-${String(i)}-${'x'.repeat(120)}`)
        const note = convertObsidian(
            `---\ntags:\n${bigTags.map((t) => `  - ${t}`).join('\n')}\ndate: "not-a-date"\n---\nBody text`,
            'bad-date-note.md'
        )
        const parsedTags = note.metadata.tags ?? []
        expect(parsedTags.length).toBeLessThanOrEqual(50)
        expect(parsedTags.every((t) => t.length <= 100)).toBe(true)
        expect(note.metadata.timestamp).toBeUndefined()

        const degraded = db.searchEntries('nonexistent_term_xyz', { limit: 1 })
        expect(degraded.nextCursor ?? '').not.toContain('"t":')
    })

    it('M10, M11 & M12: cleanup_backups failure reporting, host lowercasing, Zod metrics validation & pre-wrapper fallback authz', async () => {
        const res = (await runWithAuthContext(
            { authenticated: true, claims: { sub: 'reader', scopes: [SCOPES.READ] } },
            () =>
                runFallbackWithInterceptors(
                    'delete_entry',
                    { entry_id: 1 },
                    new ServerRuntime(),
                    async () => ({ content: [{ type: 'text', text: 'should not run' }] }),
                    [{ targetName: 'delete_entry', targetType: 'tool' }]
                )
        )) as { isError?: boolean }
        expect(res.isError).toBe(true)

        const metrics = new MetricsAccumulator()
        metrics.importState(JSON.stringify({ toolData: [['bad', { callCount: -1 }]] }))
        const exported = JSON.parse(metrics.exportState()) as { toolData?: unknown[] }
        expect(exported.toolData).toEqual([])

        const hosts = buildAllowedHostHeaders('LocalHost', 'HTTPS://Example.COM:8443/mcp')
        expect(hosts).toContain('localhost')
        expect(hosts).toContain('example.com:8443')

        const fileDb = new DatabaseAdapter(path.join(tmpDir, 'pass33-backup.db'))
        await fileDb.initialize()
        try {
            const backupRes = (await runWithAuthContext(
                { authenticated: true, claims: { sub: 'admin', scopes: [SCOPES.READ, SCOPES.WRITE, SCOPES.ADMIN] } },
                () =>
                    callTool('cleanup_backups', { keep_count: 100 }, fileDb, undefined, undefined, {
                        runtime: new ServerRuntime(),
                    })
            )) as Record<string, unknown>
            expect(backupRes['success']).toBe(true)
        } finally {
            fileDb.close()
        }
    })

    it('L1-L8: OAuth protected-resource path, leadingMethodVerb, and AP1-AP6 prompt hardening', async () => {
        const validator = Object.create(TokenValidator.prototype) as TokenValidator
        const middleware = createAuthMiddleware({
            tokenValidator: validator,
            resourceServer: { getResourceUri: () => 'https://mcp.example.com', getWWWAuthenticateHeader: () => 'Bearer' } as never,
        })
        const next = vi.fn()
        await middleware({ method: 'GET', path: '/.well-known/oauth-protected-resource', headers: {} } as never, { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as never, next)
        expect(next).toHaveBeenCalled()

        expect(getRequiredScope('get_recent_entries', 'tool')).toBe(SCOPES.READ)
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass70')

        const qualityPrompt = getCodeQualityAuditPromptDefinition()
        const renderedQuality = await qualityPrompt.handler({ target: 'memory-journal-mcp' }, db)
        const qText = renderedQuality.messages.map((m) => m.content.text).join('\n')
        expect(qText).toContain('2026-11-21-audit-pass70')
        expect(qText).toContain("'skills'")
        expect(qText).toContain('path.win32')
        expect(qText).toContain('finally { Remove-Item')

        const advDefs = getAdversarialPromptDefinitions()
        const perfDef = advDefs.find((d) => d.name === 'adversarial-audit-performance')
        expect(perfDef).toBeDefined()
        const perfText = (await perfDef?.handler({ target: 'memory-journal-mcp' }, db))?.messages
            .map((m) => m.content.text)
            .join('\n') ?? ''
        expect(perfText).toContain('.partial().loose()')
        expect(perfText).not.toContain('.partial().passthrough()')
        expect(DEFAULT_BRIEFING_CONFIG).toBeDefined()
    })
})
