import { bench, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

let db: SqliteAdapter
const testDbPath = path.join(process.cwd(), 'benchmark-server-tools.db')

beforeAll(async () => {
    db = new SqliteAdapter(testDbPath)
    await db.initialize()

    // Setup initial data
    for (let i = 0; i < 1000; i++) {
        db.createEntry({
            content: `Server benchmark tool entry ${i} ${Math.random().toString(36)}`,
            entryType: 'decision',
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
        // Ignore signup errors
    }
})

bench('getTools', () => {
    getTools(db, null)
})

bench('callTool create_entry', async () => {
    await callTool(
        'create_entry',
        {
            content: 'Bench creation entry text over a tool call',
            entry_type: 'personal_reflection',
        },
        db
    )
})

bench('callTool get_recent_entries', async () => {
    await callTool('get_recent_entries', { limit: 50 }, db)
})

bench('callTool search_entries', async () => {
    await callTool('search_entries', { query: 'benchmark', limit: 20 }, db)
})
