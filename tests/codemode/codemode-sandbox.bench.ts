import { test, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { validateSandboxCode } from '../../src/codemode/security.js'
import { healCodeModeScript } from '../../src/handlers/tools/codemode/code-healer.js'
import {
    disposeCodemodeResources,
    getOrCreateCodemodeBundle,
} from '../../src/handlers/tools/codemode/singleton-state.js'
import { callTool } from '../../src/handlers/tools/index.js'
import type { ToolContext } from '../../src/types/index.js'
import { logger, type LogLevel } from '../../src/utils/logger.js'

let db: DatabaseAdapter
const runtime = new ServerRuntime()
const benchId = `${String(process.pid)}-${String(Date.now())}`
const dbPath = path.join(os.tmpdir(), `mj-bench-codemode-${benchId}.db`)
const registry = { 'bench-ws': { path: process.cwd(), project_number: 1 } }
const config = {
    runtime,
    projectRegistry: registry,
    defaultWorkspaceId: 'bench-ws',
    defaultProjectNumber: 1,
    codemodeEnabled: true,
}

let sessionContext: ToolContext
let savedEncKey: string | undefined
let savedDbEncKey: string | undefined
let savedLogLevel: string | undefined

const CLEAN_SCRIPT =
    'const res = await mj.core.getRecentEntries({ limit: 5, workspace_id: "bench-ws" }); return res.entries?.length ?? 0;'
const ALIASED_SCRIPT =
    'import { readFileSync } from "node:fs"; const r = await mj.core.getRecentEntries({ limit: 5 }); return r;'

function removeDbFiles(targetPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            const p = `${targetPath}${suffix}`
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

    db = new DatabaseAdapter(dbPath)
    await db.initialize()
    db.executeInTransaction(() => {
        for (let i = 0; i < 50; i++) {
            db.createEntry({
                workspaceId: 'bench-ws',
                projectNumber: 1,
                content: `Code Mode benchmark entry ${i}`,
                entryType: 'technical_note',
            })
        }
    })
    const nativeDb = (
        db as unknown as { connection: { getNativeDb: () => { exec: (sql: string) => void } } }
    ).connection.getNativeDb()
    nativeDb.exec('ANALYZE')
    sessionContext = { db, config }

    const validationProbe = validateSandboxCode(CLEAN_SCRIPT)
    if (!validationProbe.valid) {
        throw new Error(`Benchmark pre-flight failed for validateSandboxCode: ${validationProbe.errors.join(', ')}`)
    }
    const bundleProbe = getOrCreateCodemodeBundle(sessionContext, sessionContext, false)
    if (!bundleProbe.journalApi) {
        throw new Error('Benchmark pre-flight failed for getOrCreateCodemodeBundle')
    }
    const execProbe = (await callTool(
        'mj_execute_code',
        { code: 'return 1 + 1', workspace_id: 'bench-ws' },
        db,
        undefined,
        undefined,
        config
    )) as { success?: boolean; result?: unknown; error?: unknown }
    if (execProbe.success !== true || execProbe.result !== 2) {
        throw new Error(`Benchmark pre-flight failed for mj_execute_code: ${JSON.stringify(execProbe)}`)
    }
})

afterAll(() => {
    disposeCodemodeResources()
    db.close()
    removeDbFiles(dbPath)
    if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
    if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    if (savedLogLevel !== undefined) process.env['LOG_LEVEL'] = savedLogLevel
    else delete process.env['LOG_LEVEL']
    logger.setLevel((savedLogLevel ?? 'info') as LogLevel)
})

test('validateSandboxCode (valid script)', async ({ bench }) => {
    const runValidate = validateSandboxCode
    await bench('validateSandboxCode (valid script)', () => {
        runValidate(CLEAN_SCRIPT)
    }).run()
})

test('healCodeModeScript (fast-path no-op)', async ({ bench }) => {
    const runHeal = healCodeModeScript
    await bench('healCodeModeScript (fast-path no-op)', () => {
        runHeal(CLEAN_SCRIPT)
    }).run()
})

test('healCodeModeScript (import rewrite)', async ({ bench }) => {
    const runHeal = healCodeModeScript
    await bench('healCodeModeScript (import rewrite)', () => {
        runHeal(ALIASED_SCRIPT)
    }).run()
})

test('getOrCreateCodemodeBundle (warm cache hit)', async ({ bench }) => {
    const getBundle = getOrCreateCodemodeBundle
    await bench('getOrCreateCodemodeBundle (warm cache hit)', () => {
        getBundle(sessionContext, sessionContext, false)
    }).run()
})

test('callTool mj_execute_code (warm worker scalar)', async ({ bench }) => {
    await bench('callTool mj_execute_code (warm worker scalar)', async () => {
        await callTool(
            'mj_execute_code',
            { code: 'return 1 + 1', workspace_id: 'bench-ws' },
            db,
            undefined,
            undefined,
            config
        )
    }).run()
})

test('callTool mj_execute_code (warm worker RPC)', async ({ bench }) => {
    await bench('callTool mj_execute_code (warm worker RPC)', async () => {
        await callTool(
            'mj_execute_code',
            { code: CLEAN_SCRIPT, workspace_id: 'bench-ws' },
            db,
            undefined,
            undefined,
            config
        )
    }).run()
})
