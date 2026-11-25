import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { validateSandboxCode } from '../../src/codemode/security.js'
import { stripCommentsAndStrings } from '../../src/codemode/security-stripper.js'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'
import { WorkerSandboxPool } from '../../src/codemode/worker-sandbox-pool.js'
import { pathShim } from '../../src/codemode/worker/node-shims.js'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { disposeCodemodeResources } from '../../src/handlers/tools/codemode/singleton-state.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'

const TEST_REGISTRY = {
    'repo-a': { path: process.cwd(), project_number: 5 },
}

describe('Pass 35 Security Audit — Code Mode Sandbox, Lexical Scanner & Dispatch Scope', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(async () => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        process.env['DB_ENCRYPTION_KEY'] = ''

        db = new DatabaseAdapter(':memory:')
        teamDb = new DatabaseAdapter(':memory:')
        await db.initialize()
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterEach(() => {
        disposeCodemodeResources()
        teamDb.close()
        db.close()
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        else delete process.env['MJ_DB_ENCRYPTION_KEY']
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        else delete process.env['DB_ENCRYPTION_KEY']
    })

    it('M1 & M2: closes lexical stripper desync (regex, Annex B HTML, ++/--, Unicode escapes) and transformAutoReturn regex semicolons', () => {
        expect(validateSandboxCode('const x = a / b; eval("1")').valid).toBe(false)
        expect(validateSandboxCode('const x = y-- / z; eval("1")').valid).toBe(false)
        expect(validateSandboxCode('if (ok) {} else /abc/; return 1').valid).toBe(true)
        expect(validateSandboxCode('1\n<!-- hidden\neval("1")').valid).toBe(false)
        expect(validateSandboxCode('const x = 1\n--> trailer\neval("1")').valid).toBe(false)
        expect(validateSandboxCode('\\u0065val("1")').valid).toBe(false)
        expect(validateSandboxCode('\\u{65}val("1")').valid).toBe(false)
        expect(validateSandboxCode('({})["\\x63onstructor"]').valid).toBe(false)
        expect(validateSandboxCode('Reflect.get(globalThis, "process")').valid).toBe(false)
        expect(validateSandboxCode('const { getPrototypeOf } = Object; getPrototypeOf({})').valid).toBe(
            false
        )

        const stripped = stripCommentsAndStrings('const x = "hi"; <!-- c\nreturn a / b;')
        expect(stripped).toContain('return a / b;')
        expect(transformAutoReturn('const r = /a;b/; r')).toBe('const r = /a;b/;\nreturn r')
    })

    it('H1–H4: isolates mj.team.*, blocks generator/iterator escapes, unwraps Proxy returns, and enforces async timeout', async () => {
        const pool = new WorkerSandboxPool({}, { minInstances: 0, maxInstances: 2 })
        const teamGet = vi.fn().mockResolvedValue({ success: true, id: 7, source: 'team' })
        const personalGet = vi.fn().mockResolvedValue({ success: true, id: 7, source: 'personal' })
        try {
            const teamRes = await pool.execute('return await mj.team.getEntryById({ entry_id: 7 })', {
                team: { team_get_entry_by_id: teamGet },
                core: { get_entry_by_id: personalGet },
            })
            expect(teamRes.success).toBe(true)
            expect(teamRes.result).toEqual({ success: true, id: 7, source: 'team' })
            expect(teamGet).toHaveBeenCalledTimes(1)
            expect(personalGet).not.toHaveBeenCalled()

            const unknownTeamRes = await pool.execute('return await mj.team.nonExistentMethod({})', {
                team: { team_get_entry_by_id: teamGet },
                core: { nonExistentMethod: personalGet },
            })
            expect(unknownTeamRes.success).toBe(true)
            expect(unknownTeamRes.result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
            expect(personalGet).not.toHaveBeenCalled()

            const escapeRes = await pool.execute(
                'return (function*(){}).constructor("return 1")()',
                {}
            )
            expect(escapeRes.success).toBe(false)

            const asyncGenRes = await pool.execute(
                'return (async function*(){}).constructor("return 1")()',
                {}
            )
            expect(asyncGenRes.success).toBe(false)

            const iterRes = await pool.execute(
                'return [][Symbol.iterator]().constructor.constructor("return 1")()',
                {}
            )
            expect(iterRes.success).toBe(false)

            expect(Object.isFrozen(pathShim)).toBe(true)
            const frozenShimRes = await pool.execute(
                'try { path.join = () => "pwn" } catch {} return Object.isFrozen(path) && path.join("a", "b") === "a/b"',
                {}
            )
            expect(frozenShimRes.success).toBe(true)
            expect(frozenShimRes.result).toBe(true)

            const cloneSafeRes = await pool.execute(
                'return { ok: 1, fn: () => 1, nested: { fn2: () => 2, sym: Symbol("s"), val: 42 } }',
                {}
            )
            expect(cloneSafeRes.success).toBe(true)
            expect(cloneSafeRes.result).toEqual({ ok: 1, nested: { val: 42 } })

            const asyncTimeoutRes = await pool.execute(
                'try { await mj.executeCode({ code: "await new Promise(() => {})", timeout: 80 }); return { timedOut: false } } catch (e) { return { timedOut: true, msg: String(e) } }',
                {},
                undefined,
                2500
            )
            expect(asyncTimeoutRes.success).toBe(true)
            const innerRes = asyncTimeoutRes.result as Record<string, unknown>
            expect(innerRes['timedOut']).toBe(true)
            expect(String(innerRes['msg'])).toMatch(/timed out/i)
        } finally {
            pool.dispose()
        }
    }, 30000)

    it('M6–M9: enforces write project_number > 0, target_workspace_id "*", nested RPC containment, tool filter parity, and field size caps', async () => {
        const created = db.createEntry({
            content: 'Seed entry for M7',
            workspaceId: 'repo-a',
            projectNumber: 5,
        })
        const tool = getCodeModeTools({
            db,
            teamDb,
            config: {
                codemodeEnabled: true,
                runtime: new ServerRuntime(),
                projectRegistry: TEST_REGISTRY,
                filterConfig: parseToolFilter('-admin'),
            },
        }).find((t) => t.name === 'mj_execute_code')
        expect(tool).toBeDefined()
        if (!tool) return

        const zeroWriteRes = (await tool.handler({
            workspace_id: 'repo-a',
            project_number: 5,
            code: 'return await mj.core.createEntry({ content: "bad", project_number: 0 })',
        })) as { success: boolean; result?: { success?: boolean; error?: string } }
        expect(zeroWriteRes.result?.success).toBe(false)
        expect(zeroWriteRes.result?.error).toMatch(/Invalid project_number|positive integer/i)

        const zeroReadRes = (await tool.handler({
            workspace_id: 'unreg-read-ws',
            code: 'return await mj.search.searchEntries({ query: "Seed", project_number: 0 })',
        })) as { success: boolean; result?: { success?: boolean; count?: number; entries?: unknown[] } }
        expect(zeroReadRes.success).toBe(true)
        expect(zeroReadRes.result?.success).toBe(false)
        expect(zeroReadRes.result?.entries).toBeUndefined()

        const disabledAdminRes = (await tool.handler({
            workspace_id: 'repo-a',
            code: 'return await mj.admin.listProjects({})',
        })) as { success: boolean; result?: { success?: boolean; code?: string; error?: string } }
        expect(disabledAdminRes.result?.success).toBe(false)
        expect(disabledAdminRes.result?.code ?? disabledAdminRes.result?.error).toMatch(
            /TOOL_DISABLED|disabled/i
        )

        const wildcardTargetRes = (await tool.handler({
            workspace_id: '*',
            code: `return await mj.admin.updateEntry({ entry_id: ${String(created.id)}, content: "x", target_workspace_id: "*" })`,
        })) as { success: boolean; result?: { success?: boolean } }
        expect(wildcardTargetRes.result?.success).toBe(false)

        const batchWildcardRes = (await tool.handler({
            workspace_id: '*',
            code: `return await mj.admin.batchUpdateEntries({ updates: [{ id: ${String(created.id)}, content: "y", target_workspace_id: "*" }] })`,
        })) as { success: boolean; result?: { success?: boolean } }
        expect(batchWildcardRes.result?.success).toBe(false)

        const nestedWildcardRes = (await tool.handler({
            workspace_id: 'repo-a',
            project_number: 5,
            code: 'return await mj.executeCode({ workspace_id: "*", code: "return 1" })',
        })) as { success: boolean; result?: { success?: boolean; code?: string } }
        expect(nestedWildcardRes.result?.success).toBe(false)
        expect(nestedWildcardRes.result?.code).toBe('VALIDATION_ERROR')

        const largeFieldRes = (await tool.handler({
            workspace_id: 'repo-a',
            project_number: 5,
            session_id: 'x'.repeat(60_000),
            code: 'return 1',
        })) as { success: boolean; error?: string }
        expect(largeFieldRes.success).toBe(false)
        expect(largeFieldRes.error).toMatch(/exceeds maximum length/i)
    }, 30000)
})
