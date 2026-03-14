import { bench, beforeAll, afterAll } from 'vitest'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

let vm: VectorSearchManager
let db: DatabaseAdapter
const testDbPath = './benchmark-vector.db'

beforeAll(async () => {
    db = new DatabaseAdapter(testDbPath)
    await db.initialize()

    vm = new VectorSearchManager(db)

    // Mock the embedding generation to skip transformer inference delay
    vm.generateEmbedding = async () => Array.from(new Float32Array(384).fill(Math.random()))

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
