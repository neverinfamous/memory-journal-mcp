import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
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
                if (code.includes('huge')) {
                    return { success: true, result: 'a'.repeat(11 * 1024 * 1024) }
                }
                return { success: true, result: 2 }
            },
        }),
        setDefaultSandboxMode: vi.fn(),
    }
})

describe('Code Mode Tool Handlers', () => {
    let personalDb: DatabaseAdapter

    const personalDbPath = './test-codemode-handlers.db'

    beforeAll(async () => {
        try {
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
        } catch {}
        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()
    })

    afterAll(() => {
        personalDb.close()
        try {
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
        } catch {}
    })

    it('should execute basic code', async () => {
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1 + 1;' },
            personalDb
        )) as any
        expect(result.success).toBe(true)
        expect(result.result).toBe(2)
    })

    it('should block malicious code', async () => {
        const result = (await callTool(
            'mj_execute_code',
            { code: 'process.exit(1)' },
            personalDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('Security validation failed')
    })

    it('should respect readonly mode', async () => {
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return typeof mj.core.create_entry', readonly: true },
            personalDb
        )) as any
        expect(result.success).toBe(true)
        // create_entry does not have readOnlyHint: true, so it is filtered out
        expect(result.result).toBe('undefined')
    })

    it('should capture runtime errors', async () => {
        const result = (await callTool(
            'mj_execute_code',
            { code: 'throw new Error("test error")' },
            personalDb
        )) as any
        expect(result.success).toBe(false)
        expect(result.error).toContain('test error')
    })

    it('should inject github context based on repo parameter', async () => {
        // Construct a ToolContext that mimics what the server builds
        const context = Object.assign(Object.create(Object.getPrototypeOf(personalDb)), personalDb, {
            config: {
                defaultProjectNumber: 1,
                projectRegistry: {
                    testrepo: { path: '.', project_number: 99 }
                }
            }
        })
        
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1', repo: 'testrepo' },
            context
        )) as any
        
        expect(result.success).toBe(true)
        expect(result.result).toBe(2)
    })

    it('should reject extremely large result payloads', async () => {
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return "huge"' },
            personalDb
        )) as any
        
        expect(result.success).toBe(false)
        expect(result.error).toContain('Result exceeds')
    })

    it('should swallow git errors on repo context injection', async () => {
        const spy = vi.spyOn(GitHubIntegration.prototype, 'getRepoInfo').mockRejectedValue(new Error('no git'))
        
        const context = Object.assign(Object.create(Object.getPrototypeOf(personalDb)), personalDb, {
            config: {
                projectRegistry: {
                    testrepo2: { path: '.', project_number: 99 }
                }
            }
        })
        
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1', repo: 'testrepo2' },
            context
        )) as any
        
        expect(result.error).toBeUndefined()
        expect(result.success).toBe(true)
        spy.mockRestore()
    })

    it('should trigger rate limit after 60 calls', async () => {
        // Run 60 successful calls
        for (let i = 0; i < 60; i++) {
            await callTool('mj_execute_code', { code: 'return 1' }, personalDb)
        }
        // 61st call should be rate limited
        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1' },
            personalDb
        )) as any
        
        expect(result.success).toBe(false)
        expect(result.error).toContain('Rate limit exceeded')
    })
})
