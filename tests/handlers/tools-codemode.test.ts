import { describe, it, expect, vi } from 'vitest'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/index.js'
import * as api from '../../src/codemode/api/index.js'
import * as sandboxFactory from '../../src/codemode/sandbox-factory.js'
import * as singleton from '../../src/handlers/tools/codemode/singleton-state.js'

describe('Code Mode Tools Coverage', () => {
    it('should throw ConfigurationError if codemode is disabled', async () => {
        const tools = getCodeModeTools({ config: { codemodeEnabled: false } } as any)
        const handler = tools[0].handler

        const result = await handler({ code: 'mj.core.get_recent_entries()' })
        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('Code Mode is disabled'),
        })
    })

    it('should execute sandbox and return result format correctly', async () => {
        const mm = { yieldJob: vi.fn(), resumeJob: vi.fn() }
        const context = {
            config: {
                runtime: { maintenanceManager: mm },
                codemodeEnabled: true,
                codemodeInternalFullAccess: true,
            },
        }

        vi.spyOn(singleton, 'getSandboxPool').mockImplementationOnce(() => {
            return {
                execute: vi.fn().mockResolvedValue({
                    success: true,
                    result: 'executed',
                    error: undefined,
                    executionTimeMs: 15,
                }),
                warmup: vi.fn(),
                dispose: vi.fn(),
            } as any
        })

        const tools = getCodeModeTools(context as any)
        const handler = tools[0].handler

        const result = (await handler({ code: 'test' })) as any
        expect(result.success).toBe(true)
        expect(result.result).toBe('executed')
        expect(result.executionTimeMs).toBeGreaterThan(0)
    })
})
