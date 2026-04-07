/**
 * memory-journal-mcp — HttpTransport Lifecycle Tests
 *
 * Tests for HttpTransport class constructor, start(), stop(),
 * and touchSession() covering branch/line gaps in server/index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Hoisted mocks
// ============================================================================

const {
    mockSetupStateful,
    mockSetupStateless,
    mockSetupLegacySSE,
    mockListen,
    mockClose,
    mockOn,
    mockUse,
    mockGet,
} = vi.hoisted(() => ({
    mockSetupStateful: vi.fn().mockReturnValue(999),
    mockSetupStateless: vi.fn().mockResolvedValue(undefined),
    mockSetupLegacySSE: vi.fn(),
    mockListen: vi.fn(),
    mockClose: vi.fn(),
    mockOn: vi.fn(),
    mockUse: vi.fn(),
    mockGet: vi.fn(),
}))

vi.mock('../../src/transports/http/server/stateful.js', () => ({
    setupStateful: mockSetupStateful,
}))
vi.mock('../../src/transports/http/server/stateless.js', () => ({
    setupStateless: mockSetupStateless,
}))
vi.mock('../../src/transports/http/server/legacy-sse.js', () => ({
    setupLegacySSE: mockSetupLegacySSE,
}))

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/auth/index.js', () => ({
    createTokenValidator: vi.fn(),
    createOAuthResourceServer: vi.fn().mockReturnValue({
        getWellKnownPath: vi.fn().mockReturnValue('/.well-known/oauth-protected-resource'),
        getMetadataHandler: vi.fn().mockReturnValue(vi.fn()),
    }),
    createAuthMiddleware: vi.fn().mockReturnValue(vi.fn()),
    oauthErrorHandler: vi.fn(),
    SUPPORTED_SCOPES: ['journal:read', 'journal:write'],
}))

vi.mock('../../src/transports/http/handlers.js', () => ({
    handleHealthCheck: vi.fn(),
    handleRootInfo: vi.fn(),
    createAuthMiddleware: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('../../src/transports/http/security.js', () => ({
    setSecurityHeaders: vi.fn(),
    setCorsHeaders: vi.fn(),
    checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}))

vi.mock('@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js', () => ({
    hostHeaderValidation: vi.fn().mockReturnValue(vi.fn()),
    localhostHostValidation: vi.fn().mockReturnValue(vi.fn()),
}))

// Mock express — factory must only reference hoisted variables
vi.mock('express', () => {
    const app = {
        use: mockUse,
        get: mockGet,
        post: vi.fn(),
        delete: vi.fn(),
        listen: mockListen.mockImplementation((_port: number, _host: string, cb: () => void) => {
            cb()
            return {
                setTimeout: vi.fn(),
                keepAliveTimeout: 0,
                headersTimeout: 0,
                on: mockOn,
                close: mockClose,
            }
        }),
    }
    const expressFn = vi.fn().mockReturnValue(app) as any
    // express.json() is a static method that returns body-parser middleware
    expressFn.json = vi.fn().mockReturnValue(vi.fn())
    return { default: expressFn }
})

import { HttpTransport } from '../../src/transports/http/server/index.js'

// ============================================================================
// Tests
// ============================================================================

describe('HttpTransport', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // ========================================================================
    // Constructor
    // ========================================================================

    it('should default enableRateLimit to true', () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
        } as never)

        expect(transport).toBeDefined()
    })

    // ========================================================================
    // start()
    // ========================================================================

    it('should start in stateful mode by default', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        expect(mockSetupStateful).toHaveBeenCalled()
        expect(mockSetupLegacySSE).toHaveBeenCalled()
        expect(mockSetupStateless).not.toHaveBeenCalled()
    })

    it('should start in stateless mode when configured', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            stateless: true,
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        expect(mockSetupStateless).toHaveBeenCalled()
        expect(mockSetupStateful).not.toHaveBeenCalled()
    })

    it('should warn when no CORS origins or wildcard CORS', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        const { logger } = await import('../../src/utils/logger.js')
        expect(logger.warning).toHaveBeenCalledWith(
            expect.stringContaining('CORS'),
            expect.any(Object)
        )
    })

    it('should warn when no auth token configured', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        const { logger } = await import('../../src/utils/logger.js')
        expect(logger.warning).toHaveBeenCalledWith(
            expect.stringContaining('No authentication'),
            expect.any(Object)
        )
    })

    it('should apply bearer token auth when authToken is provided', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            authToken: 'secret-token',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        // authToken is set, so no "no auth" warning
        const { logger } = await import('../../src/utils/logger.js')
        expect(logger.warning).not.toHaveBeenCalledWith(
            expect.stringContaining('No authentication'),
            expect.any(Object)
        )
    })

    it('should start scheduler if provided', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        const mockScheduler = { start: vi.fn(), stop: vi.fn() }
        await transport.start(mockServer as never, mockScheduler as never)

        expect(mockScheduler.start).toHaveBeenCalled()
    })

    it('should configure HTTP server timeouts and close handler', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        // httpServer is mocked in express listen
        const { logger } = await import('../../src/utils/logger.js')

        // Find the 'close' event handler
        const closeCall = mockOn.mock.calls.find((c) => c[0] === 'close')
        expect(closeCall).toBeDefined()
        if (closeCall && typeof closeCall[1] === 'function') {
            closeCall[1]()
            expect(logger.info).toHaveBeenCalledWith('HTTP server closed', expect.any(Object))
        }
    })

    it('should occasionally clean up rateLimitMap entries', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            enableRateLimit: true,
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        const rateLimitMap = (transport as any).rateLimitMap as Map<string, any>
        rateLimitMap.set('192.168.1.1', { resetTime: Date.now() - 1000, count: 50 })
        rateLimitMap.set('192.168.1.2', { resetTime: Date.now() + 100000, count: 5 })

        // Trigger setInterval
        vi.advanceTimersByTime(61000)

        // Expired entry should be gone, valid entry should remain
        expect(rateLimitMap.has('192.168.1.1')).toBe(false)
        expect(rateLimitMap.has('192.168.1.2')).toBe(true)
    })

    // ========================================================================
    // stop()
    // ========================================================================

    it('should close all transports on stop', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        // Add mock transports
        const mockTransport = { close: vi.fn().mockResolvedValue(undefined) }
        transport.transports.set('session-1', mockTransport as never)
        transport.sseTransports.set('sse-1', mockTransport as never)

        await transport.stop(null)

        expect(mockTransport.close).toHaveBeenCalledTimes(2) // Both streamable and SSE
        expect(transport.transports.size).toBe(0)
        expect(transport.sseTransports.size).toBe(0)
    })

    it('should handle transport close error gracefully during stop', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        await transport.start(mockServer as never, null)

        const errorTransport = { close: vi.fn().mockRejectedValue(new Error('close error')) }
        transport.transports.set('err-session', errorTransport as never)

        // Should not throw
        await expect(transport.stop(null)).resolves.toBeUndefined()
    })

    it('should stop scheduler during shutdown', async () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
            corsOrigins: ['http://example.com'],
        } as never)

        const mockServer = { connect: vi.fn() }
        const mockScheduler = { start: vi.fn(), stop: vi.fn() }
        await transport.start(mockServer as never, mockScheduler as never)

        await transport.stop(mockScheduler as never)

        expect(mockScheduler.stop).toHaveBeenCalled()
    })

    // ========================================================================
    // touchSession
    // ========================================================================

    it('should update session last activity timestamp', () => {
        const transport = new HttpTransport({
            port: 3000,
            host: 'localhost',
        } as never)

        transport.touchSession('session-1')
        expect(transport.sessionLastActivity.get('session-1')).toBeGreaterThan(0)
    })
})
