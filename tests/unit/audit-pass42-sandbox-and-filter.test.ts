import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkerSandbox } from '../../src/codemode/worker-sandbox.js'
import { stripCommentsAndStrings } from '../../src/codemode/security-stripper.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { validateSandboxCode } from '../../src/codemode/security.js'
import { createJournalApi } from '../../src/codemode/api/journal-api.js'
import {
    hasActiveProjectRegistry,
    restoreActiveProjectRegistryState,
    captureActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../src/codemode/normalizers/project-alias-helpers.js'
import { createSafeFsShim } from '../../src/codemode/worker/node-shims.js'
import { createPreparedStatementShim } from '../../src/codemode/worker/sql-statement-shim.js'
import { isInsideStringOrComment } from '../../src/handlers/tools/codemode/code-healer-rewrites.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { isDummyToolAllowedByFilter } from '../../src/handlers/tools/dummy-filter-helpers.js'
import { callTool } from '../../src/handlers/tools/index.js'
import { getHelpResourceDefinitions } from '../../src/handlers/resources/help.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

const origEncryptionKey = process.env['DB_ENCRYPTION_KEY']
const origMjEncryptionKey = process.env['MJ_DB_ENCRYPTION_KEY']

beforeEach(() => {
    process.env['DB_ENCRYPTION_KEY'] = ''
    process.env['MJ_DB_ENCRYPTION_KEY'] = ''
})

afterEach(() => {
    setActiveProjectRegistry(undefined)
    if (origEncryptionKey === undefined) delete process.env['DB_ENCRYPTION_KEY']
    else process.env['DB_ENCRYPTION_KEY'] = origEncryptionKey
    if (origMjEncryptionKey === undefined) delete process.env['MJ_DB_ENCRYPTION_KEY']
    else process.env['MJ_DB_ENCRYPTION_KEY'] = origMjEncryptionKey
})

describe('Pass 42 Security Audit — Sandbox Isolation, Lexical Scanners & Filter Parity', () => {
    it('H1/L2: terminates poisoned worker on timeout, freezes worker TypedArray/AggregateError/fs/sql shims, and recovers cleanly', async () => {
        const sandbox = new WorkerSandbox({ timeoutMs: 200, memoryLimitMb: 64 })
        try {
            const timedOut = await sandbox.execute('await new Promise(() => {});', {}, undefined, 50)
            expect(timedOut.success).toBe(false)

            const fresh = await sandbox.execute(
                'return { sum: 40 + 2, typedFrozen: Object.isFrozen(Uint8Array.prototype), aggFrozen: typeof AggregateError === "undefined" || Object.isFrozen(AggregateError.prototype) };',
                {},
                undefined,
                5000
            )
            expect(fresh.success).toBe(true)
            expect(fresh.result).toEqual({ sum: 42, typedFrozen: true, aggFrozen: true })
        } finally {
            sandbox.dispose()
        }

        const fsShim = createSafeFsShim({ content: 'hello' })
        expect(Object.isFrozen(fsShim)).toBe(true)
        expect(Object.isFrozen(fsShim.promises)).toBe(true)
        const sqlShim = createPreparedStatementShim('SELECT 1', {})
        expect(Object.isFrozen(sqlShim)).toBe(true)
    })

    it('H2/M3/M13: enforces codemodeInternalFullAccess on dummy shims, mj.getConfig() via list_projects, and memory://help visibility', async () => {
        const coreCodemode = parseToolFilter('core,codemode')
        const coreCodemodeNoSearch = parseToolFilter('core,codemode,-search_entries')
        expect(isDummyToolAllowedByFilter('mj_core_search_entries', coreCodemode, true, false)).toBe(false)
        expect(isDummyToolAllowedByFilter('mj_core_search_entries', coreCodemode, true, true)).toBe(true)
        expect(isDummyToolAllowedByFilter('mj_core_search_entries', coreCodemodeNoSearch, true, true)).toBe(false)

        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        const runtime = new ServerRuntime()
        try {
            db.createEntry({ content: 'secret-journal-entry' })
            const blockedSearchShim = (await callTool('mj_core_search_entries', { query: 'secret-journal-entry' }, db, undefined, undefined, {
                filterConfig: coreCodemode,
                agentHealing: true,
                codemodeInternalFullAccess: false,
                runtime,
            })) as { success: boolean; code?: string }
            expect(blockedSearchShim.success).toBe(false)
            expect(blockedSearchShim.code).toBe('TOOL_DISABLED')

            const grepBlockedFallback = (await callTool('grep_search', { query: 'secret-journal-entry' }, db, undefined, undefined, {
                filterConfig: parseToolFilter('core,-search_entries'),
                agentHealing: true,
                codemodeInternalFullAccess: false,
                runtime,
            })) as { success: boolean; entries?: unknown[] }
            expect(grepBlockedFallback.success).toBe(false)
            expect(grepBlockedFallback.entries).toBeUndefined()

            const jApi = createJournalApi([], async () => ({ success: true }), () => ({}))
            const cfgRes = (await (jApi.core['getConfig'] as () => Promise<unknown>)()) as {
                success: boolean
                code?: string
            }
            expect(cfgRes.success).toBe(false)
            expect(cfgRes.code).toBe('TOOL_DISABLED')

            const helpRoot = getHelpResourceDefinitions().find((r) => r.uri === 'memory://help')
            expect(helpRoot).toBeDefined()
            const helpOut = (await Promise.resolve(
                helpRoot?.handler('memory://help', {
                    db,
                    filterConfig: parseToolFilter('core,codemode'),
                    runtime: {
                        ...runtime,
                        configManager: { getConfig: () => ({ codemodeInternalFullAccess: false }) },
                    } as unknown as ServerRuntime,
                } as never)
            )) as { data: { groups?: { name: string }[] } }
            const groupNames = helpOut.data.groups?.map((g) => g.name) ?? []
            expect(groupNames).not.toContain('backup')
        } finally {
            db.close()
        }
    })

    it('M2: handles Annex B comments, Unicode line terminators, unterminated EOF comments, and block vs object brace regex across all scanners', () => {
        const htmlComment = 'const a = 1 <!-- evil eval("x")\nconst b = 2\n--> close\nconst c = 3'
        const stripped = stripCommentsAndStrings(htmlComment)
        expect(stripped).not.toContain('evil')
        expect(stripped).toContain('const a = 1')

        const blockRegex = 'if (ok) {} /eval/g.test("eval");\n1 + 2'
        expect(stripCommentsAndStrings(blockRegex)).not.toContain('eval/g')
        expect(transformAutoReturn('const x = 1;<!-- trailing')).toContain('const x = 1')
        expect(transformAutoReturn('const x = 1\u20282')).toContain('return 2')

        const unterminated = 'const a = 1; /* open comment '
        expect(isInsideStringOrComment(unterminated, unterminated.length)).toBe(true)
        expect(isInsideStringOrComment('const a = 1 <!-- inline comment', 25)).toBe(true)
        expect(isInsideStringOrComment('const a = 1 <!-- c\nconst b = 2', 26)).toBe(false)
    })

    it('M4/M5/M6/L1/L3: bounds validation cost, deep context bounds, explicit empty projectRegistry, input elements, and autoVersion', async () => {
        const giant = `${'a'.repeat(55_000)} eval("1")`
        expect(validateSandboxCode(giant).errors[0]).toContain('exceeds maximum length')

        const ctxRecovered = resolveExecutionPayload({}, { context: { code: 'x'.repeat(55_000) } }, true, performance.now())
        expect('earlyReturn' in ctxRecovered).toBe(true)
        if ('earlyReturn' in ctxRecovered) {
            expect(ctxRecovered.earlyReturn['code']).toBe('VALIDATION_ERROR')
        }

        const prevSnap = captureActiveProjectRegistryState()
        setActiveProjectRegistry({})
        expect(hasActiveProjectRegistry()).toBe(true)
        restoreActiveProjectRegistryState(prevSnap)

        process.env['DB_ENCRYPTION_KEY'] = ''
        const db = new DatabaseAdapter(':memory:')
        await db.initialize()
        const runtime = new ServerRuntime()
        try {
            const outerReg = { 'outer-proj': { path: process.cwd(), project_number: 1 } }
            setActiveProjectRegistry(outerReg)
            const tooMany = (await callTool('get_recent_entries', { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, db, undefined, undefined, {
                maxToolInputElements: 5,
                runtime,
            })) as { success: boolean; code?: string; error?: string }
            expect(tooMany.success).toBe(false)
            expect(tooMany.code).toBe('VALIDATION_ERROR')

            await callTool('get_recent_entries', { limit: 1 }, db, undefined, undefined, {
                projectRegistry: { 'inner-proj': { path: process.cwd(), project_number: 2 } },
                runtime,
            })
            expect(hasActiveProjectRegistry()).toBe(true)

            let deep: Record<string, unknown> = { leaf: 'x' }
            for (let i = 0; i < 80; i++) deep = { nested: deep }
            const codeModeTool = getCodeModeTools({ db, config: { codemodeEnabled: true, runtime } } as never)[0]
            expect(codeModeTool).toBeDefined()
            const deepRes = (await codeModeTool?.handler({
                code: 'return 1',
                context: deep,
                autoVersion: false,
            })) as { success: boolean; error?: string }
            expect(deepRes.success).toBe(true)

            const escapeBoom = '\u0007'.repeat(900_000)
            const hugeRes = (await codeModeTool?.handler({
                code: 'return 1',
                context: { msg: escapeBoom },
            })) as { success: boolean; error?: string }
            expect(hugeRes.success).toBe(false)
            expect(hugeRes.error).toContain('Context exceeds maximum length')
        } finally {
            db.close()
        }
    })
})
