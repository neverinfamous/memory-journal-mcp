import { test, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let readDb: DatabaseAdapter
let writeDb: DatabaseAdapter
const readRuntime = new ServerRuntime()
const writeRuntime = new ServerRuntime()
const registry = { 'bench-ws': { path: process.cwd(), project_number: 1 } }
const readConfig = {
    runtime: readRuntime,
    projectRegistry: registry,
    defaultWorkspaceId: 'bench-ws',
    defaultProjectNumber: 1,
}
const writeConfig = {
    runtime: writeRuntime,
    projectRegistry: registry,
    defaultWorkspaceId: 'bench-ws',
    defaultProjectNumber: 1,
}
const benchId = `${String(process.pid)}-${String(Date.now())}`
const readDbPath = path.join(os.tmpdir(), `mj-bench-server-read-${benchId}.db`)
const writeDbPath = path.join(os.tmpdir(), `mj-bench-server-write-${benchId}.db`)

let savedEncKey: string | undefined
let savedDbEncKey: string | undefined

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
    delete process.env['MJ_DB_ENCRYPTION_KEY']
    delete process.env['DB_ENCRYPTION_KEY']

    readDb = new DatabaseAdapter(readDbPath)
    writeDb = new DatabaseAdapter(writeDbPath)
    await readDb.initialize()
    await writeDb.initialize()

    // Setup initial read dataset isolated from write benchmark mutations
    for (let i = 0; i < 1000; i++) {
        readDb.createEntry({
            workspaceId: 'bench-ws',
            projectNumber: 1,
            content: `Server benchmark tool entry ${i} ${Math.random().toString(36)}`,
            entryType: 'decision',
        })
    }

    const probeRecent = (await callTool(
        'get_recent_entries',
        { workspace_id: 'bench-ws', limit: 50 },
        readDb,
        undefined,
        undefined,
        readConfig
    )) as { success?: boolean; entries?: unknown[]; error?: unknown }
    if (probeRecent.success === false || 'error' in probeRecent || !Array.isArray(probeRecent.entries) || probeRecent.entries.length === 0) {
        throw new Error(`Benchmark pre-flight failed for get_recent_entries: ${JSON.stringify(probeRecent)}`)
    }

    const probeSearch = (await callTool(
        'search_entries',
        { workspace_id: 'bench-ws', query: 'benchmark', limit: 20 },
        readDb,
        undefined,
        undefined,
        readConfig
    )) as { success?: boolean; entries?: unknown[]; error?: unknown }
    if (probeSearch.success === false || 'error' in probeSearch || !Array.isArray(probeSearch.entries) || probeSearch.entries.length === 0) {
        throw new Error(`Benchmark pre-flight failed for search_entries: ${JSON.stringify(probeSearch)}`)
    }

    const probeCreate = (await callTool(
        'create_entry',
        {
            workspace_id: 'bench-ws',
            project_number: 1,
            content: '## Summary\nBench creation pre-flight entry text over a tool call',
            entry_type: 'technical_note',
            impact_score: 0.5,
            trust_score: 0.9,
            validation_status: 'passed',
        },
        writeDb,
        undefined,
        undefined,
        writeConfig
    )) as { success?: boolean; error?: unknown }
    if (probeCreate.success !== true || 'error' in probeCreate) {
        throw new Error(`Benchmark pre-flight failed for create_entry: ${JSON.stringify(probeCreate)}`)
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

test('getTools', async ({ bench }) => {
    const getToolsFn = getTools
    await bench('getTools', () => {
        getToolsFn(readDb, null, undefined, undefined, readConfig)
    }).run()
})

test('callTool get_recent_entries', async ({ bench }) => {
    await bench('callTool get_recent_entries', async () => {
        await callTool(
            'get_recent_entries',
            { workspace_id: 'bench-ws', limit: 50 },
            readDb,
            undefined,
            undefined,
            readConfig
        )
    }).run()
})

test('callTool search_entries', async ({ bench }) => {
    await bench('callTool search_entries', async () => {
        await callTool(
            'search_entries',
            { workspace_id: 'bench-ws', query: 'benchmark', limit: 20 },
            readDb,
            undefined,
            undefined,
            readConfig
        )
    }).run()
})

test('callTool create_entry', async ({ bench }) => {
    await bench('callTool create_entry', async () => {
        await callTool(
            'create_entry',
            {
                workspace_id: 'bench-ws',
                project_number: 1,
                content: '## Summary\nBench creation entry text over a tool call',
                entry_type: 'technical_note',
                impact_score: 0.5,
                trust_score: 0.9,
                validation_status: 'passed',
            },
            writeDb,
            undefined,
            undefined,
            writeConfig
        )
    }).run()
})
