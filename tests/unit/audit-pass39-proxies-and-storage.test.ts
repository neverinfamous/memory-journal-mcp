/**
 * Pass 39 adversarial code-quality tests: worker proxy invariants & collections,
 * SQLite update anchors / empty-string normalization / chunking / self-loops / FK checks,
 * restore path & registry guards, markdown path converters, and vector workspace bounds.
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRegisterProjectFn } from '../../src/codemode/api/project-registry-ops.js'
import { buildApiProxy } from '../../src/codemode/worker-api-proxy.js'
import { wrapResult } from '../../src/codemode/worker-result-proxy.js'
import { createSearchDomainProxy } from '../../src/codemode/worker/mj-shim-domains.js'
import { resolveWorkerMetadata } from '../../src/codemode/worker/script-and-metadata-cache.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { applySwappedDatabase, resolveValidatedRestorePath } from '../../src/database/sqlite-adapter/backup-helpers.js'
import { acquireRestoreLock } from '../../src/database/sqlite-adapter/restore-lock.js'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { exportEntriesToMarkdown } from '../../src/markdown/exporter.js'
import { importMarkdownEntries } from '../../src/markdown/importer.js'
import { convertNotion } from '../../src/markdown/converters/notion.js'
import { convertObsidian } from '../../src/markdown/converters/obsidian.js'
import { isValidProjectPath } from '../../src/utils/project-registry-guards.js'
import { searchSimilarEntriesById } from '../../src/vector/vector-search-manager/candidate-search.js'

const tempDirs: string[] = []
let savedEncKey: string | undefined
let savedMjConfig: string | undefined

function makeTempDir(prefix = 'mj-pass39-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

function makeProjectLocalDir(): string {
    const base = path.join(process.cwd(), '.test-output')
    fs.mkdirSync(base, { recursive: true })
    const dir = fs.mkdtempSync(path.join(base, 'pass39-md-'))
    tempDirs.push(dir)
    return dir
}

beforeEach(() => {
    savedEncKey = process.env['DB_ENCRYPTION_KEY']
    savedMjConfig = process.env['MEMORY_JOURNAL_CONFIG']
    process.env['DB_ENCRYPTION_KEY'] = ''
})

afterEach(() => {
    vi.restoreAllMocks()
    if (savedEncKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
    else process.env['DB_ENCRYPTION_KEY'] = savedEncKey
    if (savedMjConfig === undefined) delete process.env['MEMORY_JOURNAL_CONFIG']
    else process.env['MEMORY_JOURNAL_CONFIG'] = savedMjConfig
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe('pass 39 proxies and storage', () => {
    it('H2/M4/M5: freezes cached worker metadata, copies help(), enforces proxy invariants, and forwards nested collections', async () => {
        const meta = resolveWorkerMetadata({
            methodList: { core: ['getRecentEntries', 'createEntry'] },
            schemaList: { core: { getRecentEntries: '(opts?) => Promise<unknown>' } },
        })
        expect(Object.isFrozen(meta.methodList['core'])).toBe(true)
        expect(() => (meta.methodList['core'] as string[]).push('evil')).toThrow()

        const api = buildApiProxy(() => Promise.resolve({ success: true }), meta.methodList, meta.schemaList)
        const coreProxy = api['core'] as { help: () => Promise<{ methods: string[] }> }
        const helpRes = await coreProxy.help()
        expect(helpRes.methods).toEqual(['getRecentEntries', 'createEntry'])
        helpRes.methods.push('mutated')
        expect(meta.methodList['core']).toEqual(['getRecentEntries', 'createEntry'])

        expect(Object.isExtensible(coreProxy)).toBe(true)
        expect(() => Object.preventExtensions(coreProxy)).toThrow(TypeError)

        const searchProxy = createSearchDomainProxy(api) as object
        expect(Object.isExtensible(searchProxy)).toBe(true)
        expect(() => Object.preventExtensions(searchProxy)).toThrow(TypeError)

        const failedProxy = wrapResult({ success: false, error: 'boom', entries: [] }) as object
        expect(Object.isExtensible(failedProxy)).toBe(true)
        expect(() => Object.preventExtensions(failedProxy)).toThrow(TypeError)
        expect(() => Reflect.get(failedProxy, 'entries')).toThrow(/boom/)

        const changelogWrapped = wrapResult({
            success: true,
            changelog: { commits: [{ sha: 'abc123' }, { sha: 'def456' }] },
        }) as { length: number; [n: number]: { sha: string }; map: (fn: (c: { sha: string }) => string) => string[]; items: { sha: string }[]; [Symbol.iterator]: () => Iterator<{ sha: string }> }
        expect(changelogWrapped.length).toBe(2)
        expect(changelogWrapped[0]?.sha).toBe('abc123')
        expect(changelogWrapped.map((c) => c.sha)).toEqual(['abc123', 'def456'])
        expect(Array.from(changelogWrapped)).toHaveLength(2)
        expect(changelogWrapped.items).toHaveLength(2)

        const revWrapped = wrapResult({ success: true, revisions: [{ version: 2 }] }) as { length: number }
        expect(revWrapped.length).toBe(1)
    })

    it('H4/L2: replaces anchors on updateEntry, normalizes empty strings, and round-trips markdown anchors', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const created = db.createEntry({
                content: 'Initial entry content',
                significanceType: 'decision',
                issueUrl: 'https://example.com/issues/1',
                anchors: [{ anchorPath: 'src/old.ts', anchorType: 'file' }],
            })
            expect(db.getAnchorsByEntryId(created.id).map((a) => a.anchorPath)).toEqual(['src/old.ts'])

            const updated = db.updateEntry(created.id, {
                content: 'Updated entry content',
                significanceType: '',
                issueUrl: '',
                anchors: [{ anchorPath: 'src/new.ts', anchorType: 'file' }],
            })
            if (updated === null) throw new Error('Expected updated entry')
            expect(updated.significanceType).toBeNull()
            expect(updated.issueUrl).toBeNull()
            expect(db.getAnchorsByEntryId(created.id).map((a) => a.anchorPath)).toEqual(['src/new.ts'])

            const mdDir = makeProjectLocalDir()
            const exp = await exportEntriesToMarkdown([updated], mdDir, db, [mdDir])
            expect(exp.exported_count).toBe(1)
            const exportedPath = path.join(mdDir, exp.files[0] ?? '')
            const rawMd = fs.readFileSync(exportedPath, 'utf8')
            expect(rawMd).toContain('"anchors":')
            expect(rawMd).toContain('src/new.ts')

            const dryRunRes = await importMarkdownEntries(mdDir, db, { dry_run: true }, undefined, [mdDir])
            expect(dryRunRes.success).toBe(true)

            const freshDb = new DatabaseAdapter(':memory:')
            await freshDb.initialize()
            try {
                const impRes = await importMarkdownEntries(mdDir, freshDb, {}, undefined, [mdDir])
                expect(impRes.created).toBe(1)
                const imported = freshDb.getRecentEntries(1).entries[0]
                expect(freshDb.getAnchorsByEntryId(imported?.id ?? 0).map((a) => a.anchorPath)).toEqual([
                    'src/new.ts',
                ])
            } finally {
                freshDb.close()
            }
        } finally {
            db.close()
        }
    })

    it('M7/L6/M12: validates restore PID locks, foreign keys on swap, registry paths, and converter slashes', async () => {
        const lockRoot = makeTempDir()
        const lockDir = path.join(lockRoot, 'restore.lock.d')
        const lockFile = path.join(lockDir, 'lock.json')
        fs.mkdirSync(lockDir, { recursive: true })
        fs.writeFileSync(lockFile, JSON.stringify({ pid: -1, timestamp: Date.now() }))
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
        expect(() => acquireRestoreLock(lockDir, lockFile, undefined)).toThrow(/holding the database lock/i)
        expect(killSpy).not.toHaveBeenCalledWith(-1, 0)

        await expect(resolveValidatedRestorePath(lockRoot, 'CON.db')).rejects.toThrow(/Invalid or unsafe/i)
        await expect(resolveValidatedRestorePath(lockRoot, 'bad:stream.db')).rejects.toThrow(/Invalid or unsafe/i)
        await expect(resolveValidatedRestorePath(lockRoot, '%2e%2e/evil.db')).rejects.toThrow(/Invalid or unsafe/i)

        expect(isValidProjectPath('D:\\Windows\\System32')).toBe(false)
        expect(isValidProjectPath('C:\\work\\repo:ads')).toBe(false)
        expect(isValidProjectPath('C:\\work\\%2e%2e\\evil')).toBe(false)
        expect(isValidProjectPath('C:\\work\\safe-repo')).toBe(true)

        const cfgDir = makeTempDir()
        const cfgPath = path.join(cfgDir, 'memory-journal.config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ projectRegistry: { Alpha: { path: cfgDir, project_number: 5 } } }))
        process.env['MEMORY_JOURNAL_CONFIG'] = cfgPath
        const registerFn = createRegisterProjectFn({})
        const dupKey = await registerFn('alpha', cfgDir, 6)
        expect(dupKey.success).toBe(false)
        const badNum = await registerFn('beta', cfgDir, -3)
        expect(badNum.success).toBe(false)

        const notion = convertNotion('# Title\nBody', 'Engineering a8f90123456789012345678901234567\\Arch\\Doc.md')
        expect(notion.metadata.tags).toEqual(['engineering', 'arch'])
        const obsidian = convertObsidian('# Daily', 'Vault\\2026-11-18-standup.md')
        expect(obsidian.metadata.entry_type).toBe('standup')

        const fkDir = makeTempDir()
        const sourceDb = path.join(fkDir, 'source.db')
        const targetDb = path.join(fkDir, 'target.db')
        const seedDb = new Database(targetDb)
        seedDb.close()
        const badConn = new NativeConnectionManager(sourceDb)
        await badConn.initialize()
        const rawNative = badConn.getNativeDb()
        rawNative.pragma('foreign_keys = OFF')
        rawNative.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(999999, 999999)
        badConn.close()

        const swapConn = new NativeConnectionManager(targetDb)
        try {
            await expect(applySwappedDatabase(swapConn, sourceDb)).rejects.toThrow(/Foreign key check failed/i)
        } finally {
            swapConn.close()
        }
    })

    it('M11/L8: buckets >500 tag/insight SQL binds, excludes self-loops, and isolates prefetched vector workspaces', async () => {
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        try {
            const createdIds: number[] = []
            db.executeInTransaction(() => {
                for (let i = 1; i <= 520; i++) {
                    const e = db.createEntry({
                        content: `Entry ${String(i)}`,
                        tags: ['old-bulk-tag'],
                        projectNumber: i,
                    })
                    createdIds.push(e.id)
                }
            })

            const merged = db.mergeTags('old-bulk-tag', 'new-bulk-tag')
            expect(merged.entriesUpdated).toBe(520)
            expect(merged.sourceDeleted).toBe(true)

            const insights = db.getCrossProjectInsights({ minEntries: 1, inactiveThresholdDays: 30 })
            expect(insights.projects.length).toBeGreaterThanOrEqual(520)

            const selfId = createdIds[0] ?? 1
            db.linkEntries(selfId, selfId, 'relates_to')
            expect(db.getRelationshipHubs(10)).toEqual([])
            expect(db.calculateImportance(selfId)?.breakdown.relationships).toBe(0)

            await expect(
                searchSimilarEntriesById(
                    db,
                    () => Promise.resolve(new Float32Array([1, 0, 0])),
                    selfId,
                    5,
                    0.1,
                    'ws-target',
                    undefined,
                    {
                        id: selfId,
                        content: 'Entry 1',
                        entryType: 'technical_note',
                        timestamp: '2026-11-18T00:00:00Z',
                        isPersonal: false,
                        workspaceId: 'ws-other',
                    }
                )
            ).rejects.toThrow(/not found/)
        } finally {
            db.close()
        }
    })
})
