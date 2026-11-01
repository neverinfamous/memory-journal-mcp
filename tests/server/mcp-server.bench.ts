import { test, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

let db: DatabaseAdapter
const runtime = new ServerRuntime()
const config = { runtime }
const testDbPath = path.join(process.cwd(), 'benchmark-server-tools.db')

beforeAll(async () => {
    db = new DatabaseAdapter(testDbPath)
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

test('getTools', async ({ bench }) => {
    const getToolsFn = getTools
    await bench('getTools', () => {
        getToolsFn(db, null, undefined, undefined, config)
    }).run()
})

test('callTool get_recent_entries', async ({ bench }) => {
    await bench('callTool get_recent_entries', async () => {
        await callTool(
            'get_recent_entries',
            { limit: 50 },
            db,
            undefined,
            undefined,
            config
        )
    }).run()
})

test('callTool search_entries', async ({ bench }) => {
    await bench('callTool search_entries', async () => {
        await callTool(
            'search_entries',
            { query: 'benchmark', limit: 20 },
            db,
            undefined,
            undefined,
            config
        )
    }).run()
})

test('callTool create_entry', async ({ bench }) => {
    await bench('callTool create_entry', async () => {
        await callTool(
            'create_entry',
            {
                project_number: 1,
                workspace_id: 'default',
                content: 'Bench creation entry text over a tool call',
                entry_type: 'personal_reflection',
            },
            db,
            undefined,
            undefined,
            config
        )
    }).run()
})
