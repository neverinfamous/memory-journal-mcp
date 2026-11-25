import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import * as jose from 'jose'
import type { McpServer } from '@modelcontextprotocol/server'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { AliasManager } from '../../src/database/sqlite-adapter/aliases.js'
import {
    saveAnalyticsSnapshot,
    getLatestAnalyticsSnapshot,
    getAnalyticsSnapshots,
} from '../../src/database/sqlite-adapter/entries/digest.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { searchDirectory } from '../../src/handlers/tools/core/dummy-healing/directory-search.js'
import { readResource } from '../../src/handlers/resources/index.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { ConfigResolver, type CliCommandLike } from '../../src/utils/config-resolver.js'
import { assertSafeDirectoryPath } from '../../src/utils/path-safety.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { setActiveSessionProject } from '../../src/utils/workspace-resolver-session.js'
import { extractAuditScopeFromUri } from '../../src/audit/audit-query-helpers.js'
import { scrubAuditArgs } from '../../src/audit/audit-arg-scrubber.js'
import { convertLogseq } from '../../src/markdown/converters/logseq.js'
import { assertImportAuthorOwnership } from '../../src/markdown/importer-author.js'
import { parseToolFilter, isFilterEffectivelyReadOnly } from '../../src/filtering/tool-filter.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { HttpTransport } from '../../src/transports/http/server/http-transport.js'
import { attachResourceQueryHandler } from '../../src/server/resource-query-registration.js'
import { runFallbackWithInterceptors } from '../../src/server/mcp-server/tool-registration/fallback-interceptors.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { ConfigurationError, PermissionError } from '../../src/types/errors.js'

const TEMP_REGISTRY = {
    'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
    companion: { path: path.resolve(process.cwd(), '..', 'companion'), project_number: 16 },
}

describe('Pass 60 Code-Quality Audit Remediations (H1–H2, M2–M4, M9–M11, L3, L6–L8, O6–O13, AP1–AP4)', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined
    let savedStaleHours: string | undefined
    let tempDirs: string[] = []

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        savedStaleHours = process.env['STALENESS_ACTIVE_HOURS']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
        if (savedStaleHours !== undefined) process.env['STALENESS_ACTIVE_HOURS'] = savedStaleHours
        else delete process.env['STALENESS_ACTIVE_HOURS']
        for (const dir of tempDirs) {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
        }
        tempDirs = []
    })

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    it('H1: ConfigResolver.resolveStringArray handles blank strings, filters nulls, and rejects non-primitives', () => {
        const cmd: CliCommandLike = { name: () => 'serve', getOptionValueSource: () => undefined }
        const emptyResolver = new ConfigResolver(cmd, { roots: '  ,  ' })
        expect(emptyResolver.resolveStringArray('roots')).toBeUndefined()

        const mixedResolver = new ConfigResolver(cmd, { roots: [null, ' alpha ', undefined, 42, true] })
        expect(mixedResolver.resolveStringArray('roots')).toEqual(['alpha', '42', 'true'])

        const badArrayResolver = new ConfigResolver(cmd, { roots: [{ nested: 1 }] })
        expect(() => badArrayResolver.resolveStringArray('roots')).toThrow(ConfigurationError)

        const badScalarResolver = new ConfigResolver(cmd, { roots: 123 })
        expect(() => badScalarResolver.resolveStringArray('roots')).toThrow(ConfigurationError)
    })

    it('H2: searchDirectory filePattern wildcard matching stays linear on backtracking patterns', () => {
        const dir = makeTempDir('mj-p60-h2-')
        fs.writeFileSync(path.join(dir, 'a.(b).txt'), 'needle line one\n', 'utf-8')
        const longName = `${'a'.repeat(120)}_tail.txt`
        fs.writeFileSync(path.join(dir, longName), 'needle line two\n', 'utf-8')

        const literalHits = searchDirectory(dir, 'needle', { filePattern: 'a.(b).txt' })
        expect(literalHits).toHaveLength(1)

        const started = performance.now()
        const advHits = searchDirectory(dir, 'needle', { filePattern: '*a*a*a*a*a*a*a*b' })
        expect(performance.now() - started).toBeLessThan(150)
        expect(advHits).toEqual([])
    })

    it('M2: extractAuditScopeFromUri suppresses session fallback on ?project_number=0 and honors explicit runtime', () => {
        const rt = new ServerRuntime()
        setActiveSessionProject('memory-journal-mcp', 5, rt)

        const inherited = extractAuditScopeFromUri('memory://audit', undefined, rt)
        expect(inherited).toEqual({ workspaceId: 'memory-journal-mcp', projectNumber: 5 })

        const suppressed = extractAuditScopeFromUri('memory://audit?project_number=0', undefined, rt)
        expect(suppressed).toEqual({})
    })

    it('M3: getSearchFacets executes materialized filter_tags CTE when tags + excludeTags exceed 500 padded binds', async () => {
        const dir = makeTempDir('mj-p60-m3-')
        const adapter = new DatabaseAdapter(path.join(dir, 'facets.db'), { projectRegistry: TEMP_REGISTRY })
        await adapter.initialize()
        try {
            adapter.createEntry({
                content: 'quantum facet benchmark entry',
                entryType: 'technical_note',
                tags: ['tag-1', 'keep-tag'],
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                isPersonal: true,
            })
            const manyTags = Array.from({ length: 130 }, (_, i) => `tag-${String(i + 1)}`)
            const manyExcluded = Array.from({ length: 130 }, (_, i) => `skip-${String(i + 1)}`)
            const facets = adapter.getSearchFacets('quantum', {
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                tags: manyTags,
                excludeTags: manyExcluded,
            })
            expect(facets.entryTypes.length).toBeGreaterThanOrEqual(1)
            expect(facets.tags.some((t) => t.name === 'tag-1')).toBe(true)
        } finally {
            adapter.close()
        }
    })

    it('M4: batch_create_entries, team_create_entry, and team_batch_create_entries honor auto_link: true', async () => {
        const dir = makeTempDir('mj-p60-m4-')
        const db = new DatabaseAdapter(path.join(dir, 'personal.db'), { projectRegistry: TEMP_REGISTRY })
        const teamDb = new DatabaseAdapter(path.join(dir, 'team.db'), { projectRegistry: TEMP_REGISTRY })
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        const rt = new ServerRuntime()
        const cfg = {
            runtime: rt,
            projectRegistry: TEMP_REGISTRY,
            defaultWorkspaceId: 'memory-journal-mcp',
            defaultProjectNumber: 5,
            teamDefaultRole: 'admin' as const,
            teamAdmin: 'tester',
        }
        try {
            const pPrior = db.createEntry({
                content: 'Personal session anchor',
                entryType: 'technical_note',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                sessionId: 'sess-p60',
                isPersonal: true,
            })
            await callTool(
                'batch_create_entries',
                {
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    entries: [
                        {
                            content: 'Batch item with auto_link',
                            entry_type: 'technical_note',
                            session_id: 'sess-p60',
                            auto_link: true,
                            impact_score: 0.6,
                            trust_score: 0.9,
                            validation_status: 'passed',
                        },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )
            const personalRels = db.getRelationships(pPrior.id, 'memory-journal-mcp')
            expect(personalRels.length).toBeGreaterThanOrEqual(1)

            const tPrior = teamDb.createEntry({
                content: 'Team session anchor',
                entryType: 'technical_note',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
                sessionId: 'sess-team-p60',
                author: 'tester',
                isPersonal: false,
            })
            await callTool(
                'team_create_entry',
                {
                    content: 'Team single auto_link entry',
                    entry_type: 'technical_note',
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    session_id: 'sess-team-p60',
                    author: 'tester',
                    auto_link: true,
                    impact_score: 0.6,
                    trust_score: 0.9,
                    validation_status: 'passed',
                },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )
            expect(teamDb.getRelationships(tPrior.id, 'memory-journal-mcp').length).toBe(1)

            await callTool(
                'team_batch_create_entries',
                {
                    workspace_id: 'memory-journal-mcp',
                    project_number: 5,
                    entries: [
                        {
                            content: 'Team batch auto_link entry',
                            entry_type: 'technical_note',
                            session_id: 'sess-team-p60',
                            author: 'tester',
                            auto_link: true,
                            impact_score: 0.6,
                            trust_score: 0.9,
                            validation_status: 'passed',
                        },
                    ],
                },
                db,
                undefined,
                undefined,
                cfg,
                undefined,
                teamDb
            )
            expect(teamDb.getRelationships(tPrior.id, 'memory-journal-mcp').length).toBe(2)
        } finally {
            teamDb.close()
            db.close()
        }
    })

    it('M9–M11, L3, L6, L7: fallback error format, relative IO root cache key, snapshot tie-break, fragment stripping, logseq date, staleness env', async () => {
        const rt = new ServerRuntime()
        const errRes = (await runFallbackWithInterceptors('unknown_tool', {}, rt, async () => {
            throw new PermissionError('denied')
        })) as { structuredContent?: { error?: string; code?: string }; isError?: boolean }
        expect(errRes.isError).toBe(true)
        expect(errRes.structuredContent?.code).toBe('PERMISSION_DENIED')

        const dirA = makeTempDir('mj-p60-m10a-')
        const dirB = makeTempDir('mj-p60-m10b-')
        fs.mkdirSync(path.join(dirA, 'sub'))
        fs.mkdirSync(path.join(dirB, 'sub'))
        const cwdSpy = vi.spyOn(process, 'cwd')
        cwdSpy.mockReturnValue(dirA)
        expect(() => assertSafeDirectoryPath(path.join(dirA, 'sub'), ['.'])).not.toThrow()
        cwdSpy.mockReturnValue(dirB)
        expect(() => assertSafeDirectoryPath(path.join(dirB, 'sub'), ['.'])).not.toThrow()
        cwdSpy.mockRestore()

        const dbDir = makeTempDir('mj-p60-m11-')
        const conn = new NativeConnectionManager(path.join(dbDir, 'conn.db'))
        await conn.initialize()
        const adapter = new DatabaseAdapter(path.join(dbDir, 'snap.db'), { projectRegistry: TEMP_REGISTRY })
        await adapter.initialize()
        try {
            const native = conn.getNativeDb()
            const id1 = saveAnalyticsSnapshot(native, 'digest', { seq: 1 }, 'memory-journal-mcp')
            const id2 = saveAnalyticsSnapshot(native, 'digest', { seq: 2 }, 'memory-journal-mcp')
            native.prepare(`UPDATE analytics_snapshots SET created_at = '2026-11-21T00:00:00.000Z'`).run()
            expect(getLatestAnalyticsSnapshot(native, 'digest', 'memory-journal-mcp')?.id).toBe(id2)
            expect(getAnalyticsSnapshots(native, 'digest', 2, 'memory-journal-mcp').map((s) => s.id)).toEqual([id2, id1])

            process.env['STALENESS_ACTIVE_HOURS'] = '24abc'
            const staleRes = await readResource('memory://staleness', adapter, undefined, undefined, undefined, undefined, { projectRegistry: TEMP_REGISTRY }, rt)
            expect((staleRes.data as { success?: boolean }).success).toBe(false)
        } finally {
            adapter.close()
            conn.close()
        }

        const logseq = convertLogseq('- TODO write tests', 'journals/2026_11_20.md', 'technical_note')
        expect(logseq.metadata.entry_type).toBe('technical_note')
        expect(logseq.metadata.timestamp).toMatch(/^2026-11-20/)

        const capturedUris: string[] = []
        const handlersMap = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>([
            ['resources/read', async (req) => { capturedUris.push(String((req as { params: { uri: string } }).params.uri)); return {} }],
        ])
        attachResourceQueryHandler({ server: { _requestHandlers: handlersMap } } as unknown as McpServer)
        await handlersMap.get('resources/read')?.({ params: { uri: 'memory://recent?limit=5#top' } }, {})
        expect(capturedUris).toEqual(['memory://recent'])
    })

    it('O6–O13 & AP1–AP4: degraded search, COLLATE NOCASE IN, author parity, bypassQueryCache, Map truncation, HTTP stop, tool-filter, JWKS match, AP prompt', async () => {
        const dir = makeTempDir('mj-p60-opts-')
        const db = new DatabaseAdapter(path.join(dir, 'opts.db'), { projectRegistry: TEMP_REGISTRY })
        await db.initialize()
        const aliasConn = new NativeConnectionManager(path.join(dir, 'alias.db'))
        await aliasConn.initialize()
        try {
            const entry = db.createEntry({ content: 'hello world', entryType: 'technical_note', workspaceId: 'memory-journal-mcp', projectNumber: 5, isPersonal: true })
            const deg = db.searchEntries('!!!', { workspaceId: 'memory-journal-mcp' })
            expect(deg.degraded).toBe(true)

            aliasConn.getNativeDb().prepare(`INSERT INTO author_aliases (alias, canonical_author, workspace_id) VALUES ('Alice', 'alice_canon', 'memory-journal-mcp')`).run()
            const mgr = new AliasManager(aliasConn)
            expect(mgr.resolveAuthors(['alice'], 'memory-journal-mcp').get('alice')).toBe('alice_canon')

            const authorAdapter = { getAuthorsForEntries: () => new Map([[1, '  Alice  ']]) } as unknown as DatabaseAdapter
            expect(() => assertImportAuthorOwnership(authorAdapter, 1, 'Alice', 'ws')).not.toThrow()

            const vecMgr = new VectorSearchManager(db)
            vi.spyOn(vecMgr, 'initialize').mockResolvedValue(undefined)
            const embSpy = vi.spyOn(vecMgr, 'generateEmbedding').mockResolvedValue(new Float32Array([1, 0]))
            await vecMgr.searchByEntryId(entry.id, 5, 0.0, 'memory-journal-mcp', 5, entry).catch(() => [])
            expect(embSpy).toHaveBeenCalledWith(expect.any(String), { bypassQueryCache: true })

            const cq = await getCodeQualityAuditPromptDefinition().handler({ target: 'memory-journal-mcp', copilot: 'false' }, db)
            const cqText = cq.messages.map((m) => m.content.text).join('\n')
            expect(cqText).toContain(`Prompt revision: ${AUDIT_PROMPT_REVISION}`)
            expect(cqText).toContain('COLLATE NOCASE IN')
            expect(cqText).toContain('Error.isError')
            expect(cqText).toContain('DUAL_IN_PARAM_BUCKETS')
            expect(cqText).toContain('?project_number=0')
            expect(cqText).toContain('auto_link: true')
            expect(cqText).toContain('path.resolve(cwd, "")')
            expect(cqText).toContain("process.on('exit', ...)")
            expect(cqText).toContain('auxiliary automation scripts')
            expect(cqText).toContain('process.exit(1)')
        } finally {
            db.close()
            aliasConn.close()
        }

        const bigMap = new Map(Array.from({ length: 55 }, (_, i) => [`k${String(i)}`, i]))
        const scrubbed = scrubAuditArgs({ bag: bigMap }) as { bag?: Record<string, unknown> }
        expect(scrubbed.bag?.['_truncatedKeys']).toBe(5)

        expect(isFilterEffectivelyReadOnly(parseToolFilter('starter,-starter,-mj_execute_code'))).toBe(true)

        const transport = new HttpTransport({ host: '127.0.0.1', port: 0 })
        await transport.stop()

        const { publicKey, privateKey } = await jose.generateKeyPair('ES256')
        const jwk = await jose.exportJWK(publicKey)
        jwk.kid = 'p60-kid'
        let reqCount = 0
        const server = http.createServer((_req, res) => {
            reqCount++
            if (reqCount === 1) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ keys: [jwk] }))
                return
            }
            res.writeHead(500)
            res.end()
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        try {
            const addr = server.address()
            const port = typeof addr === 'object' && addr !== null ? addr.port : 0
            const issuer = `http://127.0.0.1:${String(port)}`
            const tv = new TokenValidator({ jwksUri: issuer, issuer, audience: 'mj-aud' })
            await tv.preload()
            const jwt = await new jose.SignJWT({ sub: 'u1', scope: 'read' })
                .setProtectedHeader({ alg: 'ES256', kid: 'p60-kid' })
                .setIssuer(issuer)
                .setAudience('mj-aud')
                .setExpirationTime('5m')
                .sign(privateKey)
            const verified = await tv.validate(jwt)
            expect(verified.valid).toBe(true)
            expect(reqCount).toBe(1)
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()))
        }
    })
})
