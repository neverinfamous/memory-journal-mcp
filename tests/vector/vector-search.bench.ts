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
    delete process.env['MJ_DB_ENCRYPTION_KEY']
    delete process.env['DB_ENCRYPTION_KEY']

    readDb = new DatabaseAdapter(readDbPath)
    writeDb = new DatabaseAdapter(writeDbPath)
    await readDb.initialize()
    await writeDb.initialize()

    const unitVal = 1 / Math.sqrt(384)
    const unitVec = new Float32Array(384).fill(unitVal)

    readVm = new VectorSearchManager(readDb)
    readVm.generateEmbedding = () => Promise.resolve(unitVec)
    await readVm.initialize()

    writeVm = new VectorSearchManager(writeDb)
    writeVm.generateEmbedding = () => Promise.resolve(unitVec)
    await writeVm.initialize()

    for (let i = 0; i < 100; i++) {
        const entry = readDb.createEntry({ content: `Vector benchmark entry ${i} content` })
        await readVm.addEntry(entry)
    }

    const probeHits = await readVm.search('Vector benchmark entry 42', 10, 0.1)
    if (probeHits.length === 0) {
        throw new Error('Benchmark pre-flight failed for vector search')
    }
})

afterAll(() => {
    readDb.close()
    writeDb.close()
    removeDbFiles(readDbPath)
    removeDbFiles(writeDbPath)
    if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
    if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
})

test('search', async ({ bench }) => {
    await bench('search', async () => {
        await readVm.search('Vector benchmark entry 42', 10, 0.1)
    }).run()
})

test('addEntry', async ({ bench }) => {
    await bench('addEntry', async () => {
        const id = Math.floor(Math.random() * 100) + 1
        await writeVm.addEntry({
            id,
            content: `New content for adding id ${id}`,
            entryType: 'personal_reflection',
            timestamp: new Date().toISOString(),
            isPersonal: true,
            tags: [],
        })
    }).run()
})
