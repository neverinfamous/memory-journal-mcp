import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import * as fs from 'fs'

vi.mock('../../src/codemode/sandbox-factory.js', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        createSandboxPool: () => ({
            execute: async (code: string) => {
                if (code.includes('throw')) {
                    return { success: false, error: 'test error' }
                }
                if (code.includes('mj.core.create_entry')) {
                    return { success: true, result: 'undefined' }
                }
                return { success: true, result: 2 }
            }
        }),
        setDefaultSandboxMode: vi.fn(),
    }
})

describe('Code Mode Tool Handlers', () => {
    let personalDb: DatabaseAdapter

    const personalDbPath = './test-codemode-handlers.db'

    beforeAll(async () => {
        try { if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath) } catch {}
        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()
    })

    afterAll(() => {
        personalDb.close()
        try { if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath) } catch {}
    })

    it('should execute basic code', async () => {
        const result = await callTool('mj_execute_code', { code: 'return 1 + 1;' }, personalDb) as any
        expect(result.success).toBe(true)
        expect(result.result).toBe(2)
    })

    it('should block malicious code', async () => {
        const result = await callTool('mj_execute_code', { code: 'process.exit(1)' }, personalDb) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('Security validation failed')
    })
    
    it('should respect readonly mode', async () => {
        const result = await callTool('mj_execute_code', { code: 'return typeof mj.core.create_entry', readonly: true }, personalDb) as any
        expect(result.success).toBe(true)
        // create_entry does not have readOnlyHint: true, so it is filtered out
        expect(result.result).toBe('undefined')
    })

    it('should capture runtime errors', async () => {
        const result = await callTool('mj_execute_code', { code: 'throw new Error("test error")' }, personalDb) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('test error')
    })
})
