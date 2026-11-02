import { test, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

let db: DatabaseAdapter
const testDbPath = path.join(process.cwd(), 'benchmark-adapter.db')

beforeAll(async () => {
    db = new DatabaseAdapter(testDbPath)
    await db.initialize()

    // Setup initial data for read benchmarks
    for (let i = 0; i < 1000; i++) {
        db.createEntry({
            content: `Initial data entry ${i} for benchmarking read operations. This is some dummy content to make the entry a bit larger. ${Math.random().toString(36).substring(7)}`,
            entryType: i % 2 === 0 ? 'personal_reflection' : 'decision',
            tags: [`tag-${i % 10}`],
            isPersonal: i % 3 === 0,
        })
    }
})

afterAll(() => {
    db.close()
    try {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath)
        }
    } catch {
        // Ignore cleanup errors
    }
})

test('getRecentEntries (limit 50)', async ({ bench }) => {
    await bench('getRecentEntries (limit 50)', () => {
        db.getRecentEntries(50)
    }).run()
})

test('searchEntries (content match)', async ({ bench }) => {
    await bench('searchEntries (content match)', () => {
        db.searchEntries('dummy content', { limit: 20 })
    }).run()
})

test('calculateImportance', async ({ bench }) => {
    await bench('calculateImportance', () => {
        // Pick a random ID between 1 and 1000
        const randomId = Math.floor(Math.random() * 1000) + 1
        db.calculateImportance(randomId)
    }).run()
})

test('createEntry', async ({ bench }) => {
    await bench('createEntry', () => {
        db.createEntry({
            content: 'Benchmark test entry content that represents a typical journal entry size.',
            entryType: 'decision',
            tags: ['benchmark', 'test'],
        })
    }).run()
})

test('updateEntry', async ({ bench }) => {
    await bench('updateEntry', () => {
        // Pick a random ID between 1 and 1000
        const randomId = Math.floor(Math.random() * 1000) + 1
        db.updateEntry(randomId, {
            content: `Updated benchmark content ${Date.now()}`,
        })
    }).run()
})
