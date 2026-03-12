import { bench, beforeAll, afterAll } from 'vitest'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import { SqliteAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

let vm: VectorSearchManager
let db: SqliteAdapter
const testDbPath = path.join(process.cwd(), 'benchmark-vector.db')
const testVectorPath = path.join(process.cwd(), 'benchmark-vector-index')

beforeAll(async () => {
    db = new SqliteAdapter(testDbPath)
    await db.initialize()

    vm = new VectorSearchManager(testVectorPath)

    // Mock the embedding generation to skip transformer inference delay
    vm.generateEmbedding = async () => new Float32Array(384).fill(Math.random())

    await vm.initialize()

    // Setup some data
    for (let i = 0; i < 100; i++) {
        const entry = db.createEntry({
            content: `Vector benchmark entry ${i} content`,
        })
        await vm.addEntry(entry.id, entry.content)
    }
})

afterAll(() => {
    db.close()
    try {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath)
        }
        if (fs.existsSync(testVectorPath)) {
            fs.rmSync(testVectorPath, { recursive: true, force: true })
        }
    } catch {
        // ignore
    }
})

bench('addEntry', async () => {
    const id = Math.floor(Math.random() * 1000000)
    await vm.addEntry(id, `New content for adding id ${id}`)
})

bench('search', async () => {
    await vm.search('Vector benchmark entry 42', 10, 0.1)
})
