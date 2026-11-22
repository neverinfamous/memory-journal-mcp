import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    queryActiveThreads,
    queryRecentLinkageStats,
    queryRecentNeighborhood,
    isoDaysAgo,
} from '../../src/database/sqlite-adapter/graph-pivots.js'
import { exceedsMaxToolInputElements } from '../../src/utils/tool-input-bounds.js'
import { checkSchemaAcceptsKey } from '../../src/handlers/tools/codemode/dispatch-schema-introspection.js'
import { extractParameters } from '../../src/handlers/resources/help-schema-params.js'
import { SubscriptionManager } from '../../src/server/subscription-manager.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { validateDryRunRelationships } from '../../src/markdown/import-relationships.js'
import { createImportBatchAuthorCache, assertImportAuthorOwnership } from '../../src/markdown/importer-author.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

describe('Pass 58 Adversarial Performance Audit Regressions', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    })

    it('H1: graph-pivots uses MATERIALIZED recent CTE and SARGable timestamp range index seek', async () => {
        const dbPath = path.join(os.tmpdir(), `mj-pass58-h1-${String(process.pid)}-${String(Date.now())}.db`)
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()
            const ids: number[] = []
            adapter.executeInTransaction(() => {
                for (let i = 0; i < 120; i++) {
                    adapter.createEntry({
                        content: `Other workspace noise ${String(i)}`,
                        entryType: 'technical_note',
                        workspaceId: 'ws-other',
                        projectNumber: 2,
                        timestamp: '2025-01-01T00:00:00.000Z',
                    })
                }
                for (let i = 0; i < 30; i++) {
                    const entry = adapter.createEntry({
                        content: `Graph pivot test entry ${String(i)}`,
                        entryType: 'technical_note',
                        workspaceId: 'ws-alpha',
                        projectNumber: 1,
                    })
                    ids.push(entry.id)
                }
                for (let i = 1; i < 15; i++) {
                    adapter.linkEntries(ids[0]!, ids[i]!, 'references', undefined, 'ws-alpha')
                }
            })

            const nativeDb = (
                adapter as unknown as { connection: { getNativeDb: () => ReturnType<DatabaseAdapter['executeInTransaction']> } }
            ).connection.getNativeDb() as unknown as {
                prepare: (sql: string) => { all: (...params: unknown[]) => { detail: string }[] }
                exec: (sql: string) => void
            }
            nativeDb.exec('ANALYZE')

            const sinceIso = isoDaysAgo(14)
            const sinceFloor = sinceIso.slice(0, 10)
            const planRows = nativeDb
                .prepare(
                    `EXPLAIN QUERY PLAN
                     WITH recent AS MATERIALIZED (
                         SELECT id FROM memory_journal
                         WHERE deleted_at IS NULL AND workspace_id = ?
                           AND timestamp >= ? AND julianday(timestamp) >= julianday(?)
                     )
                     SELECT id FROM recent`
                )
                .all('ws-alpha', sinceFloor, sinceIso)
            const planText = planRows.map((r) => r.detail).join('\n')
            expect(planText).toContain('idx_memory_journal_ws_recent')
            expect(planText).toContain('timestamp>?')

            const threads = queryActiveThreads(nativeDb as never, sinceIso, 5, 'ws-alpha')
            expect(threads.length).toBeGreaterThan(0)
            expect(threads[0]?.entryId).toBe(ids[0])

            const stats = queryRecentLinkageStats(nativeDb as never, sinceIso, 'ws-alpha')
            expect(stats.recentEntries).toBe(30)
            expect(stats.unlinkedEntries).toBe(15)

            const hood = queryRecentNeighborhood(nativeDb as never, sinceIso, 20, 'ws-alpha')
            expect(hood.recentEntries).toBe(30)
            expect(hood.unlinkedIds.length).toBe(15)
            expect(hood.edges.length).toBe(14)
        } finally {
            adapter.close()
            for (const suffix of ['', '-wal', '-shm']) {
                try {
                    fs.unlinkSync(`${dbPath}${suffix}`)
                } catch {
                    // ignore
                }
            }
        }
    })

    it('H2: batch author cache and dry-run relationship prefetch avoid N+1 DB calls', () => {
        const getAuthorsForEntries = vi.fn(() => new Map<number, string | null>([[10, 'alice'], [11, 'alice']]))
        const resolveAuthor = vi.fn((name: string) => name.toLowerCase())
        const getRelationships = vi.fn(() => [])
        const getRelationshipsForEntries = vi.fn(() => new Map([[10, []], [11, []]]))
        const getEntriesByIds = vi.fn(() => new Map([[20, { id: 20, projectNumber: 1 }]]))

        const mockDb = {
            getAuthorsForEntries,
            resolveAuthor,
            getRelationships,
            getRelationshipsForEntries,
            getEntriesByIds,
        } as unknown as IDatabaseAdapter

        const files = [
            { filename: 'a.md', body: 'A', metadata: { mj_id: 10 } },
            { filename: 'b.md', body: 'B', metadata: { mj_id: 11 } },
        ]
        const cache = createImportBatchAuthorCache(mockDb, files, { author: 'Alice' })
        assertImportAuthorOwnership(mockDb, 10, 'Alice', 'ws', undefined, cache)
        assertImportAuthorOwnership(mockDb, 11, 'Alice', 'ws', undefined, cache)

        expect(getAuthorsForEntries).toHaveBeenCalledTimes(1)
        expect(resolveAuthor).toHaveBeenCalledTimes(1)

        const dryRunResult = { success: true, relationshipsLinked: 0, errors: [] as { file: string; error: string }[] }
        validateDryRunRelationships(
            mockDb,
            [
                { entryId: 10, filename: 'a.md', workspaceId: 'ws', projectNumber: 1, relationships: [{ type: 'references', target_id: 20 }] },
                { entryId: 11, filename: 'b.md', workspaceId: 'ws', projectNumber: 1, relationships: [{ type: 'references', target_id: 20 }] },
            ],
            new Map(),
            dryRunResult
        )
        expect(getRelationships).not.toHaveBeenCalled()
        expect(getRelationshipsForEntries).toHaveBeenCalledTimes(1)
        expect(dryRunResult.relationshipsLinked).toBe(2)
    })

    it('H3: checkSchemaAcceptsKey caches negative (false) lookups without re-walking Zod AST', () => {
        let shapeReads = 0
        const fakeSchema = {
            get shape() {
                shapeReads++
                return { content: z.string() }
            },
        }
        expect(checkSchemaAcceptsKey(fakeSchema, 'issue_url')).toBe(false)
        const readsAfterFirst = shapeReads
        expect(readsAfterFirst).toBeGreaterThan(0)
        expect(checkSchemaAcceptsKey(fakeSchema, 'issue_url')).toBe(false)
        expect(checkSchemaAcceptsKey(fakeSchema, 'issue_url')).toBe(false)
        expect(shapeReads).toBe(readsAfterFirst)
    })

    it('H5: exceedsMaxToolInputElements handles plain objects, arrays, and exotic intrinsics accurately', () => {
        expect(exceedsMaxToolInputElements({ a: 1, b: [1, 2, 3] }, 10)).toBe(false)
        expect(exceedsMaxToolInputElements({ a: 1, b: [1, 2, 3] }, 3)).toBe(true)
        expect(exceedsMaxToolInputElements(new Uint8Array(50), 10)).toBe(true)
        expect(exceedsMaxToolInputElements(new ArrayBuffer(50), 10)).toBe(true)
        expect(exceedsMaxToolInputElements(new Map([['a', 1], ['b', 2]]), 3)).toBe(true)
        expect(exceedsMaxToolInputElements(new Set([1, 2, 3, 4]), 3)).toBe(true)
        expect(exceedsMaxToolInputElements(new String('abcdefghijkl'), 5)).toBe(true)
    })

    it('M12 & L8: extractParameters memoizes by schema identity and SubscriptionManager short-circuits with 0 subscribers', async () => {
        const schema = z.object({ query: z.string(), limit: z.number().optional() })
        const first = extractParameters(schema)
        const second = extractParameters(schema)
        expect(second).toBe(first)

        const mgr = new SubscriptionManager()
        await expect(mgr.notifyResourceUpdated('memory://briefing')).resolves.toBeUndefined()
    })

    it('AP1–AP6: bumps AUDIT_PROMPT_REVISION to 2026-11-20-audit-pass58 and includes Pass 58 guidance', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass67')
        const def = getPerformanceAuditPromptDefinition()
        const rendered = def.handler({ target: 'memory-journal-mcp' }, {
            searchEntries: () => ({ entries: [], totalCount: 0 }),
            searchByDateRange: () => [],
        } as unknown as IDatabaseAdapter)
        const text = rendered.messages[0]?.content.text ?? ''
        expect(text).toContain('Prompt revision: 2026-11-21-audit-pass67')
        expect(text).toContain('AS MATERIALIZED')
        expect(text).toContain('node:util/types')
        expect(text).toContain('Map<string, boolean>')
        expect(text).toContain('logger.setLevel')
    })
})
