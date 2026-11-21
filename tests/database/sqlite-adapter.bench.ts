import { test, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { logger, type LogLevel } from '../../src/utils/logger.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let readDb: DatabaseAdapter
let writeDb: DatabaseAdapter
let updateDb: DatabaseAdapter
const benchId = `${String(process.pid)}-${String(Date.now())}`
const readDbPath = path.join(os.tmpdir(), `mj-bench-adapter-read-${benchId}.db`)
const writeDbPath = path.join(os.tmpdir(), `mj-bench-adapter-write-${benchId}.db`)
const updateDbPath = path.join(os.tmpdir(), `mj-bench-adapter-update-${benchId}.db`)

let savedEncKey: string | undefined
let savedDbEncKey: string | undefined
let savedLogLevel: string | undefined
let batch50Ids: number[] = []

function removeDbFiles(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            const p = `${dbPath}${suffix}`
            if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
            // Ignore cleanup errors
        }
    }
}

beforeAll(async () => {
    savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
    savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
    savedLogLevel = process.env['LOG_LEVEL']
    delete process.env['MJ_DB_ENCRYPTION_KEY']
    delete process.env['DB_ENCRYPTION_KEY']
    process.env['LOG_LEVEL'] = 'error'
    logger.setLevel('error')

    readDb = new DatabaseAdapter(readDbPath)
    writeDb = new DatabaseAdapter(writeDbPath)
    updateDb = new DatabaseAdapter(updateDbPath)
    await readDb.initialize()
    await writeDb.initialize()
    await updateDb.initialize()

    const seedDataset = (targetDb: DatabaseAdapter, withGraph: boolean, splitWs: boolean): void => {
        targetDb.executeInTransaction(() => {
            for (let i = 0; i < 1000; i++) {
                const ws = splitWs && i >= 800 ? 'bench-ws' : 'default'
                const entry = targetDb.createEntry({
                    workspaceId: ws,
                    projectNumber: 1,
                    content: `Initial data entry ${i} for benchmarking read operations. This is some dummy content to make the entry a bit larger. ${Math.random().toString(36).substring(7)}`,
                    entryType: i % 2 === 0 ? 'personal_reflection' : 'project_decision',
                    tags: [`tag-${i % 10}`],
                    isPersonal: i % 3 === 0,
                    ...(withGraph
                        ? {
                              anchors: [
                                  { anchorPath: `src/mod-${i % 50}.ts`, anchorType: 'file' },
                                  { anchorPath: `tests/mod-${i % 50}.test.ts`, anchorType: 'file' },
                              ],
                          }
                        : {}),
                })
                if (withGraph && i > 1 && i !== 800 && i !== 801) {
                    targetDb.linkEntries(entry.id, entry.id - 1, 'references', undefined, ws)
                    targetDb.linkEntries(entry.id, entry.id - 2, 'evolves_from', undefined, ws)
                }
            }
        })
    }

    seedDataset(readDb, true, true)
    seedDataset(writeDb, false, false)
    seedDataset(updateDb, false, false)
    batch50Ids = Array.from({ length: 50 }, (_, idx) => idx * 10 + 1)

    if (readDb.getRecentEntries(50).entries.length === 0) {
        throw new Error('Benchmark pre-flight failed for getRecentEntries')
    }
    if (readDb.getRecentEntries(50, undefined, 'timestamp', undefined, false, 'bench-ws', 1).entries.length === 0) {
        throw new Error('Benchmark pre-flight failed for scoped getRecentEntries')
    }
    if (readDb.searchEntries('dummy content', { limit: 20 }).entries.length === 0) {
        throw new Error('Benchmark pre-flight failed for searchEntries')
    }
    if (readDb.calculateImportance(10) === null) {
        throw new Error('Benchmark pre-flight failed for calculateImportance')
    }
    if (readDb.getEntriesByIds(batch50Ids, 'default').size !== 50) {
        throw new Error('Benchmark pre-flight failed for getEntriesByIds (batch 50)')
    }
    if (updateDb.updateEntry(1, { content: 'Pre-flight update verification' }) === null) {
        throw new Error('Benchmark pre-flight failed for updateEntry')
    }
})

afterAll(() => {
    readDb.close()
    writeDb.close()
    updateDb.close()
    removeDbFiles(readDbPath)
    removeDbFiles(writeDbPath)
    removeDbFiles(updateDbPath)
    if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
    if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    if (savedLogLevel !== undefined) process.env['LOG_LEVEL'] = savedLogLevel
    else delete process.env['LOG_LEVEL']
    logger.setLevel((savedLogLevel ?? 'info') as LogLevel)
})

test('getRecentEntries (limit 50)', async ({ bench }) => {
    await bench('getRecentEntries (limit 50)', () => {
        readDb.getRecentEntries(50)
    }).run()
})

test('getRecentEntries (scoped workspace + project)', async ({ bench }) => {
    await bench('getRecentEntries (scoped workspace + project)', () => {
        readDb.getRecentEntries(50, undefined, 'timestamp', undefined, false, 'bench-ws', 1)
    }).run()
})

test('getEntriesByIds (batch 50)', async ({ bench }) => {
    await bench('getEntriesByIds (batch 50)', () => {
        readDb.getEntriesByIds(batch50Ids, 'default')
    }).run()
})

test('searchEntries (content match)', async ({ bench }) => {
    await bench('searchEntries (content match)', () => {
        readDb.searchEntries('dummy content', { limit: 20 })
    }).run()
})

test('calculateImportance', async ({ bench }) => {
    await bench('calculateImportance', () => {
        const randomId = Math.floor(Math.random() * 800) + 1
        readDb.calculateImportance(randomId)
    }).run()
})

test('createEntry', async ({ bench }) => {
    await bench('createEntry', () => {
        writeDb.createEntry({
            workspaceId: 'default',
            projectNumber: 1,
            content: 'Benchmark test entry content that represents a typical journal entry size.',
            entryType: 'project_decision',
            tags: ['benchmark', 'test'],
        })
    }).run()
})

test('updateEntry', async ({ bench }) => {
    await bench('updateEntry', () => {
        const randomId = Math.floor(Math.random() * 1000) + 1
        updateDb.updateEntry(randomId, {
            content: `Updated benchmark content ${Date.now()}`,
        })
    }).run()
})
