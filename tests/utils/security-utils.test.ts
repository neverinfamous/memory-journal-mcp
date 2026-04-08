/**
 * Security Utilities Tests - sanitizeErrorForLogging
 *
 * Covers the token scrubbing function not tested by sql-injection.test.ts.
 */

import { describe, it, expect } from 'vitest'
import {
    sanitizeErrorForLogging,
    assertSafeDirectoryPath,
    PathTraversalError,
} from '../../src/utils/security-utils.js'

describe('assertSafeDirectoryPath', () => {
    it('should validate normal directory paths', () => {
        expect(() => assertSafeDirectoryPath('C:/Users/chris/Documents')).not.toThrow()
        expect(() => assertSafeDirectoryPath('/usr/local/bin')).not.toThrow()
        expect(() => assertSafeDirectoryPath('export')).not.toThrow()
        expect(() => assertSafeDirectoryPath('./export')).not.toThrow()
    })

    it('should validate Windows style paths safely', () => {
        expect(() => assertSafeDirectoryPath('C:\\Users\\chris\\Documents')).not.toThrow()
        expect(() => assertSafeDirectoryPath('.\\export')).not.toThrow()
    })

    it('should throw PathTraversalError for `..` segments with forward slash', () => {
        expect(() => assertSafeDirectoryPath('../secrets')).toThrow(PathTraversalError)
        expect(() => assertSafeDirectoryPath('/var/logs/../../etc/passwd')).toThrow(
            PathTraversalError
        )
        expect(() => assertSafeDirectoryPath('export/..')).toThrow(PathTraversalError)
    })

    it('should throw PathTraversalError for `..` segments with backslash', () => {
        expect(() => assertSafeDirectoryPath('..\\secrets')).toThrow(PathTraversalError)
        expect(() => assertSafeDirectoryPath('C:\\Users\\..\\Admin')).toThrow(PathTraversalError)
    })

    it('should NOT throw on valid directory names containing `..` like `..foo` or `foo..`', () => {
        expect(() => assertSafeDirectoryPath('/var/logs/..foo/')).not.toThrow()
        expect(() => assertSafeDirectoryPath('/var/logs/foo../')).not.toThrow()
        expect(() => assertSafeDirectoryPath('..foo')).not.toThrow()
    })
})

describe('sanitizeErrorForLogging', () => {
    it('should redact GitHub classic PATs (ghp_)', () => {
        const token = 'ghp_' + 'A'.repeat(36)
        const message = `Request failed: token ${token} is invalid`
        const result = sanitizeErrorForLogging(message)

        expect(result).not.toContain(token)
        expect(result).toContain('[REDACTED]')
        expect(result).toBe('Request failed: token [REDACTED] is invalid')
    })

    it('should redact GitHub fine-grained PATs (github_pat_)', () => {
        const token = 'github_pat_' + 'B'.repeat(82)
        const message = `Auth error with ${token}`
        const result = sanitizeErrorForLogging(message)

        expect(result).not.toContain(token)
        expect(result).toContain('[REDACTED]')
    })

    it('should redact Authorization headers with token', () => {
        const message =
            'Failed request with Authorization: token ghp_secret123456789012345678901234567890'
        const result = sanitizeErrorForLogging(message)

        expect(result).toContain('[REDACTED]')
        expect(result).not.toContain('ghp_secret')
    })

    it('should redact Authorization headers with Bearer', () => {
        const message = 'Error: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
        const result = sanitizeErrorForLogging(message)

        expect(result).toContain('[REDACTED]')
        expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    })

    it('should redact generic Bearer tokens', () => {
        const message = 'Token expired: Bearer abc123.def456.ghi789+/=='
        const result = sanitizeErrorForLogging(message)

        expect(result).toContain('[REDACTED]')
        expect(result).not.toContain('abc123.def456')
    })

    it('should pass through clean messages unchanged', () => {
        const message = 'Database connection failed at localhost:5432'
        expect(sanitizeErrorForLogging(message)).toBe(message)
    })

    it('should pass through empty string', () => {
        expect(sanitizeErrorForLogging('')).toBe('')
    })

    it('should handle multiple tokens in one message', () => {
        const token1 = 'ghp_' + 'C'.repeat(36)
        const token2 = 'ghp_' + 'D'.repeat(36)
        const message = `Token1: ${token1}, Token2: ${token2}`
        const result = sanitizeErrorForLogging(message)

        expect(result).not.toContain(token1)
        expect(result).not.toContain(token2)
        expect(result).toBe('Token1: [REDACTED], Token2: [REDACTED]')
    })

    it('should be idempotent - calling twice yields same result', () => {
        const token = 'ghp_' + 'E'.repeat(36)
        const message = `Error with ${token}`
        const first = sanitizeErrorForLogging(message)
        const second = sanitizeErrorForLogging(first)
        expect(first).toBe(second)
    })
})
