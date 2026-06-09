/**
 * Tests for src/observability/token-estimator.ts
 */

import { describe, it, expect } from 'vitest'
import {
    estimateTokens,
    estimatePayloadTokens,
    injectTokenEstimate,
    detectContentType,
} from '../../src/observability/token-estimator.js'

describe('detectContentType', () => {
    it('detects JSON from valid object', () => {
        expect(detectContentType('{"a": 1}')).toBe('json')
    })

    it('detects JSON from valid array', () => {
        expect(detectContentType('[1, 2, 3]')).toBe('json')
    })

    it('detects JSON heuristically with trailing characters', () => {
        expect(detectContentType('   { "x": 1 }\n ')).toBe('json')
    })

    it('detects code based on keyword density', () => {
        expect(detectContentType('export function foo() { const x = 1; }')).toBe('code')
    })

    it('detects prose as fallback', () => {
        expect(detectContentType('This is just a normal English sentence without code.')).toBe('prose')
    })

    it('defaults to prose for empty strings', () => {
        expect(detectContentType('')).toBe('prose')
    })
})

describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0)
    })

    it('returns 0 for null-like falsy value coerced via empty string', () => {
        // Empty string is the boundary case
        expect(estimateTokens('')).toBe(0)
    })

    it('estimates simple ASCII text at ~4 bytes/token (prose ratio)', () => {
        // 'hello' = 5 bytes → ceil(5/4.0) = 2
        expect(estimateTokens('hello')).toBe(2)
    })

    it('estimates a 100-char ASCII string as ~25 tokens', () => {
        const s = 'a'.repeat(100)
        expect(estimateTokens(s)).toBe(25)
    })

    it('estimates multibyte UTF-8 correctly (Japanese 3 bytes each)', () => {
        // 'あ' is 3 bytes; 4 of them = 12 bytes → ceil(12/4.0) = 3
        const s = 'あああ' + 'あ' // 4 chars × 3 bytes = 12 bytes
        expect(estimateTokens(s)).toBe(3)
    })

    it('estimates emoji (4-byte UTF-8 sequences)', () => {
        // '😀' is 4 bytes → ceil(4/4.0) = 1
        expect(estimateTokens('😀')).toBe(1)
        // '😀😀' is 8 bytes → ceil(8/4.0) = 2
        expect(estimateTokens('😀😀')).toBe(2)
    })

    it('rounds up for non-multiple-of-4 lengths', () => {
        // 'ab' = 2 bytes → ceil(2/4.0) = 1
        expect(estimateTokens('ab')).toBe(1)
        // 'abc' = 3 bytes → ceil(3/4.0) = 1
        expect(estimateTokens('abc')).toBe(1)
        // 'abcde' = 5 bytes → ceil(5/4.0) = 2
        expect(estimateTokens('abcde')).toBe(2)
    })

    it('uses different ratios for different content types', () => {
        // Provide enough bytes to see the difference
        const s = 'a'.repeat(100) // 100 bytes
        // Prose: 100 / 4.0 = 25
        expect(estimateTokens(s, 'prose')).toBe(25)
        // JSON: 100 / 2.8 = 36
        expect(estimateTokens(s, 'json')).toBe(36)
        // Code: 100 / 3.2 = 32
        expect(estimateTokens(s, 'code')).toBe(32)
    })
})

describe('estimatePayloadTokens', () => {
    it('returns 0 for null', () => {
        expect(estimatePayloadTokens(null)).toBe(0)
    })

    it('returns 0 for undefined', () => {
        expect(estimatePayloadTokens(undefined)).toBe(0)
    })

    it('serializes an object and estimates tokens using JSON ratio', () => {
        const payload = { success: true, data: 'hello' }
        const serialized = JSON.stringify(payload) // '{"success":true,"data":"hello"}'
        const expected = Math.ceil(Buffer.byteLength(serialized, 'utf8') / 2.8)
        expect(estimatePayloadTokens(payload)).toBe(expected)
    })

    it('handles a number value', () => {
        // JSON.stringify(42) = '42' = 2 bytes → ceil(2/2.8) = 1
        expect(estimatePayloadTokens(42)).toBe(1)
    })
})

describe('injectTokenEstimate', () => {
    it('injects _meta.tokenEstimate into a plain object using JSON ratio', () => {
        const payload = { success: true, data: 'hello' }
        const result = injectTokenEstimate(payload) as Record<string, unknown>
        expect(result['_meta']).toBeDefined()
        const meta = result['_meta'] as Record<string, unknown>
        expect(typeof meta['tokenEstimate']).toBe('number')
        expect(meta['tokenEstimate']).toBeGreaterThan(0)
        
        // Verify it used the JSON ratio
        const serialized = JSON.stringify(payload)
        const expected = Math.ceil(Buffer.byteLength(serialized, 'utf8') / 2.8)
        expect(meta['tokenEstimate']).toBe(expected)
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
