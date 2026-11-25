import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { rateLimitIdentity } from '../../src/transports/http/security.js'

describe('rateLimitIdentity', () => {
    it('hashes the bearer token and ignores the client IP when a token is present', () => {
        const token = 'token-a'
        const expected = createHash('sha256').update(token).digest('hex')
        expect(rateLimitIdentity(`Bearer ${token}`, '10.0.0.1')).toBe(expected)
        expect(rateLimitIdentity(`Bearer ${token}`, '10.0.0.2')).toBe(expected)
    })

    it('uses a different key for a different token', () => {
        const first = rateLimitIdentity('Bearer token-a', '1.1.1.1')
        const second = rateLimitIdentity('Bearer token-b', '1.1.1.1')
        expect(first).not.toBe(second)
    })

    it('hashes the client IP when no bearer token is present', () => {
        const expected = createHash('sha256').update('10.0.0.8').digest('hex')
        expect(rateLimitIdentity(undefined, '10.0.0.8')).toBe(expected)
        expect(rateLimitIdentity('Basic abc', '10.0.0.8')).toBe(expected)
    })
})
