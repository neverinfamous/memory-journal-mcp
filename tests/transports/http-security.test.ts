/**
 * memory-journal-mcp — HTTP Security Tests
 *
 * Tests for security.ts: getClientIp, checkRateLimit,
 * setSecurityHeaders, matchesCorsOrigin, setCorsHeaders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    getClientIp,
    checkRateLimit,
    setSecurityHeaders,
    matchesCorsOrigin,
    setCorsHeaders,
} from '../../src/transports/http/security.js'
import type { HttpTransportConfig, RateLimitEntry } from '../../src/transports/http/types.js'

// ============================================================================
// Helpers
// ============================================================================

function mockReq(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        headers: {},
        ip: '192.168.1.1',
        socket: { remoteAddress: '192.168.1.1' },
        ...overrides,
    }
}

function mockRes(): Record<string, unknown> {
    return {
        setHeader: vi.fn(),
    }
}

// ============================================================================
// getClientIp
// ============================================================================

describe('getClientIp', () => {
    it('should return req.ip when trustProxy is false', () => {
        const req = mockReq({
            headers: { 'x-forwarded-for': '10.0.0.1' },
            ip: '192.168.1.100',
        })
        const ip = getClientIp(req as never, false)
        expect(ip).toBe('192.168.1.100')
    })

    it('should return X-Forwarded-For first IP when trustProxy is true', () => {
        const req = mockReq({
            headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1' },
        })
        const ip = getClientIp(req as never, true)
        expect(ip).toBe('10.0.0.1')
    })

    it('should fall back to req.ip when X-Forwarded-For is absent', () => {
        const req = mockReq({ ip: '172.16.0.5' })
        const ip = getClientIp(req as never, true)
        expect(ip).toBe('172.16.0.5')
    })

    it('should fall back to socket.remoteAddress when req.ip is undefined', () => {
        const req = mockReq({ ip: undefined })
        const ip = getClientIp(req as never, false)
        expect(ip).toBe('192.168.1.1')
    })

    it('should return "unknown" when no IP available', () => {
        const req = mockReq({ ip: undefined, socket: { remoteAddress: undefined } })
        const ip = getClientIp(req as never, false)
        expect(ip).toBe('unknown')
    })
})

// ============================================================================
// checkRateLimit
// ============================================================================

describe('checkRateLimit', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should allow when rate limiting is disabled', () => {
        const config = { enableRateLimit: false } as HttpTransportConfig
        const rateLimitMap = new Map<string, RateLimitEntry>()
        const req = mockReq()

        const result = checkRateLimit(req as never, config, rateLimitMap)
        expect(result.allowed).toBe(true)
    })

    it('should allow first request and create entry', () => {
        const config = { enableRateLimit: true } as HttpTransportConfig
        const rateLimitMap = new Map<string, RateLimitEntry>()
        const req = mockReq({ ip: '10.0.0.1' })

        const result = checkRateLimit(req as never, config, rateLimitMap)

        expect(result.allowed).toBe(true)
        expect(rateLimitMap.has('10.0.0.1')).toBe(true)
    })

    it('should deny when rate limit exceeded', () => {
        const config = {
            enableRateLimit: true,
            rateLimitMaxRequests: 2,
            rateLimitWindowMs: 60_000,
        } as HttpTransportConfig
        const rateLimitMap = new Map<string, RateLimitEntry>()
        const req = mockReq({ ip: '10.0.0.1' })

        // First two should be allowed
        checkRateLimit(req as never, config, rateLimitMap)
        checkRateLimit(req as never, config, rateLimitMap)

        // Third should be denied
        const result = checkRateLimit(req as never, config, rateLimitMap)
        expect(result.allowed).toBe(false)
        expect(result.retryAfterSeconds).toBeGreaterThan(0)
    })

    it('should reset after window expires', () => {
        const config = {
            enableRateLimit: true,
            rateLimitMaxRequests: 1,
            rateLimitWindowMs: 1000,
        } as HttpTransportConfig
        const rateLimitMap = new Map<string, RateLimitEntry>()
        const req = mockReq({ ip: '10.0.0.1' })

        // Use up the limit
        checkRateLimit(req as never, config, rateLimitMap)

        // Simulate window expiry by modifying entry
        const entry = rateLimitMap.get('10.0.0.1')!
        entry.resetTime = Date.now() - 1

        // Should be allowed again
        const result = checkRateLimit(req as never, config, rateLimitMap)
        expect(result.allowed).toBe(true)
    })

    it('should read MCP_RATE_LIMIT_MAX from env', () => {
        const originalEnv = process.env['MCP_RATE_LIMIT_MAX']
        process.env['MCP_RATE_LIMIT_MAX'] = '1'

        const config = { enableRateLimit: true } as HttpTransportConfig
        const rateLimitMap = new Map<string, RateLimitEntry>()
        const req = mockReq({ ip: '10.0.0.1' })

        // First allowed
        checkRateLimit(req as never, config, rateLimitMap)
        // Second denied (limit is 1)
        const result = checkRateLimit(req as never, config, rateLimitMap)
        expect(result.allowed).toBe(false)

        // Restore
        if (originalEnv === undefined) {
            delete process.env['MCP_RATE_LIMIT_MAX']
        } else {
            process.env['MCP_RATE_LIMIT_MAX'] = originalEnv
        }
    })
})

// ============================================================================
// setSecurityHeaders
// ============================================================================

describe('setSecurityHeaders', () => {
    it('should set all standard security headers', () => {
        const res = mockRes()
        const config = {} as HttpTransportConfig

        setSecurityHeaders(res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const headerNames = setHeader.mock.calls.map((c: unknown[]) => c[0])

        expect(headerNames).toContain('X-Content-Type-Options')
        expect(headerNames).toContain('X-Frame-Options')
        expect(headerNames).toContain('Cache-Control')
        expect(headerNames).toContain('Content-Security-Policy')
        expect(headerNames).toContain('Permissions-Policy')
        expect(headerNames).toContain('Referrer-Policy')
    })

    it('should NOT set HSTS when enableHSTS is falsy', () => {
        const res = mockRes()
        const config = {} as HttpTransportConfig

        setSecurityHeaders(res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const headerNames = setHeader.mock.calls.map((c: unknown[]) => c[0])

        expect(headerNames).not.toContain('Strict-Transport-Security')
    })

    it('should set HSTS with default max-age when enableHSTS is true', () => {
        const res = mockRes()
        const config = { enableHSTS: true } as HttpTransportConfig

        setSecurityHeaders(res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const hstsCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Strict-Transport-Security'
        )
        expect(hstsCall).toBeDefined()
        expect(hstsCall[1]).toContain('includeSubDomains')
    })

    it('should set HSTS with custom max-age', () => {
        const res = mockRes()
        const config = { enableHSTS: true, hstsMaxAge: 86400 } as HttpTransportConfig

        setSecurityHeaders(res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const hstsCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Strict-Transport-Security'
        )
        expect(hstsCall[1]).toContain('max-age=86400')
    })
})

// ============================================================================
// matchesCorsOrigin
// ============================================================================

describe('matchesCorsOrigin', () => {
    it('should match wildcard', () => {
        expect(matchesCorsOrigin('https://example.com', '*')).toBe(true)
    })

    it('should match exact origin', () => {
        expect(matchesCorsOrigin('https://example.com', 'https://example.com')).toBe(true)
    })

    it('should NOT match different origin', () => {
        expect(matchesCorsOrigin('https://other.com', 'https://example.com')).toBe(false)
    })

    it('should match wildcard subdomain pattern', () => {
        expect(matchesCorsOrigin('https://sub.example.com', '*.example.com')).toBe(true)
    })

    it('should NOT match base domain for wildcard subdomain', () => {
        expect(matchesCorsOrigin('https://example.com', '*.example.com')).toBe(false)
    })

    it('should match deeply nested subdomains', () => {
        expect(matchesCorsOrigin('https://deep.sub.example.com', '*.example.com')).toBe(true)
    })
})

// ============================================================================
// setCorsHeaders
// ============================================================================

describe('setCorsHeaders', () => {
    it('should set wildcard CORS for ["*"]', () => {
        const req = mockReq()
        const res = mockRes()
        const config = { corsOrigins: ['*'] } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const originCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Access-Control-Allow-Origin'
        )
        expect(originCall![1]).toBe('*')
    })

    it('should echo origin when it matches whitelist', () => {
        const req = mockReq({ headers: { origin: 'https://example.com' } })
        const res = mockRes()
        const config = { corsOrigins: ['https://example.com'] } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const originCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Access-Control-Allow-Origin'
        )
        expect(originCall![1]).toBe('https://example.com')
    })

    it('should set Vary: Origin for non-wildcard', () => {
        const req = mockReq({ headers: { origin: 'https://example.com' } })
        const res = mockRes()
        const config = { corsOrigins: ['https://example.com'] } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const varyCall = setHeader.mock.calls.find((c: unknown[]) => c[0] === 'Vary')
        expect(varyCall![1]).toBe('Origin')
    })

    it('should NOT set origin when request origin not in whitelist', () => {
        const req = mockReq({ headers: { origin: 'https://evil.com' } })
        const res = mockRes()
        const config = { corsOrigins: ['https://example.com'] } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const originCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Access-Control-Allow-Origin'
        )
        expect(originCall).toBeUndefined()
    })

    it('should set credentials header when corsAllowCredentials is true', () => {
        const req = mockReq({ headers: { origin: 'https://example.com' } })
        const res = mockRes()
        const config = {
            corsOrigins: ['https://example.com'],
            corsAllowCredentials: true,
        } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const credCall = setHeader.mock.calls.find(
            (c: unknown[]) => c[0] === 'Access-Control-Allow-Credentials'
        )
        expect(credCall![1]).toBe('true')
    })

    it('should always set method, header, expose, and max-age headers', () => {
        const req = mockReq()
        const res = mockRes()
        const config = { corsOrigins: ['*'] } as HttpTransportConfig

        setCorsHeaders(req as never, res as never, config)

        const setHeader = res['setHeader'] as ReturnType<typeof vi.fn>
        const headerNames = setHeader.mock.calls.map((c: unknown[]) => c[0])

        expect(headerNames).toContain('Access-Control-Allow-Methods')
        expect(headerNames).toContain('Access-Control-Allow-Headers')
        expect(headerNames).toContain('Access-Control-Expose-Headers')
        expect(headerNames).toContain('Access-Control-Max-Age')
    })
})
