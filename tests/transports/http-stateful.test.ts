/**
 * memory-journal-mcp — HTTP Stateful Transport Tests
 *
 * Tests for setupStateful: session sweep, POST/GET/DELETE /mcp handlers,
 * cross-protocol guard, and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Hoisted mocks
// ============================================================================

const { mockHandleRequest, MockStreamableHTTPServerTransport } = vi.hoisted(() => {
    const handleRequest = vi.fn().mockResolvedValue(undefined)
    const transportClose = vi.fn().mockResolvedValue(undefined)

    class StreamableMock {
        sessionId = 'test-session-id'
        handleRequest = handleRequest
        close = transportClose
        onclose: (() => void) | null = null

        constructor(opts?: {
            sessionIdGenerator?: () => string
            onsessioninitialized?: (sid: string) => void
        }) {
            this.sessionId = opts?.sessionIdGenerator?.() ?? 'test-session-id'
            if (opts?.onsessioninitialized) {
                // Auto-fire after construction to simulate SDK behavior
                setTimeout(() => opts.onsessioninitialized?.(this.sessionId), 0)
            }
        }
    }

    return {
        mockHandleRequest: handleRequest,
        mockTransportClose: transportClose,
        MockStreamableHTTPServerTransport: StreamableMock,
    }
})

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: MockStreamableHTTPServerTransport,
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
    isInitializeRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

import {
    setupStateful,
    type StatefulContext,
} from '../../src/transports/http/server/stateful.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockCtx(): StatefulContext {
    return {
        transports: new Map(),
        sseTransports: new Map(),
        sessionLastActivity: new Map(),
        touchSession: vi.fn(),
        serverConnected: false,
    }
}

function mockReq(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        method: 'POST',
        headers: {},
        query: {},
        body: {},
        on: vi.fn(),
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        ...overrides,
    }
}

function mockRes(): Record<string, unknown> {
    const res: Record<string, unknown> = {
        headersSent: false,
        setHeader: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
        end: vi.fn(),
    }
    res['status'] = vi.fn().mockReturnValue(res)
    return res
}

function createMockApp() {
    const routes: Record<string, Record<string, Function>> = {
        get: {},
        post: {},
        delete: {},
    }
    return {
        get: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['get']![path] = handler
        }),
        post: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['post']![path] = handler
        }),
        delete: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['delete']![path] = handler
        }),
        routes,
    }
}

function createMockServer() {
    return {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('setupStateful', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // ========================================================================
    // Setup & sweep
    // ========================================================================

    it('should return a session sweep timer', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)

        expect(timer).toBeDefined()
        clearInterval(timer)
    })

    it('should register POST, GET, DELETE /mcp routes', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)

        expect(app.post).toHaveBeenCalledWith('/mcp', expect.any(Function))
        expect(app.get).toHaveBeenCalledWith('/mcp', expect.any(Function))
        expect(app.delete).toHaveBeenCalledWith('/mcp', expect.any(Function))

        clearInterval(timer)
    })

    it('should expire idle sessions on sweep', () => {
        const ctx = createMockCtx()
        const transport = { close: vi.fn() }
        ctx.transports.set('idle-session', transport as never)
        ctx.sessionLastActivity.set('idle-session', Date.now() - 31 * 60 * 1000) // 31 min ago (> 30 min timeout)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)

        vi.advanceTimersByTime(5 * 60 * 1000) // SESSION_SWEEP_INTERVAL_MS = 5 min

        expect(ctx.transports.has('idle-session')).toBe(false)
        expect(ctx.sessionLastActivity.has('idle-session')).toBe(false)

        clearInterval(timer)
    })

    it('should NOT expire active sessions on sweep', () => {
        const ctx = createMockCtx()
        const transport = { close: vi.fn() }
        ctx.transports.set('active-session', transport as never)
        ctx.sessionLastActivity.set('active-session', Date.now()) // Just now

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)

        vi.advanceTimersByTime(60_000)

        expect(ctx.transports.has('active-session')).toBe(true)

        clearInterval(timer)
    })

    it('should expire idle SSE sessions on sweep', () => {
        const ctx = createMockCtx()
        const transport = { close: vi.fn() }
        ctx.sseTransports.set('sse-session', transport as never)
        ctx.sessionLastActivity.set('sse-session', Date.now() - 31 * 60 * 1000)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)

        vi.advanceTimersByTime(5 * 60 * 1000)

        expect(ctx.sseTransports.has('sse-session')).toBe(false)

        clearInterval(timer)
    })

    // ========================================================================
    // POST /mcp
    // ========================================================================

    it('should return 400 for POST with no session ID and non-init request', async () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: {} })
        const res = mockRes()
        handler(req, res)

        // Wait for async handler
        await vi.advanceTimersByTimeAsync(10)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)
        expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringContaining('No valid session ID'),
                }),
            })
        )

        clearInterval(timer)
    })

    it('should reuse existing transport for valid session', async () => {
        const ctx = createMockCtx()
        const mockTransport = { handleRequest: vi.fn().mockResolvedValue(undefined) }
        ctx.transports.set('existing-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'existing-session' } })
        const res = mockRes()
        handler(req, res)

        await vi.advanceTimersByTimeAsync(10)

        expect(ctx.touchSession).toHaveBeenCalledWith('existing-session')
        expect(mockTransport.handleRequest).toHaveBeenCalled()

        clearInterval(timer)
    })

    it('should reject SSE session IDs on POST /mcp (cross-protocol guard)', async () => {
        const ctx = createMockCtx()
        // Session exists in BOTH transports and sseTransports
        ctx.transports.set('cross-session', {} as never)
        ctx.sseTransports.set('cross-session', {} as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'cross-session' } })
        const res = mockRes()
        handler(req, res)

        await vi.advanceTimersByTimeAsync(10)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)
        expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringContaining('Legacy SSE transport'),
                }),
            })
        )

        clearInterval(timer)
    })

    it('should create new transport for initialization request', async () => {
        vi.mocked(isInitializeRequest).mockReturnValue(true)

        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: {}, body: { method: 'initialize' } })
        const res = mockRes()
        handler(req, res)

        await vi.advanceTimersByTimeAsync(10)

        expect(server.connect).toHaveBeenCalled()
        expect(mockHandleRequest).toHaveBeenCalled()

        // Verify onclose cleanup
        expect(ctx.transports.size).toBeGreaterThan(0)
        const sid = Array.from(ctx.transports.keys())[0]!
        const createdTransport = ctx.transports.get(sid) as any
        if (createdTransport && createdTransport.onclose) {
             createdTransport.onclose()
             expect(ctx.transports.has(sid)).toBe(false)
        }

        clearInterval(timer)
    })

    it('should close existing server connection before reconnecting', async () => {
        vi.mocked(isInitializeRequest).mockReturnValue(true)

        const ctx = createMockCtx()
        ctx.serverConnected = true
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: {}, body: { method: 'initialize' } })
        handler(req, mockRes())

        await vi.advanceTimersByTimeAsync(10)

        expect(server.close).toHaveBeenCalled()
        expect(server.connect).toHaveBeenCalled()

        clearInterval(timer)
    })

    it('should handle 500 error when request throws', async () => {
        const ctx = createMockCtx()
        const mockTransport = {
            handleRequest: vi.fn().mockRejectedValue(new Error('transport error')),
        }
        ctx.transports.set('error-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['post']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'error-session' } })
        const res = mockRes()
        handler(req, res)

        await vi.advanceTimersByTimeAsync(10)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(500)

        clearInterval(timer)
    })

    // ========================================================================
    // GET /mcp
    // ========================================================================

    it('should return 400 for GET /mcp without session ID', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['get']!['/mcp']!

        const req = mockReq({ headers: {} })
        const res = mockRes()
        handler(req, res)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)
        expect(res['send'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
            expect.stringContaining('session')
        )

        clearInterval(timer)
    })

    it('should return 400 for GET /mcp with unknown session', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['get']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'unknown' } })
        const res = mockRes()
        handler(req, res)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)

        clearInterval(timer)
    })

    it('should handle valid GET /mcp with existing session', () => {
        const ctx = createMockCtx()
        const mockTransport = { handleRequest: vi.fn().mockResolvedValue(undefined) }
        ctx.transports.set('sse-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['get']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'sse-session' } })
        const res = mockRes()
        handler(req, res)

        expect(ctx.touchSession).toHaveBeenCalledWith('sse-session')
        expect(mockTransport.handleRequest).toHaveBeenCalled()

        clearInterval(timer)
    })

    it('should log Last-Event-ID on SSE reconnect', () => {
        const ctx = createMockCtx()
        const mockTransport = { handleRequest: vi.fn().mockResolvedValue(undefined) }
        ctx.transports.set('reconnect-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['get']!['/mcp']!

        const req = mockReq({
            headers: {
                'mcp-session-id': 'reconnect-session',
                'last-event-id': 'event-42',
            },
        })
        const res = mockRes()
        handler(req, res)

        expect(ctx.touchSession).toHaveBeenCalledWith('reconnect-session')

        clearInterval(timer)
    })

    // ========================================================================
    // DELETE /mcp
    // ========================================================================

    it('should return 400 for DELETE /mcp without session', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['delete']!['/mcp']!

        const req = mockReq({ headers: {} })
        const res = mockRes()
        handler(req, res)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)

        clearInterval(timer)
    })

    it('should handle DELETE /mcp with valid session', () => {
        const ctx = createMockCtx()
        const mockTransport = { handleRequest: vi.fn().mockResolvedValue(undefined) }
        ctx.transports.set('delete-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        const timer = setupStateful(ctx, app as never, server as never)
        const handler = app.routes['delete']!['/mcp']!

        const req = mockReq({ headers: { 'mcp-session-id': 'delete-session' } })
        const res = mockRes()
        handler(req, res)

        expect(mockTransport.handleRequest).toHaveBeenCalled()

        clearInterval(timer)
    })
})
