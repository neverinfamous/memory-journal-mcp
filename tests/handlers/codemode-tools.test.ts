import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { GitHubIntegration } from '../../src/github/github-integration/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import * as fs from 'fs'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] }, dispatch: vi.fn().mockResolvedValue({ success: true, result: 2 }) } as any, progress, teamDb, teamVector);


vi.mock('../../src/utils/request-context.js', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        getRequestContext: () => ({ sessionId: 'test-session-id' })
    }
})

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
                    return { success: false, error: 'Result string exceeds allowed limit' }
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
        const config = {
            defaultProjectNumber: 1,
            projectRegistry: {
                testrepo: { path: '.', project_number: 99 },
            },
            codemodeInternalFullAccess: true,
            runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } },
            io: { allowedRoots: [process.cwd()] },
            dispatch: vi.fn().mockResolvedValue({ success: true, result: 2 })
        }

        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1', repo: 'testrepo' },
            personalDb,
            undefined,
            undefined,
            config
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
        expect(result.error).toContain('Result string exceeds')
    })

    it('should return error when git initialization fails on repo context injection', async () => {
        const spy = vi
            .spyOn(GitHubIntegration.prototype, 'getRepoInfo')
            .mockRejectedValue(new Error('no git'))

        const config = {
            projectRegistry: {
                testrepo2: { path: '.', project_number: 99 },
            },
            codemodeInternalFullAccess: true,
            runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } },
            io: { allowedRoots: [process.cwd()] },
            dispatch: vi.fn().mockResolvedValue({ success: true, result: 2 })
        }

        const result = (await callTool(
            'mj_execute_code',
            { code: 'return 1', repo: 'testrepo2' },
            personalDb,
            undefined,
            undefined,
            config
        )) as any

        expect(result.success).toBe(false)
        expect(result.error).toContain("Failed to initialize injected repository 'testrepo2': no git")
        spy.mockRestore()
    })

    it('should trigger rate limit after 60 calls', async () => {
        // Run 60 successful calls
        for (let i = 0; i < 60; i++) {
            await callTool('mj_execute_code', { code: 'return 1' }, personalDb)
        }
        // 61st call should be rate limited
        const result = (await callTool('mj_execute_code', { code: 'return 1' }, personalDb)) as any

        expect(result.success).toBe(false)
        expect(result.error).toContain('Rate limit exceeded')
    }, 30000)
})
