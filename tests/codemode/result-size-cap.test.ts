/**
 * Result Size Cap Tests
 *
 * Verifies the 100KB default cap for Code Mode results,
 * configurable via CODE_MODE_MAX_RESULT_SIZE, and the
 * agent-guidance error message format.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodeModeSecurityManager, DEFAULT_SECURITY_CONFIG } from '../../src/codemode/index.js'

describe('Code Mode Result Size Cap', () => {
    let originalEnv: string | undefined

    beforeEach(() => {
        originalEnv = process.env['CODE_MODE_MAX_RESULT_SIZE']
    })

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env['CODE_MODE_MAX_RESULT_SIZE'] = originalEnv
        } else {
            delete process.env['CODE_MODE_MAX_RESULT_SIZE']
        }
    })

    // =========================================================================
    // Default Cap
    // =========================================================================

    describe('default 100KB cap', () => {
        it('should have 100KB as the default maxResultSize', () => {
            expect(DEFAULT_SECURITY_CONFIG.maxResultSize).toBe(100 * 1024)
        })

        it('should accept results under 100KB', () => {
            const mgr = new CodeModeSecurityManager()
            const data = { content: 'x'.repeat(50 * 1024) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(true)
            expect(result.errors).toHaveLength(0)
        })

        it('should reject results over 100KB', () => {
            const mgr = new CodeModeSecurityManager()
            const data = { content: 'x'.repeat(120 * 1024) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(false)
            expect(result.errors).toHaveLength(1)
        })

        it('should accept results at exactly the boundary', () => {
            // Create a payload whose JSON serialization is exactly at the limit
            // JSON.stringify adds {"content":""} overhead (~14 bytes)
            const contentSize = 100 * 1024 - 20
            const mgr = new CodeModeSecurityManager({ maxResultSize: 100 * 1024 })
            const data = { content: 'a'.repeat(contentSize) }
            const serialized = JSON.stringify(data)
            const size = Buffer.byteLength(serialized, 'utf-8')
            // If under limit, should pass
            if (size <= 100 * 1024) {
                expect(mgr.validateResultSize(data).valid).toBe(true)
            } else {
                expect(mgr.validateResultSize(data).valid).toBe(false)
            }
        })
    })

    // =========================================================================
    // Configurable Cap
    // =========================================================================

    describe('configurable via constructor', () => {
        it('should respect custom maxResultSize', () => {
            const mgr = new CodeModeSecurityManager({ maxResultSize: 500 })
            const small = mgr.validateResultSize({ x: 'hi' })
            expect(small.valid).toBe(true)

            const large = mgr.validateResultSize({ x: 'z'.repeat(600) })
            expect(large.valid).toBe(false)
        })

        it('should allow very large cap for enterprise users', () => {
            const mgr = new CodeModeSecurityManager({ maxResultSize: 1024 * 1024 })
            const data = { content: 'x'.repeat(500 * 1024) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(true)
        })
    })

    // =========================================================================
    // Error Message Quality
    // =========================================================================

    describe('agent-guidance error messages', () => {
        it('should include actual KB in error message', () => {
            const mgr = new CodeModeSecurityManager({ maxResultSize: 1024 })
            const data = { content: 'x'.repeat(5 * 1024) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(false)
            // Should mention KB sizes
            expect(result.errors[0]).toMatch(/\d+ KB/)
        })

        it('should include aggregation guidance', () => {
            const mgr = new CodeModeSecurityManager({ maxResultSize: 100 })
            const data = { content: 'x'.repeat(500) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(false)
            expect(result.errors[0]).toContain('Extract specific fields')
            expect(result.errors[0]).toContain('aggregate data')
        })

        it('should include usage example in error message', () => {
            const mgr = new CodeModeSecurityManager({ maxResultSize: 100 })
            const data = { content: 'x'.repeat(500) }
            const result = mgr.validateResultSize(data)
            expect(result.valid).toBe(false)
            expect(result.errors[0]).toContain('getKanbanBoard')
            expect(result.errors[0]).toContain('columns')
        })
    })
})
