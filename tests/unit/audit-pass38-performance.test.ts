import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MigrationManager } from '../../src/database/migrations/migration-manager.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import {
    clearSharedEmbeddingCache,
    getOrComputeCachedEmbedding,
} from '../../src/vector/vector-search-manager/embedding-cache.js'
import { hybridSearch } from '../../src/handlers/tools/search/hybrid.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { wrapToolHandlerWithInterceptors, injectProjectNames } from '../../src/handlers/tools/arg-interceptions.js'
import {
    getSerializedPayloadJson,
    injectTokenEstimate,
} from '../../src/observability/token-estimator.js'
import {
    getOrCompileVmScript,
    resolveWorkerMetadata,
} from '../../src/codemode/worker/script-and-metadata-cache.js'
import { safeDeleteVectors } from '../../src/handlers/tools/admin/batch-vector-helpers.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

function createTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('Audit Pass 38 Performance Remediations', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        clearSharedEmbeddingCache()
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()
            if (dir !== undefined) {
                fs.rmSync(dir, { recursive: true, force: true })
            }
        }
    })

    it('Migration 018 uses idx_memory_journal_ws_proj_recent without temp B-tree sorting', () => {
        const rawDb = new Database(':memory:')
        try {
            MigrationManager.applyTeamMigrations(rawDb)
            const insert = rawDb.prepare(
                `INSERT INTO memory_journal (content, entry_type, timestamp, is_personal, workspace_id, project_number)
                 VALUES (?, 'technical_note', ?, 1, 'bench-ws', 5)`
            )
            const tx = rawDb.transaction(() => {
                for (let i = 0; i < 50; i++) {
                    insert.run(`Entry ${String(i)}`, `2026-11-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`)
                }
            })
            tx()
            rawDb.exec('ANALYZE')

            const planRows = rawDb
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT * FROM memory_journal
                     WHERE deleted_at IS NULL AND workspace_id = ? AND project_number = ?
                     ORDER BY timestamp DESC, id DESC LIMIT 50`
                )
                .all('bench-ws', 5) as { detail: string }[]
            const details = planRows.map((r) => r.detail).join(' | ')

            expect(details).toContain('USING INDEX idx_memory_journal_ws_proj_recent')
            expect(details).not.toContain('TEMP B-TREE')
        } finally {
            rawDb.close()
        }
    })

    it('shares cross-instance query embeddings with defensive copies, deduplicates in-flight calls, and bypasses custom generators', async () => {
        let computeCalls = 0
        const computeRaw = async (): Promise<Float32Array> => {
            computeCalls++
            await Promise.resolve()
            return new Float32Array([0.5, 0.25, 0.75])
        }

        const [first, second] = await Promise.all([
            getOrComputeCachedEmbedding('minilm-test', 'shared query', true, computeRaw),
            getOrComputeCachedEmbedding('minilm-test', 'shared query', true, computeRaw),
        ])
        expect(computeCalls).toBe(1)
        expect(Array.from(first)).toEqual([0.5, 0.25, 0.75])
        expect(Array.from(second)).toEqual([0.5, 0.25, 0.75])

        // Mutating caller copy must not corrupt cached vector
        first[0] = -999
        const third = await getOrComputeCachedEmbedding('minilm-test', 'shared query', true, computeRaw)
        expect(computeCalls).toBe(1)
        expect(third[0]).toBe(0.5)

        // Custom-generator bypass (canCache = false) always recomputes
        await getOrComputeCachedEmbedding('minilm-test', 'shared query', false, computeRaw)
        expect(computeCalls).toBe(2)

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const vm = new VectorSearchManager(db)
            vm.generateEmbedding = async () => new Float32Array(384).fill(0.1)
            expect(vm.hasCustomEmbeddingGenerator()).toBe(true)
        } finally {
            db.close()
        }
    })

    it('hydrates hybridSearch candidates via progressive RRF chunks without fetching every vector hit', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const ids: number[] = []
            db.executeInTransaction(() => {
                for (let i = 0; i < 60; i++) {
                    const created = db.createEntry({
                        workspaceId: 'hybrid-ws',
                        projectNumber: 5,
                        content: `RRF progressive test entry ${String(i)}`,
                    })
                    ids.push(created.id)
                }
            })

            const spyGetByIds = vi.spyOn(db, 'getEntriesByIds')
            const mockVectorMgr = {
                searchCandidates: vi.fn().mockResolvedValue(
                    ids.slice(0, 50).map((entryId, idx) => ({
                        entryId,
                        score: 0.99 - idx * 0.01,
                    }))
                ),
            } as unknown as VectorSearchManager

            const res = await hybridSearch('nonexistent-fts-token-xyz', db, mockVectorMgr, {
                limit: 5,
                workspaceId: 'hybrid-ws',
                projectNumber: 5,
            })

            expect(res.entries).toHaveLength(5)
            const totalRequestedIds = spyGetByIds.mock.calls.reduce(
                (sum, call) => sum + (call[0]?.length ?? 0),
                0
            )
            expect(totalRequestedIds).toBeLessThan(50)
            expect(totalRequestedIds).toBeGreaterThanOrEqual(5)
        } finally {
            db.close()
        }
    })

    it('dispatches ProgressContext through AsyncLocalStorage while keeping toolMapCache warm', async () => {
        const dir = createTempDir('mj-p38-als-')
        tempDirs.push(dir)
        const dbPath = path.join(dir, 'journal.db')
        const db = new DatabaseAdapter(dbPath)
        await db.initialize()
        try {
            db.createEntry({
                workspaceId: 'als-ws',
                projectNumber: 5,
                content: 'Entry for ALS progress verification',
            })
            const runtime = new ServerRuntime()
            const config = {
                runtime,
                projectRegistry: { 'als-ws': { path: dir, project_number: 5 } },
                defaultWorkspaceId: 'als-ws',
                defaultProjectNumber: 5,
            }

            await callTool(
                'get_recent_entries',
                { workspace_id: 'als-ws', limit: 5 },
                db,
                undefined,
                undefined,
                config
            )
            const warmMap = runtime.toolMapCache
            expect(warmMap).toBeDefined()

            const notifications: unknown[] = []
            const backupRes = (await callTool(
                'backup_journal',
                { name: 'als-verify' },
                db,
                undefined,
                undefined,
                config,
                {
                    server: {
                        notification: async (payload: unknown) => {
                            notifications.push(payload)
                        },
                    } as never,
                    progressToken: 'tok-p38',
                }
            )) as { success?: boolean }

            expect(backupRes.success).toBe(true)
            expect(runtime.toolMapCache).toBe(warmMap)
            expect(notifications.length).toBeGreaterThanOrEqual(2)
        } finally {
            db.close()
        }
    })

    it('preserves projectName inside cached serialized payload when injectTokenEstimate splices _meta', async () => {
        const config = {
            projectRegistry: {
                'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
            },
        }
        const wrapped = wrapToolHandlerWithInterceptors(
            'get_entry_by_id',
            () => ({ success: true, entry: { id: 1, projectNumber: 5, content: 'hello' } }),
            config
        )
        const handled = await wrapped({})
        // Second injectProjectNames call (as in callTool) must remain idempotent and keep cache valid
        injectProjectNames(handled, config.projectRegistry)
        const enriched = injectTokenEstimate(handled) as Record<string, unknown>
        const json = getSerializedPayloadJson(enriched)
        const parsed = JSON.parse(json) as {
            entry?: { projectName?: string }
            _meta?: { tokenEstimate?: number }
        }

        expect(parsed.entry?.projectName).toBe('memory-journal-mcp')
        expect(typeof parsed._meta?.tokenEstimate).toBe('number')
        expect(parsed._meta?.tokenEstimate).toBeGreaterThan(0)
        expect(parsed).toEqual(enriched)
    })

    it('caches compiled vm.Script instances with bounded LRU and reuses warm worker metadata', () => {
        const s1 = getOrCompileVmScript('(async () => { return 1 + 1; })()')
        const s2 = getOrCompileVmScript('(async () => { return 1 + 1; })()')
        expect(s1).toBe(s2)

        // Filling beyond 64 evicts oldest key without crashing or growing unboundedly
        for (let i = 0; i < 70; i++) {
            getOrCompileVmScript(`(async () => { return ${String(i)}; })()`)
        }
        const evictedRecompiled = getOrCompileVmScript('(async () => { return 1 + 1; })()')
        expect(evictedRecompiled).not.toBe(s1)

        const initial = resolveWorkerMetadata({
            methodList: { core: ['getRecentEntries'] },
            schemaList: { core: { getRecentEntries: '(): Promise<unknown>' } },
        })
        const warmOmitted = resolveWorkerMetadata({})
        expect(warmOmitted.methodList).toEqual(initial.methodList)
        expect(warmOmitted.schemaList).toEqual(initial.schemaList)
    })

    it('uses batched db.deleteVectors fast path in safeDeleteVectors even when vectorManager has removeEntry', () => {
        const mockDb = {
            deleteVectors: vi.fn(),
            deleteVector: vi.fn(),
        } as unknown as Parameters<typeof safeDeleteVectors>[0]
        const mockVm = {
            removeEntry: vi.fn(),
        } as unknown as Parameters<typeof safeDeleteVectors>[2]

        const warnings = safeDeleteVectors(mockDb, [10, 20, 30], mockVm)
        expect(warnings).toEqual([])
        expect((mockDb as unknown as { deleteVectors: ReturnType<typeof vi.fn> }).deleteVectors).toHaveBeenCalledTimes(1)
        expect((mockDb as unknown as { deleteVectors: ReturnType<typeof vi.fn> }).deleteVectors).toHaveBeenCalledWith([10, 20, 30])
        expect((mockVm as unknown as { removeEntry: ReturnType<typeof vi.fn> }).removeEntry).not.toHaveBeenCalled()
    })

    it('bumps AUDIT_PROMPT_REVISION to 2026-11-18-audit-pass38 and includes AP1-AP7 portable guidance', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass96')
        const def = getPerformanceAuditPromptDefinition()
        const rendered = await Promise.resolve(def.handler({ target: 'memory-journal-mcp' }, {
            searchByDateRange: () => [],
            getEntriesByIds: () => new Map(),
        } as never))
        const text = rendered.messages.map((m) => m.content.text).join('\n')

        expect(text).toContain('Prompt revision: 2026-11-25-audit-pass96')
        expect(text).toContain('PRAGMA optimize')
        expect(text).toContain('progressive chunk hydration')
        expect(text).toContain('AsyncLocalStorage')
        expect(text).toContain('sentinel-splice')
        expect(text).toContain('execFileSync')
        expect(text).toContain('.partial().loose()')
    })
})
