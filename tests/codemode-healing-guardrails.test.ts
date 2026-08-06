import { describe, it, expect } from 'vitest'
import { wrapResult } from '../src/codemode/worker-result-proxy.js'
import { ExecuteCodeSchema } from '../src/handlers/tools/codemode/schemas.ts'

describe('Code Mode Anti-Hallucination & Healing Guardrails', () => {
    describe('Layer 3: Worker Result Proxy Failed Result Safety', () => {
        it('should safely return empty arrays and 0 length on failed result object without throwing', () => {
            const failedResult = wrapResult({
                success: false,
                error: 'Entry 9999 not found',
                code: 'NOT_FOUND',
            }) as Record<string, unknown>

            expect(failedResult['success']).toBe(false)
            expect(failedResult['relationships']).toEqual([])
            expect(failedResult['entries']).toEqual([])
            expect(failedResult['projects']).toEqual([])
            expect(failedResult['length']).toBe(0)
            expect(typeof failedResult['map']).toBe('function')
            expect((failedResult['map'] as (fn: (x: unknown) => unknown) => unknown[])(() => 1)).toEqual([])
        })
    })

    describe('Layer 1: ExecuteCodeSchema Parameter Preservation', () => {
        it('should preserve entry and instructions fields when passed to ExecuteCodeSchema', () => {
            const parsed = ExecuteCodeSchema.parse({
                entry: { title: 'Test Entry', content: 'Testing auto-healing' },
                instructions: 'Write a journal entry',
            })

            expect(parsed['entry']).toBeDefined()
            expect(parsed['instructions']).toBe('Write a journal entry')
        })
    })
})
