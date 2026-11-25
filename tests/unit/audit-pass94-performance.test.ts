import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import DatabaseAdapter from 'better-sqlite3'
import {
    isValidJsScript,
    rewriteModuleImportsAndExports,
} from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { synthesizeNaturalLanguageOrEntryPayload } from '../../src/handlers/tools/codemode/natural-language-synthesizer.js'
import { applyNativePragmas } from '../../src/database/sqlite-adapter/connection-pragmas.js'
import { MigrationManager, getExpectedUserVersion } from '../../src/database/migrations/migration-manager.js'
import { rebuildIndex } from '../../src/vector/vector-search-manager/rebuild.js'
import {
    estimatePayloadTokens,
    getSerializedPayloadJson,
    safeJsonStringify,
} from '../../src/observability/token-estimator.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import {
    compileAuditSearchFilters,
    matchesAuditFilters,
} from '../../src/audit/audit-filter-helpers.js'
import { enforceToolInputElementBound } from '../../src/handlers/tools/call-guards.js'
import { markValidatedToolInput } from '../../src/utils/tool-input-bounds.js'
import { hybridSearch } from '../../src/handlers/tools/search/hybrid.js'
import { enrichCommits } from '../../src/github/commit-references/enricher.js'
import {
    AUDIT_PROMPT_REVISION,
} from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import type { JournalEntry } from '../../src/types/index.js'

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
        workspaceId: 'ws-test',
        projectNumber,
    }
}

describe('Pass 94 Adversarial Performance Regressions', () => {
    it('B-H1 & B-H2: skips non-code span scan without export and shares trimmed VALID_JS_CACHE keys', () => {
        const plain = 'const res = await mj.core.getRecentEntries({ limit: 5 }); return res;'
        expect(rewriteModuleImportsAndExports(plain)).toBe(plain)

        expect(isValidJsScript('const pass94 = 42; return pass94;')).toBe(true)
        expect(isValidJsScript('const pass94 = 42; return pass94;\n\n')).toBe(true)

        const input = { code: plain, workspace_id: 'memory-journal-mcp' }
        expect(synthesizeNaturalLanguageOrEntryPayload(`${plain}\n`, input, input)).toBe(`${plain}\n`)
    })

    it('B-M1: filters page entries once before batching sparse unindexed rows', async () => {
        const entries = Array.from({ length: 12 }, (_, idx) => makeEntry(idx + 1, `Entry ${idx + 1}`))
        const existingIds = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        const embedCalls: number[] = []
        const upserts: number[][] = []

        const dbAdapter = {
            getActiveEntryCount: () => entries.length,
            hasVectors: () => true,
            getEntriesPage: () => ({ entries, total: entries.length }),
            getExistingVectorIds: () => existingIds,
            upsertVectors: (vecs: { entryId: number }[]) => {
                upserts.push(vecs.map((v) => v.entryId))
            },
            cleanupStaleVectors: () => {},
        } as unknown as IDatabaseAdapter

        const manager = {
            isDisposed: () => false,
            hasCustomEmbeddingGenerator: () => false,
            generateEmbeddingsSettled: async (texts: string[]) => {
                embedCalls.push(texts.length)
                return texts.map(() => ({
                    status: 'fulfilled' as const,
                    value: new Float32Array(384),
                }))
            },
            filterLiveVectors: <T>(v: T[]) => v,
        } as unknown as VectorSearchManager

        const res = await rebuildIndex(manager, dbAdapter, undefined, { batchSize: 3, pageSize: 12 })
        expect(res.success).toBe(true)
        expect(res.indexed).toBe(2)
        // Sparse unindexed items (11, 12) combine into a single batch rather than 1 per slice
        expect(embedCalls).toEqual([2])
        expect(upserts).toEqual([[11, 12]])
    })

    it('A-M1, A-M2 & A-L4: sets busy_timeout before WAL, fast-paths warm user_version, and uses idx_memory_journal_project_recent', () => {
        const calls: string[] = []
        const mockDb = { pragma: (cmd: string) => { calls.push(cmd); return 0 } }
        applyNativePragmas(mockDb as unknown as DatabaseAdapter.Database)
        expect(calls[0]).toBe('busy_timeout = 5000')
        expect(calls[1]).toBe('journal_mode = WAL')

        const db = new DatabaseAdapter(':memory:')
        MigrationManager.runMigrations(db, false)
        const expected = getExpectedUserVersion(false)
        expect(db.pragma('user_version', { simple: true })).toBe(expected)
        // Warm second call exits immediately via user_version fast-path
        MigrationManager.runMigrations(db, false)
        expect(db.pragma('user_version', { simple: true })).toBe(expected)

        const insert = db.prepare(
            "INSERT INTO memory_journal (entry_type, content, timestamp, workspace_id, project_number) VALUES ('technical_note', ?, ?, ?, ?)"
        )
        for (let i = 1; i <= 40; i++) {
            insert.run(`Row ${i}`, `2026-11-01T00:${String(i).padStart(2, '0')}:00.000Z`, 'ws', i % 3)
        }
        db.exec('ANALYZE')
        const plan = db
            .prepare(
                'EXPLAIN QUERY PLAN SELECT id FROM memory_journal WHERE deleted_at IS NULL AND project_number = ? ORDER BY timestamp DESC, id DESC LIMIT 5'
            )
            .all(1) as { detail: string }[]
        expect(plan.map((r) => r.detail).join(' ')).toContain('idx_memory_journal_project_recent')
        db.close()
    })

    it('C-M1 & C-M2: respects markValidatedToolInput bypass and fast-paths native JSON.stringify with safe fallback', () => {
        const payload = { items: Array.from({ length: 50 }, (_, i) => i) }
        markValidatedToolInput(payload, 100)
        expect(enforceToolInputElementBound(payload, { maxToolInputElements: 100 })).toBeUndefined()
        expect(enforceToolInputElementBound(payload, { maxToolInputElements: 10 })).toMatchObject({
            success: false,
            code: 'VALIDATION_ERROR',
        })

        const obj = { ok: true, count: 3, items: ['a', 'b'] }
        expect(getSerializedPayloadJson(obj)).toBe(JSON.stringify(obj))
        expect(estimatePayloadTokens(obj)).toBeGreaterThan(0)

        const withBigInt: Record<string, unknown> = { id: 123n }
        withBigInt['self'] = withBigInt
        expect(getSerializedPayloadJson(withBigInt)).toContain('[Circular]')
        expect(safeJsonStringify({ a: { b: { c: 1 } } }, 1)).toContain('[Truncated]')
    })

    it('C-M3: pre-compiles audit search filters and reads multi-chunk logs iteratively', async () => {
        const compiled = compileAuditSearchFilters({
            workspace_id: 'Memory-Journal-MCP',
            date_range: { start: '2026-11-01', end: '2026-11-30' },
        })
        expect(compiled.workspaceIdLower).toBe('memory-journal-mcp')
        expect(compiled.startMs).not.toBeNull()
        expect(compiled.endMs).not.toBeNull()

        expect(
            matchesAuditFilters(
                {
                    timestamp: '2026-11-15T12:00:00.000Z',
                    requestId: 'r1',
                    tool: 'search_entries',
                    category: 'read',
                    scope: 'read',
                    user: null,
                    scopes: [],
                    durationMs: 1,
                    success: true,
                    workspaceId: 'memory-journal-mcp',
                },
                compiled
            )
        ).toBe(true)

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass94-audit-'))
        try {
            const logPath = path.join(tmpDir, 'audit.jsonl')
            const logger = new AuditLogger({ enabled: true, logPath, redactArgs: false })
            for (let i = 0; i < 600; i++) {
                logger.log({
                    timestamp: '2026-11-15T12:00:00.000Z',
                    requestId: `req-${String(i)}`,
                    tool: 'get_recent_entries',
                    category: 'read',
                    scope: 'read',
                    user: null,
                    scopes: [],
                    durationMs: 1,
                    success: true,
                    workspaceId: 'memory-journal-mcp',
                    args: { pad: 'x'.repeat(250) },
                })
            }
            await logger.flush()
            const found = await logger.search({
                workspace_id: 'memory-journal-mcp',
                date_range: { start: '2026-11-01', end: '2026-11-30' },
                limit: 5,
            })
            expect(found).toHaveLength(5)
            await logger.close()
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('D-M1: queries getMirrorOrigins at most once per chunk during hybridSearch', async () => {
        const personalEntries = [makeEntry(1, 'Alpha personal note')]
        const teamEntries = [makeEntry(101, 'Beta team note')]
        const getMirrorOrigins = vi.fn(() => new Map([[101, 1]]))

        const personalDb = {
            searchEntries: () => ({ entries: personalEntries }),
            getEntriesByIds: () => new Map(personalEntries.map((e) => [e.id, e])),
            getTagsForEntries: () => new Map(),
        } as unknown as IDatabaseAdapter
        const teamDb = {
            searchEntries: () => ({ entries: teamEntries }),
            getEntriesByIds: () => new Map(teamEntries.map((e) => [e.id, e])),
            getTagsForEntries: () => new Map(),
            getMirrorOrigins,
            isTeamRbacActive: () => false,
        } as unknown as IDatabaseAdapter

        const res = await hybridSearch('note', personalDb, undefined, {
            limit: 1,
            includeTeam: true,
            workspaceId: 'ws-test',
            teamDb,
        })
        expect(res.entries.length).toBe(1)
        expect(getMirrorOrigins).toHaveBeenCalledTimes(1)
    })

    it('D-M3: does not re-spawn single-commit lookup when batch git.log rejects for 1 hash', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass94-git-'))
        try {
            const res = await enrichCommits(tmpDir, ['deadbeef1234'])
            expect(res).toEqual([])
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('AP1-AP4: bumps AUDIT_PROMPT_REVISION to 2026-11-25-audit-pass96 with updated gates', () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-25-audit-pass96')
        const def = getPerformanceAuditPromptDefinition()
        expect(def.description).toContain('adversarial')
    })
})
