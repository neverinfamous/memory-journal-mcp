import { test, beforeAll, afterAll } from 'vitest'
import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let readVm: VectorSearchManager
let writeVm: VectorSearchManager
let readDb: DatabaseAdapter
let writeDb: DatabaseAdapter
const benchId = `${String(process.pid)}-${String(Date.now())}`
const readDbPath = path.join(os.tmpdir(), `mj-bench-vector-read-${benchId}.db`)
const writeDbPath = path.join(os.tmpdir(), `mj-bench-vector-write-${benchId}.db`)

let savedEncKey: string | undefined
let savedDbEncKey: string | undefined
let savedLogLevel: string | undefined

function makeUnitVec(seed: number): Float32Array {
    const vec = new Float32Array(384)
    let sumSq = 0
    for (let i = 0; i < 384; i++) {
        const v = Math.cos((seed + 1) * (i + 1) * 0.13)
        vec[i] = v
        sumSq += v * v
    }
    const norm = Math.sqrt(sumSq)
    for (let i = 0; i < 384; i++) {
        vec[i] = (vec[i] ?? 0) / norm
    }
    return vec
}

function removeDbFiles(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            const p = `${dbPath}${suffix}`
            if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
            // ignore
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

    readDb = new DatabaseAdapter(readDbPath)
    writeDb = new DatabaseAdapter(writeDbPath)
    await readDb.initialize()
    await writeDb.initialize()

    const queryVec = makeUnitVec(42)
    readVm = new VectorSearchManager(readDb)
    readVm.generateEmbedding = () => Promise.resolve(queryVec)
    await readVm.initialize()

    writeVm = new VectorSearchManager(writeDb)
    writeVm.generateEmbedding = () => Promise.resolve(queryVec)
    await writeVm.initialize()

    const readItems: { entryId: number; embedding: Float32Array }[] = []
    const writeItems: { entryId: number; embedding: Float32Array }[] = []
    readDb.executeInTransaction(() => {
        for (let i = 0; i < 100; i++) {
            const ws = i >= 80 ? 'bench-ws' : 'default'
            const entry = readDb.createEntry({
                workspaceId: ws,
                projectNumber: 1,
                content: `Vector benchmark entry ${i} content`,
            })
            const vecSeed = i === 90 ? 42 : i
            readItems.push({ entryId: entry.id, embedding: makeUnitVec(vecSeed) })
        }
    })
    readDb.upsertVectors(readItems)

    writeDb.executeInTransaction(() => {
        for (let i = 0; i < 100; i++) {
            const entry = writeDb.createEntry({
                workspaceId: 'default',
                projectNumber: 1,
                content: `Write vector benchmark entry ${i} content`,
            })
            writeItems.push({ entryId: entry.id, embedding: makeUnitVec(i) })
        }
    })
    writeDb.upsertVectors(writeItems)

    const probeHits = await readVm.search('Vector benchmark entry 42', 10, 0.1)
    if (probeHits.length === 0) {
        throw new Error('Benchmark pre-flight failed for vector search')
    }
    const scopedHits = await readVm.search('Vector benchmark entry 42', 10, 0.1, 'bench-ws', 1)
    if (scopedHits.length === 0) {
        throw new Error('Benchmark pre-flight failed for scoped vector search')
    }
    await writeVm.addEntry({
        id: 1,
        workspaceId: 'default',
        projectNumber: 1,
        content: 'Pre-flight warm entry 1',
        entryType: 'personal_reflection',
        timestamp: new Date().toISOString(),
        isPersonal: true,
        tags: [],
    })
})

afterAll(() => {
    readDb.close()
    writeDb.close()
    removeDbFiles(readDbPath)
    removeDbFiles(writeDbPath)
    if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
    if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    if (savedLogLevel !== undefined) process.env['LOG_LEVEL'] = savedLogLevel
    else delete process.env['LOG_LEVEL']
})

test('search', async ({ bench }) => {
    await bench('search', async () => {
        await readVm.search('Vector benchmark entry 42', 10, 0.1)
    }).run()
})

test('search (scoped workspace + project)', async ({ bench }) => {
    await bench('search (scoped workspace + project)', async () => {
        await readVm.search('Vector benchmark entry 42', 10, 0.1, 'bench-ws', 1)
    }).run()
})

test('addEntry', async ({ bench }) => {
    await bench('addEntry', async () => {
        const id = Math.floor(Math.random() * 100) + 1
        await writeVm.addEntry({
            id,
            workspaceId: 'default',
            projectNumber: 1,
            content: `New content for adding id ${id}`,
            entryType: 'personal_reflection',
            timestamp: new Date().toISOString(),
            isPersonal: true,
            tags: [],
        })
    }).run()
})
