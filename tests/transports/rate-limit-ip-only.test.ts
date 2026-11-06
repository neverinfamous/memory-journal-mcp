import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { checkRateLimit } from '../../src/transports/http/security.js'
import type { HttpTransportConfig, RateLimitEntry } from '../../src/transports/http/types.js'

function makeReq(ip: string, authorization?: string): Request {
    return {
        ip,
        headers: authorization !== undefined ? { authorization } : {},
        socket: { remoteAddress: ip },
    } as unknown as Request
}

const config = {
    port: 3000,
    host: 'localhost',
    rateLimitMaxRequests: 2,
    rateLimitWindowMs: 60_000,
} as unknown as HttpTransportConfig

describe('checkRateLimit keys on client IP only', () => {
    it('does not grant a fresh bucket when the bearer token rotates', () => {
        const map = new Map<string, RateLimitEntry>()

        expect(checkRateLimit(makeReq('10.0.0.1', 'Bearer fake-1'), config, map).allowed).toBe(true)
        expect(checkRateLimit(makeReq('10.0.0.1', 'Bearer fake-2'), config, map).allowed).toBe(true)
        expect(checkRateLimit(makeReq('10.0.0.1', 'Bearer fake-3'), config, map).allowed).toBe(false)
        expect(map.size).toBe(1)
    })

    it('keeps separate buckets for different IPs', () => {
        const map = new Map<string, RateLimitEntry>()

        checkRateLimit(makeReq('10.0.0.1'), config, map)
        checkRateLimit(makeReq('10.0.0.1'), config, map)
        expect(checkRateLimit(makeReq('10.0.0.2'), config, map).allowed).toBe(true)
        expect(map.size).toBe(2)
    })
})
