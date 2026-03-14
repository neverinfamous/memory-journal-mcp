/**
 * memory-journal-mcp — HTTP Legacy SSE Transport Tests
 *
 * Tests for setupLegacySSE: GET /sse and POST /messages handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mocks
// ============================================================================

const { MockSSEServerTransport, mockHandlePostMessage } = vi.hoisted(() => {
    const handlePostMessage = vi.fn().mockResolvedValue(undefined)

    class SSEMock {
        sessionId = 'sse-test-session'
        onclose: (() => void) | null = null
        handlePostMessage = handlePostMessage
        close = vi.fn().mockResolvedValue(undefined)

        constructor(_path: string, _res: unknown) {
            // SSEServerTransport takes path and response
        }
    }

    return {
        MockSSEServerTransport: SSEMock,
        mockHandlePostMessage: handlePostMessage,
    }
})

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
    SSEServerTransport: MockSSEServerTransport,
}))

vi.mock('../../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

import { setupLegacySSE } from '../../../src/transports/http/server/legacy-sse.js'
import type { StatefulContext } from '../../../src/transports/http/server/stateful.js'

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
        method: 'GET',
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
    }
    return {
        get: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['get']![path] = handler
        }),
        post: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['post']![path] = handler
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

describe('setupLegacySSE', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should register GET /sse and POST /messages routes', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)

        expect(app.get).toHaveBeenCalledWith('/sse', expect.any(Function))
        expect(app.post).toHaveBeenCalledWith('/messages', expect.any(Function))
    })

    // ========================================================================
    // GET /sse
    // ========================================================================

    it('should establish SSE connection on GET /sse', async () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['get']!['/sse']!

        const req = mockReq()
        const res = mockRes()
        handler(req, res)

        // Wait for async connect
        await vi.waitFor(() => {
            expect(server.connect).toHaveBeenCalled()
        })

        // Verify transport was registered
        expect(ctx.sseTransports.has('sse-test-session')).toBe(true)
        expect(ctx.touchSession).toHaveBeenCalledWith('sse-test-session')
    })

    it('should handle clean up on client disconnect', async () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['get']!['/sse']!

        const req = mockReq()
        const onCallback = vi.fn()
        ;(req as Record<string, unknown>)['on'] = onCallback
        const res = mockRes()
        handler(req, res)

        // Wait for connect
        await vi.waitFor(() => {
            expect(server.connect).toHaveBeenCalled()
        })

        // Simulate client disconnect
        const closeCallback = onCallback.mock.calls.find(
            (call: unknown[]) => call[0] === 'close'
        )?.[1] as (() => void) | undefined
        expect(closeCallback).toBeDefined()

        closeCallback!()
        expect(ctx.sseTransports.has('sse-test-session')).toBe(false)
    })

    it('should handle server connect error with headersSent=false', async () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()
        server.connect.mockRejectedValue(new Error('connect error'))
        server.close.mockRejectedValue(new Error('close also fails'))

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['get']!['/sse']!

        const req = mockReq()
        const res = mockRes()
        handler(req, res)

        // Wait for error handling
        await vi.waitFor(() => {
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(500)
        })
    })

    // ========================================================================
    // POST /messages
    // ========================================================================

    it('should return 400 for POST /messages without sessionId', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['post']!['/messages']!

        const req = mockReq({ query: {} })
        const res = mockRes()
        handler(req, res)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(400)
        expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringContaining('Missing sessionId'),
                }),
            })
        )
    })

    it('should return 404 for POST /messages with unknown sessionId', () => {
        const ctx = createMockCtx()
        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['post']!['/messages']!

        const req = mockReq({ query: { sessionId: 'unknown-session' } })
        const res = mockRes()
        handler(req, res)

        expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(404)
        expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringContaining('Session not found'),
                }),
            })
        )
    })

    it('should forward message to transport for valid sessionId', () => {
        const ctx = createMockCtx()
        const mockTransport = { handlePostMessage: vi.fn().mockResolvedValue(undefined) }
        ctx.sseTransports.set('valid-session', mockTransport as never)

        const app = createMockApp()
        const server = createMockServer()

        setupLegacySSE(ctx, app as never, server as never)
        const handler = app.routes['post']!['/messages']!

        const req = mockReq({
            query: { sessionId: 'valid-session' },
            body: { method: 'tools/list' },
        })
        const res = mockRes()
        handler(req, res)

        expect(ctx.touchSession).toHaveBeenCalledWith('valid-session')
        expect(mockTransport.handlePostMessage).toHaveBeenCalled()
    })
})
