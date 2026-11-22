import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { Command } from 'commander'
import type { Request, Response } from 'express'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { releaseRestoreLock } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { VectorOperations } from '../../src/database/sqlite-adapter/vector-operations.js'
import { convertObsidian } from '../../src/markdown/converters/obsidian.js'
import { convertLogseq } from '../../src/markdown/converters/logseq.js'
import { processImportBatch } from '../../src/markdown/importer.js'
import { resolveToolCallAuditScope } from '../../src/audit/audit-file-helpers.js'
import { extractSensitiveTargetFromArgs } from '../../src/audit/audit-query-helpers.js'
import { LegacySSEServerTransport } from '../../src/transports/http/server/legacy-sse.js'
import { extractSessionId } from '../../src/transports/http/server/protocol-route-handlers.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { resolveSingleProjectFromRegistry } from '../../src/server/mcp-server/tool-registration/call-interceptor-helpers.js'
import { getMiscSearchTools } from '../../src/handlers/tools/search/misc-tools.js'
import { getBackupTools } from '../../src/handlers/tools/backup.js'
import { getTeamMemberTools } from '../../src/handlers/tools/team/member-tools.js'
import { getTeamBackupTools } from '../../src/handlers/tools/team/backup-tools.js'
import { TeamBackupSchemaMcp } from '../../src/handlers/tools/team/schemas.js'
import { getTeamRelationshipTools } from '../../src/handlers/tools/team/relationship-tools.js'
import { resolveTransportOption } from '../../src/cli/server-options-parsers.js'
import { normalizeCliArgv } from '../../src/cli/program.js'
import { assertCliUpdateProjectOwnership } from '../../src/cli/commands/entry-update-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import type { ToolContext } from '../../src/types/index.js'

const SAVED_ENV_KEYS = ['MJ_DB_ENCRYPTION_KEY', 'DB_ENCRYPTION_KEY', 'TRANSPORT', 'DB_PATH'] as const

describe('Pass 72 Audit — Audit, DB, Converters, Team Tools, CLI & Prompt Parity', () => {
    const savedEnv = new Map<string, string | undefined>()
    const tempDirs: string[] = []

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
    }

    beforeEach(() => {
        for (const k of SAVED_ENV_KEYS) savedEnv.set(k, process.env[k])
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        delete process.env['TRANSPORT']
    })

    afterEach(() => {
        vi.restoreAllMocks()
        for (const k of SAVED_ENV_KEYS) {
            const orig = savedEnv.get(k)
            if (orig !== undefined) process.env[k] = orig
            else delete process.env[k]
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('A-M1, A-M3, A-L1, A-L2, A-L3 & A-L5: audit URI roots, prototype seed guard, SSE detach, case scheme & session IDs', async () => {
        const schemeLess = resolveToolCallAuditScope(
            'read_resource',
            { uri: 'journal/briefing?workspace_id=repo-a&project_number=5' },
            true,
            undefined,
            undefined
        )
        expect(schemeLess).toEqual({ workspaceId: 'repo-a', projectNumber: 5 })
        expect(resolveToolCallAuditScope('read_resource', { uri: 'repo-a' }, true, undefined, undefined)).toEqual({
            workspaceId: 'repo-a',
        })
        expect(extractSensitiveTargetFromArgs('MEMORY://audit', {})).toBe('memory://audit')

        const cfgMgr = new ConfigManager({
            rawToolFilter: undefined,
            toolFilterConfig: null,
            briefingConfig: { ...DEFAULT_BRIEFING_CONFIG },
        })
        cfgMgr.seedMissingScopeDefaults({ defaultWorkspaceId: '__proto__' })
        expect(cfgMgr.getConfig().briefingConfig.defaultWorkspaceId).toBeUndefined()

        const resolvedProj = resolveSingleProjectFromRegistry(
            { 'memory-journal-mcp': { path: process.cwd(), project_number: 5 } },
            { name: 'Memory-Journal-MCP' },
            'get_project'
        )
        expect(resolvedProj['success']).toBe(true)

        const transport = new LegacySSEServerTransport('/messages', 'sess-p72')
        const offReq = vi.fn()
        const offRes = vi.fn()
        transport.handleSseRequest(
            { destroyed: false, on: vi.fn(), off: offReq } as unknown as Request,
            { writableEnded: false, destroyed: false, setTimeout: vi.fn(), writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), on: vi.fn(), off: offRes } as unknown as Response
        )
        await transport.close()
        expect(offReq).toHaveBeenCalledTimes(2)
        expect(offRes).toHaveBeenCalledTimes(2)

        expect(
            extractSessionId({
                query: { sessionId: '' },
                headers: { 'mcp-session-id': 'sid-header-1' },
            } as unknown as Request)
        ).toBe('sid-header-1')
    })

    it('B-M1 to B-M6 & B-L1, B-L4, B-L5: immediate migrations, FTS pagination, space timestamps, CommonMark fences, vector KNN, lock & author trim', async () => {
        const tmpDir = makeTempDir('mj-p72-b-')
        const rawDb = new Database(path.join(tmpDir, 'mig.db'))
        try {
            MigrationManager.runMigrations(rawDb, false)
            MigrationManager.runMigrations(rawDb, false)
            const vers = rawDb.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number }
            expect(vers.c).toBeGreaterThan(15)
        } finally {
            rawDb.close()
        }

        const db = new DatabaseAdapter(path.join(tmpDir, 'search.db'))
        await db.initialize()
        try {
            for (let i = 0; i < 10; i++) {
                db.createEntry({ content: `auth hit ${String(i)}`, workspaceId: 'ws-a', projectNumber: 1 })
            }
            for (let i = 0; i < 12; i++) {
                db.createEntry({ content: `oauth only ${String(i)}`, workspaceId: 'ws-a', projectNumber: 1 })
            }
            const page1 = db.searchEntries('auth', { limit: 10, workspaceId: 'ws-a' })
            expect(page1.nextCursor).toBeDefined()
            const page2 = db.searchEntries('auth', { limit: 10, cursor: page1.nextCursor, workspaceId: 'ws-a' })
            expect(page2.entries).toEqual([])
            expect(page2.degraded).toBeUndefined()

            const spaceRow = db.createEntry({
                content: 'sqlite default space ts',
                timestamp: '2026-01-15 12:00:00',
                workspaceId: 'ws-a',
                projectNumber: 1,
            })
            const hits = db.searchEntries('sqlite default space ts', {
                workspaceId: 'ws-a',
                startDate: '2026-01-15',
                endDate: '2026-01-15',
            })
            expect(hits.entries.some((e) => e.id === spaceRow.id)).toBe(true)
            expect(db.searchByDateRange('2026-01-15', '2026-01-15', { workspaceId: 'ws-a' }).entries.some((e) => e.id === spaceRow.id)).toBe(true)
            expect(db.getSearchFacets('sqlite', { workspaceId: 'ws-a', startDate: '2026-01-15', endDate: '2026-01-15' }).tags).toBeDefined()
        } finally {
            db.close()
        }

        const obs = convertObsidian('```inline```\n\n---\n\nSee [[Target]] and #decision', 'note.md')
        expect(obs.body).toContain('See Target and #decision')
        expect(obs.metadata.entry_type).toBe('project_decision')
        const obsTags = convertObsidian('---\ntags: [ADR]\n---\n\nWe chose SQLite', 'arch.md')
        expect(obsTags.metadata.entry_type).toBe('project_decision')
        expect(obsTags.metadata.tags).toEqual(['adr'])
        const logs = convertLogseq('```inline```\n\ntags:: ADR\n- TODO [[X|Y]]', 'ls.md')
        expect(logs.metadata.tags).toEqual(['adr'])
        expect(logs.body).toContain('- [ ] Y')

        const fakeVecConn = {
            getNativeDb: () => ({
                prepare: (sql: string) => ({
                    all: (_emb: unknown, k: number) => (sql.includes('vec_embeddings') && k >= 8 ? [{ entry_id: 1, distance: 0.1 }] : []),
                    get: () => ({ count: 10 }),
                }),
            }),
            getVectorMetadata: () => undefined,
            setVectorMetadata: () => undefined,
            createVecTable: () => undefined,
            dropVecTable: () => undefined,
        } as unknown as NativeConnectionManager
        const vecOps = new VectorOperations(fakeVecConn)
        expect(vecOps.searchVectors(new Float32Array([1]), 1, '*')).toEqual([{ entry_id: 1, distance: 0.1 }])

        const lockDir = path.join(tmpDir, 'r.lock')
        const lockFile = path.join(lockDir, 'lock.json')
        const lockToken = acquireRestoreLock(lockDir, lockFile, undefined)
        fs.unlinkSync(lockFile)
        releaseRestoreLock(lockDir, lockFile, lockToken)
        fs.rmdirSync(lockDir)
        const nextLockToken = acquireRestoreLock(lockDir, lockFile, undefined)
        expect(typeof nextLockToken).toBe('string')
        expect(nextLockToken).not.toBe(lockToken)
        releaseRestoreLock(lockDir, lockFile, nextLockToken)

        const teamDb = new DatabaseAdapter(path.join(tmpDir, 'team-mem.db'))
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        try {
            teamDb.addTeamMember('alice', 'admin')
            let thrown = ''
            try {
                teamDb.addTeamMember('alice', 'admin')
            } catch (err) {
                thrown = err instanceof Error ? err.message : String(err)
            }
            expect(thrown.length).toBeGreaterThan(0)
            expect(thrown).not.toContain('Failed to add team member: Failed to add team member:')

            const impRes = await processImportBatch(
                [{ filename: 'entry.md', body: 'Body text', metadata: { author: ' \u0000 ' } }],
                teamDb,
                { workspaceId: 'ws-a', project_number: 1, isPersonal: false },
                undefined
            )
            expect(impRes.created).toBe(1)
            const created = teamDb.getRecentEntries(5, false, undefined, undefined, undefined, 'ws-a').entries[0]
            expect(created?.author ?? undefined).toBeUndefined()
        } finally {
            teamDb.close()
        }
    })

    it('D-M1, D-M3, D-M5, D-L1, D-L3 & AP1/AP2: strict empty handlers, transport precedence, CLI ownership/argv, team self-loop & revision pass72', async () => {
        const tmpDir = makeTempDir('mj-p72-d-')
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        db.applyTeamSchema()
        try {
            const ctx = { db, teamDb: db, vectorManager: undefined, config: { runtime: new ServerRuntime() } } as unknown as ToolContext
            const statsRes = (await getMiscSearchTools(ctx).find((t) => t.name === 'get_vector_index_stats')?.handler({ workspace_id: 'alpha' })) as Record<string, unknown>
            expect(statsRes['success']).toBe(false)
            const listBkRes = (await getBackupTools(ctx).find((t) => t.name === 'list_backups')?.handler({ workspace_id: 'alpha' })) as Record<string, unknown>
            expect(listBkRes['success']).toBe(false)
            const listMemRes = (await getTeamMemberTools(ctx).find((t) => t.name === 'team_list_members')?.handler({ workspace_id: 'alpha' })) as Record<string, unknown>
            expect(listMemRes['success']).toBe(false)
            expect(TeamBackupSchemaMcp).toBeDefined()
            const tbRes = (await getTeamBackupTools({
                teamDb: { exportToFile: () => Promise.resolve({ filename: 'b.db', path: 'b.db', sizeBytes: 1 }) } as never,
                config: {},
            } as unknown as ToolContext).find((t) => t.name === 'team_backup')?.handler({ project_number: 5 })) as Record<string, unknown>
            expect(tbRes['scopeNote']).toBe('Database-wide team backup')

            const cfgPath = path.join(tmpDir, 'cfg.json')
            fs.writeFileSync(cfgPath, JSON.stringify({ http: true }), 'utf-8')
            const resolver = new ConfigResolver(
                { name: () => 'serve', getOptionValueSource: (k) => (k === 'transport' ? 'cli' : 'default') },
                { transport: 'stdio' },
                cfgPath
            )
            expect(resolveTransportOption(resolver, (fn, fb) => { try { return fn() } catch { return fb } })).toBe('stdio')

            expect(() =>
                assertCliUpdateProjectOwnership(
                    42,
                    { workspaceId: 'scratch-ws', projectNumber: 7 },
                    { workspaceId: 'scratch-ws', projectNumber: 77, hasExplicitProject: true },
                    'scratch-ws',
                    {}
                )
            ).toThrow(/belongs to project 7, not 77/)

            const mockRelDb = {
                getEntryById: () => ({ id: 1, content: 'a', workspaceId: 'ws', projectNumber: 1, entryType: 'technical_note', timestamp: '2026-01-01T00:00:00Z', tags: [], isPersonal: true }),
                getEntriesByIds: () => new Map([[1, { id: 1, content: 'a', workspaceId: 'ws', projectNumber: 1, entryType: 'technical_note', timestamp: '2026-01-01T00:00:00Z', tags: [], isPersonal: true }]]),
                getRelationshipsForEntries: () => new Map([[1, [{ id: 1, fromEntryId: 1, toEntryId: 1, relationshipType: 'references', createdAt: '2026-01-01', description: null }]]]),
            } as unknown as ToolContext['db']
            const visRes = (await getTeamRelationshipTools({ db, teamDb: mockRelDb, config: {} } as unknown as ToolContext)
                .find((t) => t.name === 'team_visualize_relationships')?.handler({ entry_id: 1, workspace_id: 'ws', project_number: 1 })) as Record<string, unknown>
            expect(visRes['edgeCount']).toBe(0)

            const cmd = new Command('mj')
            cmd.command('search').option('-q, --query <text>', 'q')
            expect(normalizeCliArgv(['node', 'mj', 'search', '--query', '--foo_bar'], cmd)).toEqual([
                'node', 'mj', 'search', '--query', '--foo_bar',
            ])

            expect(AUDIT_PROMPT_REVISION).toBe('2026-11-22-audit-pass75')
            const cq = await getCodeQualityAuditPromptDefinition().handler({}, db)
            const cqText = cq.messages[0]?.content.type === 'text' ? cq.messages[0].content.text : ''
            for (const tok of ['explore', 'generalPurpose', 'code-quality-audit', 'param-normalizer.ts', 'SCAN_OK scanned=', 'Present the plan as markdown in the chat.', 'Do not add an audit plan file to the repository.']) {
                expect(cqText).toContain(tok)
            }
            for (const bad of ['docs/audits/', 'Cursor canvas', 'invoke_subagent', 'bun path/to/commit.ts']) {
                expect(cqText).not.toContain(bad)
            }
        } finally {
            db.close()
        }
    })
})
