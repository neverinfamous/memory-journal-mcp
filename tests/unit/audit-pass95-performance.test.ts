import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import BetterSqlite3 from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import {
    isEntryLiveForVectorUpsert,
    filterLiveVectorsForUpsert,
    generateValidatedSingleEmbedding,
} from '../../src/vector/vector-search-manager/live-entry-helpers.js'
import { upsertEntryChunksSequentially } from '../../src/vector/vector-search-manager/candidate-search.js'
import { rebuildIndex } from '../../src/vector/vector-search-manager/rebuild.js'
import { validateRawPayloadSize } from '../../src/handlers/tools/codemode/payload-byte-bounds.js'
import { rewriteModuleImportsAndExports } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { serializeAndEnforceEgress } from '../../src/codemode/worker/result-compactor.js'
import {
    getCachedRawSandboxScript,
    setCachedRawSandboxScript,
} from '../../src/codemode/worker/script-and-metadata-cache.js'
import { createContextNamespaceProxy } from '../../src/codemode/proxy-namespaces.js'
import { createContextProxy } from '../../src/codemode/worker/namespace-shims.js'
import { createGroupApi } from '../../src/codemode/api/group-factory.js'
import { markValidatedToolInput, getValidatedToolInputMax } from '../../src/utils/tool-input-bounds.js'
import { injectTokenEstimate } from '../../src/observability/token-estimator.js'
import { estimateOperationResultTokens } from '../../src/audit/audit-arg-scrubber.js'
import { resolveActiveBriefingConfig } from '../../src/server/mcp-server/tool-registration/register-tools-helpers.js'
import { deepCamelToSnake } from '../../src/server/mcp-server/tool-registration/call-arg-normalizer.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import { prefetchCommitFilesSince } from '../../src/handlers/tools/git-commit-helpers.js'
import { enrichCommits } from '../../src/github/commit-references/enricher.js'
import { collectTeamSearchEntries } from '../../src/handlers/tools/search/team-search-helpers.js'
import { resolveScopedTeamRole } from '../../src/handlers/tools/team/rbac.js'
import { getDiagnosticTools } from '../../src/handlers/tools/core/diagnostic-tools.js'
import { getTeamVectorTools } from '../../src/handlers/tools/team/vector-tools.js'
import { getKanbanTools } from '../../src/handlers/tools/github/kanban-tools.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import type { JournalEntry, ToolContext } from '../../src/types/index.js'
import type { GitHubIntegration } from '../../src/github/github-integration/index.js'

function makeEntry(id: number, content: string, projectNumber = 1): JournalEntry {
    return {
        id,
        entryType: 'technical_note',
        content,
        timestamp: new Date(Date.UTC(2026, 10, 1, 0, id)).toISOString(),
        isPersonal: true,
        significanceType: null,
        autoContext: null,
        deletedAt: null,
        isArchived: false,
        tags: [],
        version: 1,
        workspaceId: 'ws-pass95',
        projectNumber,
    }
}

describe('Pass 95 Adversarial Performance Remediations', () => {
    it('A-H1, A-M1, A-M2: computes FTS snippets post-LIMIT, scopes importance CTE + top_ids, and inner-LIMITs hubs', async () => {
        const tmpDb = path.join(os.tmpdir(), `mj-pass95-sql-${crypto.randomUUID()}.db`)
        const adapter = new DatabaseAdapter(tmpDb, { projectRegistry: {} })
        try {
            await adapter.initialize()
            const e1 = adapter.createEntry({
                entryType: 'technical_note',
                content: 'Alpha sqlite query planner optimization',
                workspaceId: 'ws-p95',
                projectNumber: 1,
                impactScore: 0.9,
            })
            const e2 = adapter.createEntry({
                entryType: 'technical_note',
                content: 'Beta sqlite query planner notes',
                workspaceId: 'ws-p95',
                projectNumber: 2,
                impactScore: 0.3,
            })
            adapter.linkEntries(e1.id, e2.id, 'references')

            const ftsRes = adapter.searchEntries('sqlite', {
                workspaceId: 'ws-p95',
                includeHighlights: true,
                limit: 5,
            })
            expect(ftsRes.entries.length).toBe(2)
            expect(ftsRes.highlights?.length).toBe(2)
            expect(ftsRes.highlights?.[0]?.snippet).toContain('«sqlite»')

            const emptyHighlights = adapter.searchEntries('nonexistenttokenxyz', {
                workspaceId: 'ws-p95',
                includeHighlights: true,
                limit: 5,
            })
            expect(emptyHighlights.entries).toEqual([])
            expect(emptyHighlights.highlights).toEqual([])

            const recentImp = adapter.getRecentEntries(5, undefined, 'importance', undefined, false, 'ws-p95', 1)
            expect(recentImp.entries.map((e) => e.id)).toEqual([e1.id])

            const rangeImp = adapter.searchByDateRange('2020-01-01', '2030-01-01', {
                workspaceId: 'ws-p95',
                projectNumber: 2,
                sortBy: 'importance',
                limit: 5,
            })
            expect(rangeImp.entries.map((e) => e.id)).toEqual([e2.id])

            const hubs = adapter.getRelationshipHubs(1, 'ws-p95')
            expect(hubs).toHaveLength(1)
            expect(hubs[0]?.totalLinks).toBe(1)
        } finally {
            adapter.close()
            for (const s of ['', '-wal', '-shm']) fs.rmSync(tmpDb + s, { force: true })
        }
    })

    it('A-M3, A-L1, A-L2: Migration 024 prunes 3 legacy indexes, adds id DESC to snapshots index, and skips duplicate warm check', () => {
        const db = new BetterSqlite3(':memory:')
        MigrationManager.runMigrations(db, false)
        const indexes = (
            db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]
        ).map((r) => r.name)

        expect(indexes).not.toContain('idx_memory_journal_personal')
        expect(indexes).not.toContain('idx_memory_journal_timestamp')
        expect(indexes).not.toContain('idx_memory_journal_type')
        expect(indexes).toContain('idx_memory_journal_deleted')
        expect(indexes).toContain('idx_memory_journal_active_timestamp')

        const plan = db
            .prepare(
                `EXPLAIN QUERY PLAN SELECT id, data FROM analytics_snapshots WHERE snapshot_type = 'digest' ORDER BY created_at DESC, id DESC LIMIT 1`
            )
            .all() as { detail: string }[]
        expect(plan.map((r) => r.detail).join(' ')).not.toContain('TEMP B-TREE')
        db.close()
    })

    it('B-M1a, B-M1b, B-L2: forwards validation markers across normalizer, guards payload-byte-bounds, and skips export-less spans', async () => {
        let dispatchedArgs: unknown
        const tools = createGroupApi(
            'core',
            [
                {
                    name: 'get_recent_entries',
                    title: 'Recent',
                    description: 'Recent',
                    group: 'core',
                    inputSchema: {} as never,
                    handler: async () => ({}),
                },
            ],
            async (_name, params) => {
                dispatchedArgs = params
                return { ok: true }
            }
        )
        const payload = { limit: 5, workspaceId: 'ws-p95' }
        markValidatedToolInput(payload, 100)
        await (tools['getRecentEntries'] as (arg: unknown) => Promise<unknown>)(payload)
        expect(getValidatedToolInputMax(dispatchedArgs)).toBe(100)

        const bigObj = { data: Array.from({ length: 30 }, (_, i) => i) }
        markValidatedToolInput(bigObj, 100)
        expect(validateRawPayloadSize(bigObj, 64_000, 10)).toContain('exceeds maximum')
        markValidatedToolInput(bigObj, 100)
        expect(validateRawPayloadSize(bigObj, 64_000, 100)).toBeNull()

        const code = 'return await mj.io.exportEntries({ format: "markdown" });'
        expect(rewriteModuleImportsAndExports(code)).toBe(code)
    })

    it('B-M2, B-M3, B-M5, B-L4: uses PK-only live checks, iterative chunks, timed rebuild yields, and single embedding validation', async () => {
        const hasActiveEntry = vi.fn(() => true)
        const getActiveEntryIds = vi.fn(() => new Set([1]))
        const getEntryById = vi.fn(() => null)
        const getEntriesByIds = vi.fn(() => new Map())
        const pkAdapter = { hasActiveEntry, getActiveEntryIds, getEntryById, getEntriesByIds } as unknown as IDatabaseAdapter

        expect(isEntryLiveForVectorUpsert(pkAdapter, 1, new Set())).toBe(true)
        expect(hasActiveEntry).toHaveBeenCalledTimes(1)
        expect(getEntryById).not.toHaveBeenCalled()

        const filtered = filterLiveVectorsForUpsert(
            pkAdapter,
            [
                { entryId: 1, embedding: new Float32Array(4) },
                { entryId: 2, embedding: new Float32Array(4) },
            ],
            new Set()
        )
        expect(filtered.map((f) => f.entryId)).toEqual([1])
        expect(getActiveEntryIds).toHaveBeenCalledTimes(1)
        expect(getEntriesByIds).not.toHaveBeenCalled()

        const entries = [makeEntry(1, 'A'), makeEntry(2, 'B'), makeEntry(3, 'C')]
        const batches: number[][] = []
        await upsertEntryChunksSequentially(
            entries,
            2,
            async (texts) => texts.map(() => ({ status: 'fulfilled' as const, value: new Float32Array([1, 2]) })),
            (items) => batches.push(items.map((i) => i.entryId)),
            () => undefined
        )
        expect(batches).toEqual([[1, 2], [3]])

        const mockRebuildDb = {
            getActiveEntryCount: () => 2,
            hasVectors: () => true,
            getEntriesPage: () => ({ entries: entries.slice(0, 2), total: 2 }),
            getExistingVectorIds: () => new Set([1, 2]),
            cleanupStaleVectors: () => undefined,
        } as unknown as IDatabaseAdapter
        const mockRebuildMgr = {
            isDisposed: () => false,
            hasCustomEmbeddingGenerator: () => false,
            generateEmbeddingsSettled: async () => [],
            filterLiveVectors: <T>(v: T[]) => v,
        } as unknown as VectorSearchManager
        const rebuildRes = await rebuildIndex(mockRebuildMgr, mockRebuildDb, undefined, { pageSize: 2 })
        expect(rebuildRes.success).toBe(true)
        expect(rebuildRes.indexed).toBe(0)

        const validVec = await generateValidatedSingleEmbedding({
            text: 'pass95-unique-embed-key',
            modelName: 'test-model',
            bypassQueryCache: true,
            hasCustomGenerator: true,
            hasTransformers: false,
            initialize: async () => undefined,
            getDimensions: () => 3,
            getPipeline: () => async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) }),
            isDisposed: () => false,
        })
        expect(validVec.length).toBe(3)
    })

    it('B-M4, B-L1, B-L3: reuses pre-frozen context, caches raw sandbox script, and fast-paths egress primitives', () => {
        const deepFrozen = Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, {
            workspace_id: 'ws-p95',
            nested: Object.freeze({ arr: Object.freeze([1, 2]) }),
        }))
        const ctxProxy = createContextProxy(deepFrozen, true)
        expect((ctxProxy['nested'] as { arr: number[] }).arr).toEqual([1, 2])
        const { contextProxy } = createContextNamespaceProxy(deepFrozen, true)
        expect((contextProxy as Record<string, unknown>)['workspace_id']).toBe('ws-p95')

        setCachedRawSandboxScript('return 7', { ok: false, error: 'synthetic' })
        expect(getCachedRawSandboxScript('return 7')).toEqual({ ok: false, error: 'synthetic' })

        const numRes = { success: true, result: Infinity, metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 } }
        serializeAndEnforceEgress(numRes, 1024)
        expect(numRes.result).toBeNull()

        const bigStrRes = { success: true, result: 'a'.repeat(200), metrics: { wallTimeMs: 0, cpuTimeMs: 0, memoryUsedMb: 0 } }
        serializeAndEnforceEgress(bigStrRes, 64)
        expect(bigStrRes.success).toBe(false)
        expect(bigStrRes.error).toContain('Output limit exceeded')
    })

    it('C-M1, C-M2, C-L1, C-L3: avoids delete deopts, reuses briefing cache on empty session, and preserves snake_case identity', () => {
        const withMeta = injectTokenEstimate({ ok: true, _meta: { custom: 'yes', tokenEstimate: 1 } }) as {
            _meta: { tokenEstimate: number; custom: string }
        }
        expect(withMeta._meta.tokenEstimate).toBe(1)
        const injected = injectTokenEstimate({ ok: true, _meta: { custom: 'yes' } }) as {
            _meta: { tokenEstimate: number }
        }
        expect(injected._meta.tokenEstimate).toBeGreaterThan(0)

        const roots = ['/tmp/root']
        const r1 = resolveActiveBriefingConfig(DEFAULT_BRIEFING_CONFIG, roots)
        const r2 = resolveActiveBriefingConfig(DEFAULT_BRIEFING_CONFIG, roots, {})
        expect(r2).toBe(r1)

        const snakeInput = { workspace_id: 'ws-p95', nested: { limit: 5 } }
        expect(deepCamelToSnake(snakeInput)).toBe(snakeInput)
        expect(estimateOperationResultTokens({ ok: true, count: 2 }, 'test_op')).toBeGreaterThan(0)
    })

    it('D-H1 & R-1: prefetches lightweight commit files with renames and fetches GitHub repoInfo when cached is null', async () => {
        const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass95-git-'))
        try {
            const gitOpts = { cwd: tmpRepo, stdio: 'ignore' as const }
            execFileSync('git', ['init'], gitOpts)
            execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts)
            execFileSync('git', ['config', 'user.name', 'Test'], gitOpts)
            fs.writeFileSync(path.join(tmpRepo, 'a.txt'), 'hello\n')
            execFileSync('git', ['add', 'a.txt'], gitOpts)
            execFileSync('git', ['commit', '-m', 'feat: init'], gitOpts)
            execFileSync('git', ['mv', 'a.txt', 'b.txt'], gitOpts)
            execFileSync('git', ['commit', '-m', 'refactor: rename'], gitOpts)

            const prefetched = await prefetchCommitFilesSince('2020-01-01T00:00:00.000Z', tmpRepo, 10)
            expect(prefetched.length).toBe(2)
            expect(prefetched[0]?.files).toContainEqual({ file: 'b.txt', oldFile: 'a.txt' })
            expect(prefetched[1]?.files).toContainEqual({ file: 'a.txt' })
        } finally {
            fs.rmSync(tmpRepo, { recursive: true, force: true })
        }

        const getRepoInfo = vi.fn(async () => ({ owner: 'neverinfamous', repo: 'memory-journal-mcp' }))
        const mockGithub = {
            getCachedRepoInfo: () => null,
            getRepoInfo,
        } as unknown as GitHubIntegration
        await enrichCommits(os.tmpdir(), [], mockGithub)
        expect(getRepoInfo).toHaveBeenCalledTimes(1)
    })

    it('D-M1, D-M2, D-L1 & AP1-AP4: progressive team search, RBAC check skip, hoisted schemas, and Pass 95 prompt revision', async () => {
        const searchCandidates = vi.fn(async () => [{ entryId: 10, distance: 0.1, similarityScore: 0.9 }])
        const search = vi.fn(async () => [])
        const teamDb = {
            getEntriesByIds: () => new Map([[10, makeEntry(10, 'Team match')]]),
            getTagsForEntries: () => new Map(),
            searchEntries: () => ({ entries: [] }),
            isTeamRbacActive: () => false,
        } as unknown as IDatabaseAdapter
        const teamResults = await collectTeamSearchEntries(
            'match',
            teamDb,
            { searchCandidates, search } as unknown as VectorSearchManager,
            { limit: 5, workspaceId: 'ws-pass95', teamAccessAuthorized: true }
        )
        expect(searchCandidates).toHaveBeenCalledTimes(1)
        expect(search).not.toHaveBeenCalled()
        expect(teamResults).toHaveLength(1)

        const isTeamRbacActive = vi.fn(() => true)
        const rbacDb = {
            isTeamRbacActive,
            getTeamMember: () => ({ role: 'admin' }),
            resolveTeamRole: () => 'admin',
        } as unknown as IDatabaseAdapter
        expect(resolveScopedTeamRole(rbacDb, 'alice', 'denied', 'ws-pass95', true)).toBe('admin')
        expect(isTeamRbacActive).not.toHaveBeenCalled()

        const ctx = {} as ToolContext
        expect(getDiagnosticTools(ctx)[1]?.inputSchema).toBe(getDiagnosticTools(ctx)[1]?.inputSchema)
        expect(getTeamVectorTools(ctx)[1]?.inputSchema).toBe(getTeamVectorTools(ctx)[1]?.inputSchema)
        expect(getKanbanTools(ctx)[0]?.inputSchema).toBe(getKanbanTools(ctx)[0]?.inputSchema)

        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass95')
        const promptText =
            getPerformanceAuditPromptDefinition().handler(
                { target: 'memory-journal-mcp' },
                { searchByDateRange: () => ({ entries: [] }) } as unknown as IDatabaseAdapter
            ).messages[0]?.content.text ?? ''
        expect(promptText).toContain('snippet()')
        expect(promptText).toContain('await self(nextOffset)')
    })
})
