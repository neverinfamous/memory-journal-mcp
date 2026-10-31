/**
 * Tests for the auto_context parameter handling in applyArgInterceptions.
 *
 * Root-cause fix: auto_context was unconditionally deleted from create_entry /
 * team_create_entry payloads in the sandbox proxy, causing it to always be
 * stored as null regardless of what the agent passed.
 *
 * Expected behaviour after fix:
 *   - Plain objects       → silently stringified (prevention)
 *   - Valid JSON strings  → passed through unchanged
 *   - Other types         → actionable VALIDATION_ERROR
 */

import { describe, it, expect } from 'vitest'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'

// =============================================================================
// Helpers
// =============================================================================

const CREATE_METHODS = ['create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry'] as const

function singleArg(params: Record<string, unknown>): [Record<string, unknown>] {
    return [params]
}

// =============================================================================
// auto_context — create_entry / team_create_entry
// =============================================================================

describe('applyArgInterceptions — auto_context handling', () => {
    for (const method of CREATE_METHODS) {
        describe(`method: ${method}`, () => {
            it('passes a valid JSON string through unchanged', () => {
                const jsonStr = JSON.stringify({ commits: ['abc1234'] })
                const result = applyArgInterceptions(method, singleArg({ content: 'test', auto_context: jsonStr }))
                expect('error' in result).toBe(false)
                const args = (result as { args: unknown[] }).args
                const params = args[0] as Record<string, unknown>
                expect(params['auto_context']).toBe(jsonStr)
            })

            it('auto-stringifies a plain object', () => {
                const obj = { commits: ['abc1234'] }
                const result = applyArgInterceptions(method, singleArg({ content: 'test', auto_context: obj }))
                expect('error' in result).toBe(false)
                const args = (result as { args: unknown[] }).args
                const params = args[0] as Record<string, unknown>
                expect(typeof params['auto_context']).toBe('string')
                expect(JSON.parse(params['auto_context'] as string)).toEqual(obj)
            })

            it('auto-stringifies a nested object with multiple fields', () => {
                const obj = { commits: ['abc1234', 'def5678'], branch: 'main' }
                const result = applyArgInterceptions(method, singleArg({ content: 'test', auto_context: obj }))
                expect('error' in result).toBe(false)
                const args = (result as { args: unknown[] }).args
                const params = args[0] as Record<string, unknown>
                expect(JSON.parse(params['auto_context'] as string)).toEqual(obj)
            })

            it('returns a VALIDATION_ERROR for a number type', () => {
                const result = applyArgInterceptions(method, singleArg({ content: 'test', auto_context: 42 }))
                expect('error' in result).toBe(true)
                const error = (result as { error: Record<string, unknown> }).error
                expect(error['code']).toBe('VALIDATION_ERROR')
                expect(String(error['error'])).toContain('auto_context')
                expect(String(error['suggestion'])).toContain('JSON.stringify')
            })

            it('returns a VALIDATION_ERROR for a boolean type', () => {
                const result = applyArgInterceptions(method, singleArg({ content: 'test', auto_context: true }))
                expect('error' in result).toBe(true)
                const error = (result as { error: Record<string, unknown> }).error
                expect(error['code']).toBe('VALIDATION_ERROR')
            })

            it('does not affect entries without auto_context', () => {
                const result = applyArgInterceptions(method, singleArg({ content: 'test', tags: ['foo'] }))
                expect('error' in result).toBe(false)
                const args = (result as { args: unknown[] }).args
                const params = args[0] as Record<string, unknown>
                expect('auto_context' in params).toBe(false)
            })

            it('passes through a pre-stringified JSON string that includes commits SHA', () => {
                const sha = 'bac8f1d0b31c3be005e997062dfc8b4cfe4ad52c'
                const autoCtx = JSON.stringify({ commits: [sha] })
                const result = applyArgInterceptions(method, singleArg({ content: 'narrative', auto_context: autoCtx }))
                expect('error' in result).toBe(false)
                const args = (result as { args: unknown[] }).args
                const params = args[0] as Record<string, unknown>
                const parsed = JSON.parse(params['auto_context'] as string) as { commits: string[] }
                expect(parsed.commits[0]).toBe(sha)
            })
        })
    }
})

// =============================================================================
// Regression: other create_entry params are unaffected by auto_context fix
// =============================================================================

describe('applyArgInterceptions — create_entry regression: other params unaffected', () => {
    it('still maps text -> content', () => {
        const result = applyArgInterceptions('create_entry', singleArg({ text: 'hello' }))
        expect('error' in result).toBe(false)
        const params = ((result as { args: unknown[] }).args[0]) as Record<string, unknown>
        expect(params['content']).toBe('hello')
        expect('text' in params).toBe(false)
    })

    it('still rejects q/query/path/mode/search params', () => {
        const result = applyArgInterceptions('create_entry', singleArg({ content: 'ok', q: 'search term' }))
        expect('error' in result).toBe(true)
        const error = (result as { error: Record<string, unknown> }).error
        expect(error['code']).toBe('VALIDATION_ERROR')
    })

    it('preserves tags alongside auto_context string', () => {
        const autoCtx = JSON.stringify({ commits: ['abc'] })
        const result = applyArgInterceptions('create_entry', singleArg({
            content: 'test',
            tags: ['commit-narrative', 'roadmap'],
            auto_context: autoCtx,
        }))
        expect('error' in result).toBe(false)
        const params = ((result as { args: unknown[] }).args[0]) as Record<string, unknown>
        expect(params['tags']).toEqual(['commit-narrative', 'roadmap'])
        expect(params['auto_context']).toBe(autoCtx)
    })
})
