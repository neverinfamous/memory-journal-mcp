/**
 * Tests for src/observability/token-estimator.ts
 */

import { describe, it, expect } from 'vitest'
import {
    estimateTokens,
    estimatePayloadTokens,
    injectTokenEstimate,
} from '../../src/observability/token-estimator.js'

describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0)
    })

    it('returns 0 for null-like falsy value coerced via empty string', () => {
        // Empty string is the boundary case
        expect(estimateTokens('')).toBe(0)
    })

    it('estimates simple ASCII text at ~4 bytes/token', () => {
        // 'hello' = 5 bytes → ceil(5/4) = 2
        expect(estimateTokens('hello')).toBe(2)
    })

    it('estimates a 100-char ASCII string as ~25 tokens', () => {
        const s = 'a'.repeat(100)
        expect(estimateTokens(s)).toBe(25)
    })

    it('estimates multibyte UTF-8 correctly (Japanese 3 bytes each)', () => {
        // 'あ' is 3 bytes; 4 of them = 12 bytes → ceil(12/4) = 3
        const s = 'あああ' + 'あ' // 4 chars × 3 bytes = 12 bytes
        expect(estimateTokens(s)).toBe(3)
    })

    it('estimates emoji (4-byte UTF-8 sequences)', () => {
        // '😀' is 4 bytes → ceil(4/4) = 1
        expect(estimateTokens('😀')).toBe(1)
        // '😀😀' is 8 bytes → ceil(8/4) = 2
        expect(estimateTokens('😀😀')).toBe(2)
    })

    it('rounds up for non-multiple-of-4 lengths', () => {
        // 'ab' = 2 bytes → ceil(2/4) = 1
        expect(estimateTokens('ab')).toBe(1)
        // 'abc' = 3 bytes → ceil(3/4) = 1
        expect(estimateTokens('abc')).toBe(1)
        // 'abcde' = 5 bytes → ceil(5/4) = 2
        expect(estimateTokens('abcde')).toBe(2)
    })
})

describe('estimatePayloadTokens', () => {
    it('returns 0 for null', () => {
        expect(estimatePayloadTokens(null)).toBe(0)
    })

    it('returns 0 for undefined', () => {
        expect(estimatePayloadTokens(undefined)).toBe(0)
    })

    it('serializes an object and estimates tokens', () => {
        const payload = { success: true, data: 'hello' }
        const serialized = JSON.stringify(payload) // '{"success":true,"data":"hello"}'
        const expected = Math.ceil(Buffer.byteLength(serialized, 'utf8') / 4)
        expect(estimatePayloadTokens(payload)).toBe(expected)
    })

    it('handles a number value', () => {
        // JSON.stringify(42) = '42' = 2 bytes → ceil(2/4) = 1
        expect(estimatePayloadTokens(42)).toBe(1)
    })
})

describe('injectTokenEstimate', () => {
    it('injects _meta.tokenEstimate into a plain object', () => {
        const payload = { success: true, data: 'hello' }
        const result = injectTokenEstimate(payload) as Record<string, unknown>
        expect(result['_meta']).toBeDefined()
        const meta = result['_meta'] as Record<string, unknown>
        expect(typeof meta['tokenEstimate']).toBe('number')
        expect(meta['tokenEstimate']).toBeGreaterThan(0)
    })

    it('does not mutate the original object', () => {
        const payload = { success: true }
        injectTokenEstimate(payload)
        expect((payload as Record<string, unknown>)['_meta']).toBeUndefined()
    })

    it('merges into existing _meta without clobbering other keys', () => {
        const payload = { _meta: { source: 'test' }, data: 'x' }
        const result = injectTokenEstimate(payload) as Record<string, unknown>
        const meta = result['_meta'] as Record<string, unknown>
        expect(meta['source']).toBe('test')
        expect(typeof meta['tokenEstimate']).toBe('number')
    })

    it('returns non-objects unchanged', () => {
        expect(injectTokenEstimate('a string')).toBe('a string')
        expect(injectTokenEstimate(42)).toBe(42)
        expect(injectTokenEstimate(null)).toBe(null)
    })

    it('returns arrays unchanged', () => {
        const arr = [1, 2, 3]
        expect(injectTokenEstimate(arr)).toBe(arr)
    })
})
