import { test, beforeAll, afterAll } from 'vitest'
import { getTools, callTool } from '../../src/handlers/tools/index.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { logger, type LogLevel } from '../../src/utils/logger.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let readDb: DatabaseAdapter
let writeDb: DatabaseAdapter
const readRuntime = new ServerRuntime()
const writeRuntime = new ServerRuntime()
const registry = { 'bench-ws': { path: process.cwd(), project_number: 1 } }
const filteredToolFilter = parseToolFilter('-team,-github')
const BENCH_SEARCH_TERMS = [
    'benchmark',
    'sqlite',
    'codemode',
    'vector',
    'briefing',
    'staleness',
    'migration',
    'telemetry',
] as const
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
let savedLogLevel: string | undefined
const mockProgressContext = {
    server: { notification: async () => {} } as never,
    progressToken: 'bench-tok',
}

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
    await readDb.initialize()
    await writeDb.initialize()

    const seedBenchDb = (db: DatabaseAdapter): void => {
        db.executeInTransaction(() => {
            for (let i = 0; i < 1000; i++) {
                const term = BENCH_SEARCH_TERMS[i % BENCH_SEARCH_TERMS.length] ?? 'benchmark'
                db.createEntry({
                    workspaceId: 'bench-ws',
                    projectNumber: 1,
                    content: `Server benchmark ${term} tool entry ${i} ${Math.random().toString(36)}`,
                    entryType: 'project_decision',
                })
            }
        })
        const nativeDb = (
            db as unknown as {
                connection: { getNativeDb: () => { exec: (sql: string) => void } }
            }
        ).connection.getNativeDb()
        nativeDb.exec('ANALYZE')
    }
    seedBenchDb(readDb)
    seedBenchDb(writeDb)

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
    if (savedLogLevel !== undefined) process.env['LOG_LEVEL'] = savedLogLevel
    else delete process.env['LOG_LEVEL']
    logger.setLevel((savedLogLevel ?? 'info') as LogLevel)
})

test('getTools', async ({ bench }) => {
    const getToolsFn = getTools
    await bench('getTools', () => {
        getToolsFn(readDb, null, undefined, undefined, readConfig)
    }).run()
})

test('getTools (filtered -team,-github)', async ({ bench }) => {
    const getToolsFn = getTools
    await bench('getTools (filtered -team,-github)', () => {
        getToolsFn(readDb, filteredToolFilter, undefined, undefined, readConfig)
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

test('callTool get_recent_entries (with progressToken)', async ({ bench }) => {
    await bench('callTool get_recent_entries (with progressToken)', async () => {
        await callTool(
            'get_recent_entries',
            { workspace_id: 'bench-ws', limit: 50 },
            readDb,
            undefined,
            undefined,
            readConfig,
            mockProgressContext
        )
    }).run()
})

let searchTermCursor = 0
test('callTool search_entries', async ({ bench }) => {
    await bench('callTool search_entries', async () => {
        const query = BENCH_SEARCH_TERMS[searchTermCursor++ % BENCH_SEARCH_TERMS.length] ?? 'benchmark'
        await callTool(
            'search_entries',
            { workspace_id: 'bench-ws', query, limit: 20 },
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
