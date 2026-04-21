import { describe, it, expect, vi } from 'vitest'
import { getCodeModeTools } from '../../src/handlers/tools/codemode.js'
import * as api from '../../src/codemode/api.js'
import * as sandboxFactory from '../../src/codemode/sandbox-factory.js'

describe('Code Mode Tools Coverage', () => {
    it('should throw ConfigurationError if dispatcher is missing', async () => {
        const tools = getCodeModeTools({} as any)
        const handler = tools[0].handler

        const result = await handler({ code: 'mj.core.get_recent_entries()' })
        expect(result).toMatchObject({
            success: false,
            category: 'configuration',
            code: 'CONFIGURATION_ERROR',
            error: expect.stringContaining('unavailable in the current configuration'),
        })
    })

    it('should capture secureDispatcher and execute correctly', async () => {
        const mockDispatch = vi.fn().mockResolvedValue('success')
        const mm = { yieldJob: vi.fn(), resumeJob: vi.fn() }
        const context = {
            config: {
                dispatch: mockDispatch,
                runtime: { maintenanceManager: mm },
            },
        }

        let capturedDispatcher!: any
        vi.spyOn(api, 'createJournalApi').mockImplementationOnce((tools, dispatcher) => {
            capturedDispatcher = dispatcher
            return { createSandboxBindings: () => ({}) } as any
        })

        vi.spyOn(sandboxFactory, 'createSandboxPool').mockImplementationOnce(() => {
            return {
                execute: vi.fn().mockResolvedValue('executed'),
                warmup: vi.fn(),
                dispose: vi.fn(),
            } as any
        })

        const tools = getCodeModeTools(context as any)
        const handler = tools[0].handler

        const result = await handler({ code: 'test' })
        expect(result).toBe('executed')

        expect(capturedDispatcher).toBeDefined()

        const res = await capturedDispatcher('test_tool', { arg: 'val' })
        expect(res).toBe('success')
        expect(mockDispatch).toHaveBeenCalledWith('test_tool', { arg: 'val' })
        expect(mm.yieldJob).toHaveBeenCalled()
        expect(mm.resumeJob).toHaveBeenCalled()
    })
})
