import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { DatabaseAdapterProxy } from '../../src/database/core/DatabaseAdapterProxy.js'
import { bucketInParams, DUAL_IN_PARAM_BUCKETS } from '../../src/database/sqlite-adapter/row-helpers.js'
import { levenshteinDistance } from '../../src/database/sqlite-adapter/entries/fuzzy-matcher.js'
import { VectorSearchManagerProxy } from '../../src/vector/vector-search-manager/VectorSearchManagerProxy.js'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { serializeAndEnforceEgress } from '../../src/codemode/worker/result-compactor.js'
import { readCachedConfigObject, writeProjectRegistryFile } from '../../src/utils/registry-config-file.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'

describe('Pass 34 Performance Audit Fixes & Prompt Revision', () => {
    let db: DatabaseAdapter
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(async () => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        process.env['MJ_DB_ENCRYPTION_KEY'] = ''
        process.env['DB_ENCRYPTION_KEY'] = ''
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
    })

    afterEach(() => {
        db.close()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('bumps AUDIT_PROMPT_REVISION to current pass and renders AP1-AP7 guidance cleanly', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-21-audit-pass69')
        const def = getPerformanceAuditPromptDefinition()
        const rendered = await Promise.resolve(def.handler({ target: 'memory-journal-mcp' }, db))
        const text = rendered.messages.map((m) => m.content.text).join('\n')

        expect(text).toContain('Prompt revision: 2026-11-21-audit-pass69')
        expect(text).toContain('BigInt')
        expect(text).toContain('CROSS JOIN')
        expect(text).toContain('<= 500')
        expect(text).toContain('db.inTransaction')
        expect(text).toContain('JSON.parse')
        expect(text).toContain('mtimeMs')
        expect(text).toContain('WeakMap')
        expect(text).toContain('.partial().loose()')
        expect(text).toContain('ONNX')
        expect(text).toContain('os.tmpdir()')
    })

    it('chunks SQLite IN params with bucketInParams and DUAL_IN_PARAM_BUCKETS', () => {
        const ids = Array.from({ length: 505 }, (_, i) => i + 1)
        const chunks = Array.from(bucketInParams(ids))
        expect(chunks).toHaveLength(2)
        expect(chunks[0]?.params).toHaveLength(500)
        expect(chunks[1]?.params).toHaveLength(8)
        expect(new Set(chunks[1]?.params).size).toBe(5)
        expect(chunks[1]?.placeholders).toBe('?,?,?,?,?,?,?,?')

        const dualChunks = Array.from(bucketInParams(ids, DUAL_IN_PARAM_BUCKETS))
        expect(dualChunks).toHaveLength(3)
        expect(dualChunks[0]?.params).toHaveLength(240)
        expect(dualChunks[1]?.params).toHaveLength(240)
        expect(dualChunks[2]?.params).toHaveLength(32)
        expect(new Set(dualChunks[2]?.params).size).toBe(25)
    })

    it('handles vector search sparse-workspace bounds, hasVectors, and BigInt deleteVectors', () => {
        db.createVecTable(4)
        expect(db.hasVectors()).toBe(false)

        const e1 = db.createEntry({ content: 'alpha vector entry', workspaceId: 'ws-a', projectNumber: 1 })
        const e2 = db.createEntry({ content: 'beta vector entry', workspaceId: 'ws-a', projectNumber: 1 })
        const vec = new Float32Array([0.5, 0.5, 0.5, 0.5])
        db.upsertVectors([
            { entryId: e1.id, embedding: vec },
            { entryId: e2.id, embedding: vec },
        ])
        expect(db.hasVectors()).toBe(true)

        // Sparse/empty workspace returns early without spinning k-widening loops
        expect(db.searchVectors(vec, 10, 'ws-empty')).toEqual([])
        expect(db.searchVectors(vec, 10, 'ws-a', 1)).toHaveLength(2)

        const deleted = db.deleteVectors([e1.id, e2.id])
        expect(deleted).toBe(2)
        expect(db.hasVectors()).toBe(false)
    })

    it('aligns scoped FTS/workspace importance CTEs and getImportanceScoresByIds with calculateImportance', () => {
        const e1 = db.createEntry({
            content: 'Critical sqlite performance optimization architecture',
            entryType: 'project_decision',
            significanceType: 'architecture',
            impactScore: 0.9,
            trustScore: 0.95,
            validationStatus: 'passed',
            workspaceId: 'ws-imp',
            projectNumber: 5,
        })
        const e2 = db.createEntry({
            content: 'Secondary optimization note linked cleanly',
            entryType: 'technical_note',
            impactScore: 0.6,
            trustScore: 0.8,
            validationStatus: 'passed',
            workspaceId: 'ws-imp',
            projectNumber: 5,
        })
        db.linkEntries(e1.id, e2.id, 'resolved', 'resolved bottleneck', 'ws-imp')

        const ftsImp = db.searchEntries('optimization', {
            workspaceId: 'ws-imp',
            sortBy: 'importance',
            limit: 10,
        })
        expect(ftsImp.entries.map((e) => e.id)).toEqual([e1.id, e2.id])

        const blended = db.searchEntries('optimization', {
            workspaceId: 'ws-imp',
            sortBy: 'blended',
            limit: 10,
        })
        expect(blended.entries.length).toBe(2)

        const batchScores = db.getImportanceScoresByIds([e1.id, e2.id], 'ws-imp')
        const single1 = db.calculateImportance(e1.id, 'ws-imp')
        const single2 = db.calculateImportance(e2.id, 'ws-imp')
        expect(batchScores.get(e1.id)?.score).toBe(single1?.score)
        expect(batchScores.get(e2.id)?.score).toBe(single2?.score)
    })

    it('caches bound methods in DB and vector proxies while remaining transparent to spies', () => {
        const proxy = DatabaseAdapterProxy.create(db)
        expect(proxy.getEntryById).toBe(proxy.getEntryById)

        const spy = vi.spyOn(db, 'getEntryById').mockReturnValue(null)
        expect(proxy.getEntryById(999, 'default')).toBeNull()
        expect(spy).toHaveBeenCalledTimes(1)
        spy.mockRestore()

        const vm = new VectorSearchManager(db)
        const vmProxy = VectorSearchManagerProxy.create(vm)
        expect(vmProxy.isInitialized).toBe(vmProxy.isInitialized)
        const vmSpy = vi.spyOn(vm, 'isInitialized').mockReturnValue(true)
        expect(vmProxy.isInitialized()).toBe(true)
        expect(vmSpy).toHaveBeenCalledTimes(1)
        vmSpy.mockRestore()
    })

    it('round-trips JSON.parse in serializeAndEnforceEgress to strip Proxy/symbol traps before postMessage', () => {
        const original = { items: [1, 2, 3], nested: { label: 'ok' } }
        const plainRes: { success: boolean; result?: unknown; error?: string } = {
            success: true,
            result: original,
        }
        serializeAndEnforceEgress(plainRes)
        expect(plainRes.success).toBe(true)
        expect(plainRes.result).toStrictEqual(original)

        const withProxy: { success: boolean; result?: unknown; error?: string } = {
            success: true,
            result: { items: [new Proxy({ id: 1 }, {})] },
        }
        serializeAndEnforceEgress(withProxy)
        expect(withProxy.success).toBe(true)
        expect(withProxy.result).toStrictEqual({ items: [{ id: 1 }] })

        const withBigInt: { success: boolean; result?: unknown; error?: string } = {
            success: true,
            result: { count: BigInt(42) },
        }
        serializeAndEnforceEgress(withBigInt)
        expect(withBigInt.success).toBe(true)
        expect(withBigInt.result).toEqual({ count: '42' })
    })

    it('computes rolling Levenshtein distances with maxDistance bailout and mtime-cached config reads', () => {
        expect(levenshteinDistance('sqlite', 'sqlit3')).toBe(1)
        expect(levenshteinDistance('abcdefg', 'zzzzzzz', 2)).toBeGreaterThan(2)

        const tmpFile = path.join(os.tmpdir(), `mj-cfg-cache-${String(process.pid)}-${String(Date.now())}.json`)
        try {
            writeProjectRegistryFile(tmpFile, { projectRegistry: { alpha: { path: process.cwd(), project_number: 1 } } })
            const first = readCachedConfigObject(tmpFile)
            const second = readCachedConfigObject(tmpFile)
            expect(second).toBe(first)

            writeProjectRegistryFile(tmpFile, { projectRegistry: { beta: { path: process.cwd(), project_number: 2 } } })
            const third = readCachedConfigObject(tmpFile)
            expect(third).not.toBe(first)
            expect(third?.['projectRegistry']).toHaveProperty('beta')
        } finally {
            fs.rmSync(tmpFile, { force: true })
        }
    })
})
