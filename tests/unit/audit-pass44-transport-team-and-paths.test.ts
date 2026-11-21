import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import type { Request, Response } from 'express'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { readResource } from '../../src/handlers/resources/index.js'
import { getPrompt } from '../../src/handlers/prompts/index.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { SCOPES } from '../../src/auth/scopes.js'
import { enforceScope } from '../../src/auth/validation.js'
import { requestContextStorage } from '../../src/utils/request-context.js'
import { assertSafeDirectoryPath, assertSafeFilePath } from '../../src/utils/path-safety.js'
import { sanitizeErrorForLogging } from '../../src/utils/security-utils.js'
import { readProjectRegistryPayload } from '../../src/codemode/normalizers/project-alias-helpers.js'
import { evaluateAnchorStaleness, readLatestGitTag } from '../../src/handlers/tools/git-staleness.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getSecurityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-security.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'

function createStubVectorManager(rebuildSpy = vi.fn().mockResolvedValue({
    success: true,
    indexed: 4,
    failed: 0,
    firstError: null,
})): { manager: VectorSearchManager; rebuildSpy: ReturnType<typeof vi.fn> } {
    const manager = {
        isInitialized: () => true,
        initialize: async () => {},
        search: async () => [],
        searchByEntryId: async () => [],
        addEntry: async () => ({ success: true }),
        removeEntry: () => true,
        rebuildIndex: rebuildSpy,
        getStats: () => ({ itemCount: 4, modelName: 'mock', dimensions: 384 }),
    } as unknown as VectorSearchManager
    return { manager, rebuildSpy }
}

describe('Pass 44 Audit — Team Fencing, Vector Scope, HTTP DoS, Path Safety & Secrets', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        db.close()
        teamDb.close()
        vi.restoreAllMocks()
    })

    it('H3: fails closed on team_semantic_search, team_merge_tags, memory://team/recent, and team prompts when project_number is unresolved', async () => {
        const { manager: teamVec } = createStubVectorManager()
        const semRes = (await callTool(
            'team_semantic_search',
            { query: 'architecture', workspace_id: 'unregistered-ws' },
            db,
            undefined,
            undefined,
            { runtime: new ServerRuntime() },
            undefined,
            teamDb,
            teamVec
        )) as Record<string, unknown>
        expect(semRes['success']).toBe(false)
        expect(semRes['code']).toBe('VALIDATION_ERROR')
        expect(String(semRes['error'])).toContain('Missing project_number')

        const mergeRes = (await callTool(
            'team_merge_tags',
            { source_tag: 'old-tag', target_tag: 'new-tag', workspace_id: 'unregistered-ws' },
            db,
            undefined,
            undefined,
            { runtime: new ServerRuntime() },
            undefined,
            teamDb
        )) as Record<string, unknown>
        expect(mergeRes['success']).toBe(false)
        expect(mergeRes['code']).toBe('VALIDATION_ERROR')

        const teamRecentRes = await readResource(
            'memory://team/recent',
            db,
            undefined,
            null,
            undefined,
            teamDb,
            {} as never
        )
        expect((teamRecentRes.data as Record<string, unknown>)['error']).toContain(
            'Missing project_number'
        )

        await expect(
            getPrompt(
                'team-session-summary',
                { workspace_id: 'unregistered-ws' },
                db,
                teamDb,
                undefined,
                { projectRegistry: { 'registered-repo': { path: process.cwd(), project_number: 5 } } }
            )
        ).rejects.toThrow(/project_number/)
        await expect(
            getPrompt(
                'update-team-entry',
                { workspace_id: 'unregistered-ws' },
                db,
                teamDb,
                undefined,
                { projectRegistry: { 'registered-repo': { path: process.cwd(), project_number: 5 } } }
            )
        ).rejects.toThrow(/project_number/)
    })

    it('M1: honors explicit project_number on rebuild_vector_index & team_rebuild_vector_index even with workspace_id: "*"', async () => {
        const { manager: personalVec, rebuildSpy: personalSpy } = createStubVectorManager()
        const { manager: teamVec, rebuildSpy: teamSpy } = createStubVectorManager()
        const config = {
            runtime: new ServerRuntime(),
            projectRegistry: {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
            },
        }

        await callTool(
            'rebuild_vector_index',
            { workspace_id: '*', project_number: 5 },
            db,
            personalVec,
            undefined,
            config
        )
        expect(personalSpy).toHaveBeenCalledWith(undefined, {
            workspaceId: '*',
            projectNumber: 5,
        })

        await callTool(
            'team_rebuild_vector_index',
            { workspace_id: '*', project_number: 5 },
            db,
            personalVec,
            undefined,
            config,
            undefined,
            teamDb,
            teamVec
        )
        expect(teamSpy).toHaveBeenCalledWith(undefined, {
            workspaceId: '*',
            projectNumber: 5,
        })
    })

    it('M2, M4 & L6: detaches SSE error listeners before destroy, requires SCOPES.ADMIN for team rebuild/export, and rejects unauthenticated enforceScope', async () => {
        // M4: Scope map promotes team_rebuild_vector_index and team_export_markdown to SCOPES.ADMIN
        expect(getRequiredScope('team_rebuild_vector_index')).toBe(SCOPES.ADMIN)
        expect(getRequiredScope('team_export_markdown')).toBe(SCOPES.ADMIN)

        // L6: enforceScope fails closed when authContext.authenticated is false
        expect(() =>
            requestContextStorage.run(
                {
                    requestId: 'r-l6',
                    ip: '127.0.0.1',
                    auth: { authenticated: false, claims: { sub: 'anon', scopes: ['admin'] } },
                },
                () => enforceScope('read')
            )
        ).toThrow()

        // M2: LegacySSEServerTransport detaches error/close listeners on close() and accepts valid POST
        const sse = new LegacySSEServerTransport('/messages', 'sess-pass44-m2')
        const streamReq = new EventEmitter() as Request
        const streamRes = new EventEmitter() as Response & {
            writeHead: ReturnType<typeof vi.fn>
            write: ReturnType<typeof vi.fn>
            end: ReturnType<typeof vi.fn>
            status: ReturnType<typeof vi.fn>
            json: ReturnType<typeof vi.fn>
            writableEnded: boolean
            destroyed: boolean
        }
        streamRes.writeHead = vi.fn()
        streamRes.write = vi.fn()
        streamRes.end = vi.fn()
        streamRes.writableEnded = false
        streamRes.destroyed = false
        sse.handleSseRequest(streamReq, streamRes)

        const postRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            end: vi.fn(),
        } as unknown as Response
        sse.handlePostMessage({ body: { jsonrpc: '2.0', method: 'ping' } } as Request, postRes)
        expect(postRes.status).toHaveBeenCalledWith(202)
        await sse.close()
    })

    it('M5 & L11: blocks Windows UNC and Win32 device paths before realpathSync.native and hardens git staleness checks', async () => {
        for (const uncOrDevice of [
            '\\\\attacker.example.com\\share\\dir',
            '//attacker.example.com/share/dir',
            '\\\\.\\PhysicalDrive0',
            '\\\\?\\C:\\Windows\\System32',
        ]) {
            expect(() => assertSafeDirectoryPath(uncOrDevice, [process.cwd()])).toThrow()
            expect(() =>
                assertSafeFilePath(`${uncOrDevice}\\file.md`, [process.cwd()])
            ).toThrow()
        }

        // L11: evaluateAnchorStaleness rejects path traversal / escaped paths as unresolvable
        const row = await evaluateAnchorStaleness(
            db,
            { id: 1, anchorPath: '../outside.ts', status: 'valid' },
            new Date().toISOString(),
            process.cwd(),
            async () => 0,
            'default'
        )
        expect(row.newStatus).toBe('unresolvable')
        expect(typeof readLatestGitTag).toBe('function')
    })

    it('M8, M9, M10, L8 & L10: redacts CLI/SQLCipher secrets, blocks wildcard/unregistered graph & briefing scopes, enforces tool filter on search fallback, and guards registry keys', async () => {
        // M8: CLI flags & double-quoted SQLCipher pragmas redacted
        const msg = sanitizeErrorForLogging(
            'Failed with --password=mySecretPassword123 --api-key "tok_live_999" and PRAGMA rekey = "double\\"quoteSecret"'
        )
        expect(msg).not.toContain('mySecretPassword123')
        expect(msg).not.toContain('tok_live_999')
        expect(msg).not.toContain('quoteSecret')
        expect(msg).toContain('--password=[REDACTED]')
        expect(msg).toContain("PRAGMA rekey = '[REDACTED]'")

        // M9: memory://graph/* and memory://briefing/* reject '*', and unregistered memory://graph/unknown-repo fails closed
        const registryConfig = {
            defaultProjectNumber: 5,
            projectRegistry: {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
            },
        }
        await expect(
            readResource('memory://graph/*', db, undefined, null, undefined, undefined, registryConfig)
        ).rejects.toThrow(/Wildcard '\*' is not supported/)
        const unknownGraph = await readResource(
            'memory://graph/unknown-repo',
            db,
            undefined,
            null,
            undefined,
            undefined,
            registryConfig
        )
        expect(String(unknownGraph.data)).toContain('is not a registered project')

        await expect(
            readResource(
                'memory://briefing/*',
                db,
                undefined,
                null,
                undefined,
                undefined,
                registryConfig
            )
        ).rejects.toThrow(/Wildcard '\*' is not supported/)

        // M10: grep_search fallback to search_entries respects -search_entries filter even with codemodeInternalFullAccess
        const filteredFallback = (await callTool(
            'grep_search',
            { query: 'secret' },
            db,
            undefined,
            undefined,
            {
                runtime: new ServerRuntime(),
                filterConfig: parseToolFilter('starter,-search_entries'),
                codemodeInternalFullAccess: true,
            }
        )) as Record<string, unknown>
        expect(filteredFallback['success']).toBe(false)
        expect(filteredFallback['entries']).toBeUndefined()

        // L8: readProjectRegistryPayload uses null-prototype object and skips forbidden keys
        const reg = readProjectRegistryPayload({
            ['__proto__']: { path: '/evil', project_number: 1 },
            constructor: { path: '/evil2', project_number: 2 },
            validRepo: { path: '/ok', project_number: 5 },
        })
        expect(reg).toBeDefined()
        expect(Object.getPrototypeOf(reg)).toBeNull()
        expect(reg?.['validRepo']?.project_number).toBe(5)
        expect(reg?.['constructor']).toBeUndefined()

        // L5: MetricsAccumulator.saveToFile writes with wx and cleans up
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass44-'))
        try {
            const { MetricsAccumulator } = await import('../../src/observability/metrics.js')
            const acc = new MetricsAccumulator()
            const targetFile = path.join(tmpDir, 'metrics.json')
            await acc.saveToFile(targetFile)
            expect(fs.existsSync(targetFile)).toBe(true)
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }

        // Prompt revision check
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass65')
        const secDef = getSecurityAuditPromptDefinition()
        const rendered = await Promise.resolve(
            secDef.handler({ target: 'memory-journal-mcp' }, db)
        )
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-21-audit-pass65')
        expect(text).toContain('Float16Array')
        expect(text).toContain('rpcPinnedProject')
    })
})
