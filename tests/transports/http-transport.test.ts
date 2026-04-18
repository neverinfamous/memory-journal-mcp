/**
 * HTTP Transport Coverage Tests
 *
 * Unit tests for HttpTransport class with mocked Express and MCP SDK.
 * Focuses on easy coverage gains: constructor, stop(), middleware behavior,
 * and route handler logic — without spinning up real HTTP servers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Hoisted mocks — vi.hoisted ensures these are available before vi.mock
// ============================================================================

const {
    mockRoutes,
    mockMiddlewares,
    mockApp,
    MockStreamableHTTPServerTransport,
    MockSSEServerTransport,
} = vi.hoisted(() => {
    const handleRequest = vi.fn().mockResolvedValue(undefined)
    const transportClose = vi.fn().mockResolvedValue(undefined)

    const routes: Record<string, Record<string, Function>> = {
        get: {},
        post: {},
        delete: {},
        all: {},
    }
    const middlewares: Function[] = []

    const app = {
        use: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args.length === 1 && typeof args[0] === 'function') {
                middlewares.push(args[0] as Function)
            }
        }),
        get: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['get']![path] = handler
        }),
        post: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['post']![path] = handler
        }),
        delete: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['delete']![path] = handler
        }),
        all: vi.fn().mockImplementation((path: string, handler: Function) => {
            routes['all']![path] = handler
        }),
        listen: vi.fn().mockImplementation((_port: number, _host: string, cb?: () => void) => {
            if (cb) cb()
            return { close: vi.fn(), on: vi.fn(), setTimeout: vi.fn() }
        }),
    }

    // Class-based mocks — classes work correctly with `new` operator
    class StreamableMock {
        sessionId: string
        handleRequest = handleRequest
        close = transportClose
        onclose: (() => void) | null = null
        constructor(opts?: {
            sessionIdGenerator?: () => string
            onsessioninitialized?: (sid: string) => void
        }) {
            this.sessionId = opts?.sessionIdGenerator?.() ?? 'mock-session-id'
            if (opts?.onsessioninitialized) {
                setTimeout(() => opts.onsessioninitialized!(this.sessionId), 0)
            }
        }
    }

    class SSEMock {
        sessionId = 'sse-mock-session'
        handlePostMessage = vi.fn().mockResolvedValue(undefined)
        close = transportClose
        onclose: (() => void) | null = null
        start = vi.fn().mockResolvedValue(undefined)
    }

    return {
        mockHandleRequest: handleRequest,
        mockTransportClose: transportClose,
        mockRoutes: routes,
        mockMiddlewares: middlewares,
        mockApp: app,
        MockStreamableHTTPServerTransport: StreamableMock,
        MockSSEServerTransport: SSEMock,
    }
})

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: MockStreamableHTTPServerTransport,
}))

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
    SSEServerTransport: MockSSEServerTransport,
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
    isInitializeRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('express', () => {
    const expressFn = vi.fn().mockReturnValue(mockApp)
    return {
        default: Object.assign(expressFn, {
            json: vi.fn().mockReturnValue(vi.fn()),
        }),
    }
})

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

// ============================================================================
// Import after mocks
// ============================================================================

import { HttpTransport, type HttpTransportConfig } from '../../src/transports/http/index.js'

// ============================================================================
// Helpers
// ============================================================================

function mockReq(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        method: 'GET',
        path: '/',
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
    // Make status().json() / status().end() / status().send() chain work
    res['status'] = vi.fn().mockReturnValue(res)
    return res
}

// ============================================================================
// Tests
// ============================================================================

describe('HttpTransport', () => {
    const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<HttpTransport['start']>[0]

    beforeEach(() => {
        vi.clearAllMocks()
        for (const method of Object.keys(mockRoutes)) {
            mockRoutes[method] = {}
        }
        mockMiddlewares.length = 0
    })

    // ========================================================================
    // Constructor
    // ========================================================================

    describe('constructor', () => {
        it('should create instance with config', () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: false,
            }
            const transport = new HttpTransport(config)
            expect(transport).toBeDefined()
        })
    })

    // ========================================================================
    // start — stateless
    // ========================================================================

    describe('start - stateless mode', () => {
        it('should register routes and start server', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            expect(mockApp.use).toHaveBeenCalled()
            expect(mockApp.listen).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function))
        })

        it('should throw on wildcard CORS and no auth', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await expect(transport.start((() => mockServer) as never, null)).rejects.toThrow(/FATAL/)
        })
    })

    // ========================================================================
    // start — stateful with auth
    // ========================================================================

    describe('start - stateful mode with auth', () => {
        it('should setup auth middleware when token provided', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: false,
                authToken: 'test-token-123',
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            expect(mockApp.use).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // start — middleware behavior
    // ========================================================================

    describe('middleware behavior', () => {
        /** Find a middleware by probing: returns the first mw whose invocation triggers the predicate. */
        function findMiddleware(
            predicate: (res: Record<string, unknown>) => boolean
        ): Function | undefined {
            for (const mw of mockMiddlewares) {
                const req = mockReq()
                const res = mockRes()
                try {
                    mw(req, res, () => {})
                } catch {
                    /* hostHeaderValidation may throw */
                }
                if (predicate(res)) return mw
            }
            return undefined
        }

        it('should set security headers on requests', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // Find middleware that sets security headers (position is dynamic due to hostHeaderValidation)
            const securityMw = findMiddleware((res) => {
                const calls = (res['setHeader'] as ReturnType<typeof vi.fn>).mock.calls as [
                    string,
                    string,
                ][]
                return calls.some((c) => c[0] === 'X-Content-Type-Options')
            })
            expect(securityMw).toBeDefined()

            const req = mockReq()
            const res = mockRes()
            securityMw!(req, res, () => {})

            const setCalls = (res['setHeader'] as ReturnType<typeof vi.fn>).mock.calls
            const headerNames = setCalls.map((c: unknown[]) => c[0] as string)
            expect(headerNames).toContain('X-Content-Type-Options')
            expect(headerNames).toContain('X-Frame-Options')
            expect(headerNames).toContain('Cache-Control')
        })

        it('should set HSTS when enableHSTS is true', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
                enableHSTS: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // Find security headers middleware by behavior
            const securityMw = findMiddleware((res) => {
                const calls = (res['setHeader'] as ReturnType<typeof vi.fn>).mock.calls as [
                    string,
                    string,
                ][]
                return calls.some((c) => c[0] === 'Strict-Transport-Security')
            })
            expect(securityMw).toBeDefined()

            const req = mockReq()
            const res = mockRes()
            securityMw!(req, res, () => {})

            const setCalls = (res['setHeader'] as ReturnType<typeof vi.fn>).mock.calls
            const headerNames = setCalls.map((c: unknown[]) => c[0] as string)
            expect(headerNames).toContain('Strict-Transport-Security')
        })

        it('should handle CORS OPTIONS preflight with 204', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // Find the OPTIONS middleware by behavior (returns 204 for OPTIONS)
            let optionsMw: Function | undefined
            for (const mw of mockMiddlewares) {
                const req = mockReq({ method: 'OPTIONS' })
                const res = mockRes()
                try {
                    mw(req, res, () => {})
                } catch {
                    /* skip */
                }
                if (
                    (res['status'] as ReturnType<typeof vi.fn>).mock.calls.some(
                        (c: unknown[]) => c[0] === 204
                    )
                ) {
                    optionsMw = mw
                    break
                }
            }
            expect(optionsMw).toBeDefined()

            const req = mockReq({ method: 'OPTIONS' })
            const res = mockRes()
            optionsMw!(req, res, () => {})

            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(204)
        })

        it('should pass non-OPTIONS requests through CORS middleware', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const corsMw = mockMiddlewares[1]
            const req = mockReq({ method: 'POST' })
            const res = mockRes()
            let nextCalled = false
            corsMw!(req, res, () => {
                nextCalled = true
            })
            expect(nextCalled).toBe(true)
        })
    })

    // ========================================================================
    // start — route handlers
    // ========================================================================

    describe('route handlers', () => {
        it('should return healthy on GET /health', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const handler = mockRoutes['get']!['/health']
            expect(handler).toBeDefined()

            const res = mockRes()
            handler!(mockReq(), res)
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(200)
            expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'healthy' })
            )
        })

        it('should return server info on GET /', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const handler = mockRoutes['get']!['/']
            expect(handler).toBeDefined()

            const res = mockRes()
            handler!(mockReq(), res)
            expect(res['json'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'memory-journal-mcp' })
            )
        })

        it('should return 204 for OPTIONS via middleware', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // Find the OPTIONS middleware by behavior (position is dynamic)
            let optionsMw: Function | undefined
            for (const mw of mockMiddlewares) {
                const probe = mockRes()
                try {
                    mw(mockReq({ method: 'OPTIONS' }), probe, () => {})
                } catch {
                    /* skip */
                }
                if (
                    (probe['status'] as ReturnType<typeof vi.fn>).mock.calls.some(
                        (c: unknown[]) => c[0] === 204
                    )
                ) {
                    optionsMw = mw
                    break
                }
            }
            expect(optionsMw).toBeDefined()

            const req = mockReq({ method: 'OPTIONS' })
            const res = mockRes()
            const next = vi.fn()
            optionsMw!(req, res, next)
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(204)
            expect(next).not.toHaveBeenCalled()
        })

        it('should pass non-OPTIONS requests through OPTIONS middleware', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const optionsMw = mockMiddlewares[1]
            const req = mockReq({ method: 'POST' })
            const res = mockRes()
            let nextCalled = false
            optionsMw!(req, res, () => {
                nextCalled = true
            })
            expect(nextCalled).toBe(true)
        })

        it('should return 404 for unknown routes', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // 404 handler is the last registered middleware
            const lastMw = mockMiddlewares[mockMiddlewares.length - 1]
            expect(lastMw).toBeDefined()

            const res = mockRes()
            lastMw!(mockReq(), res)
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(404)
        })
    })

    // ========================================================================
    // start — stateless /mcp routes
    // ========================================================================

    describe('stateless /mcp routes', () => {
        it('should return 405 for GET /mcp in stateless mode', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const handler = mockRoutes['get']!['/mcp']
            expect(handler).toBeDefined()

            const res = mockRes()
            handler!(mockReq(), res)
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(405)
        })

        it('should return 204 for DELETE /mcp in stateless mode', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            const handler = mockRoutes['delete']!['/mcp']
            expect(handler).toBeDefined()

            const res = mockRes()
            handler!(mockReq(), res)
            expect(res['end'] as ReturnType<typeof vi.fn>).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // start — scheduler
    // ========================================================================

    describe('scheduler', () => {
        it('should start scheduler after server listen', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const mockScheduler = { start: vi.fn(), stop: vi.fn() }
            const transport = new HttpTransport(config)
            await transport.start(((() => mockServer) as never),
                mockScheduler as unknown as Parameters<HttpTransport['start']>[1]
            )

            expect(mockScheduler.start).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // stop
    // ========================================================================

    describe('stop', () => {
        it('should clean up on stop', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)
            await transport.stop(null)
            // Should not throw
        })

        it('should stop scheduler on stop', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const mockScheduler = { start: vi.fn(), stop: vi.fn() }
            const transport = new HttpTransport(config)
            await transport.start(((() => mockServer) as never),
                mockScheduler as unknown as Parameters<HttpTransport['start']>[1]
            )
            await transport.stop(mockScheduler as unknown as Parameters<HttpTransport['stop']>[0])

            expect(mockScheduler.stop).toHaveBeenCalled()
        })

        it('should catch errors when closing active transports and SSE transports', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            transport.transports.set('dummy-1', {
                close: vi.fn().mockRejectedValue(new Error('dummy close error')),
            } as any)
            transport.sseTransports.set('dummy-2', {
                close: vi.fn().mockRejectedValue(new Error('dummy sse close error')),
            } as any)

            // Should gracefully catch and log without throwing
            await transport.stop(null)
            expect(transport.transports.size).toBe(0)
            expect(transport.sseTransports.size).toBe(0)
        })
    })

    // ========================================================================
    // Rate limiter middleware
    // ========================================================================

    describe('rate limiter middleware', () => {
        it('should enforce rate limits and bypass health check', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
                enableRateLimit: true,
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            let rateLimiterMw: Function | undefined
            for (const mw of mockMiddlewares) {
                const res = mockRes()
                try {
                    // Send 101 requests from the same IP
                    for (let i = 0; i < 101; i++) {
                        mw(mockReq({ path: '/mcp', ip: '10.0.0.5' }), res, () => {})
                    }
                } catch {
                    /* skip */
                }

                if ((res['status'] as any).mock.calls.some((c: any) => c[0] === 429)) {
                    rateLimiterMw = mw
                    break
                }
            }
            expect(rateLimiterMw).toBeDefined()

            // Verify a health check bypasses it even if rate limited
            const healthRes = mockRes()
            let nextCalled = false
            rateLimiterMw!(mockReq({ path: '/health', ip: '10.0.0.5' }), healthRes, () => {
                nextCalled = true
            })
            expect(nextCalled).toBe(true)
            expect(healthRes['status'] as any).not.toHaveBeenCalledWith(429)

            // Cleanup any intervals started by HttpTransport for rate limiting
            await transport.stop(null)
        })
    })

    // ========================================================================
    // Auth middleware
    // ========================================================================

    describe('auth middleware', () => {
        it('should reject bad tokens with 401', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '127.0.0.1',
                corsOrigins: ['http://localhost'],
                stateless: true,
                authToken: 'secret-token',
            }
            const transport = new HttpTransport(config)
            await transport.start((() => mockServer) as never, null)

            // Auth middleware checks req.path and authorization header.
            // It's registered via app.use() after security, CORS, json, rate-limit.
            // Find it by testing: sends 401 for bad token on /mcp path.
            const authMw = mockMiddlewares.find((mw) => {
                const req = mockReq({
                    path: '/mcp',
                    headers: { authorization: 'Bearer wrong-token' },
                })
                const res = mockRes()
                mw(req, res, () => {})
                return (res['status'] as ReturnType<typeof vi.fn>).mock.calls.some(
                    (c: unknown[]) => c[0] === 401
                )
            })

            expect(authMw).toBeDefined()

            // /health should bypass auth
            const healthReq = mockReq({ path: '/health' })
            const healthRes = mockRes()
            let healthNext = false
            authMw!(healthReq, healthRes, () => {
                healthNext = true
            })
            expect(healthNext).toBe(true)

            // Valid token should pass through
            const goodReq = mockReq({
                path: '/mcp',
                headers: { authorization: 'Bearer secret-token' },
            })
            const goodRes = mockRes()
            let goodNext = false
            authMw!(goodReq, goodRes, () => {
                goodNext = true
            })
            expect(goodNext).toBe(true)
        })
    })

    // ========================================================================
    // OAuth mode middleware
    // ========================================================================

    describe('oauth mode setups', () => {
        it('should setup OAuth 2.1 authentication when enabled', async () => {
            const originalFetch = global.fetch
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ keys: [] })
            }) as unknown as typeof fetch

            try {
                const config: HttpTransportConfig = {
                    port: 3000,
                    host: '127.0.0.1',
                    corsOrigins: ['http://localhost'],
                    stateless: true,
                    oauthEnabled: true,
                    oauthIssuer: 'https://auth.example.com',
                    oauthAudience: 'test-audience',
                }
                const transport = new HttpTransport(config)
                await transport.start((() => mockServer) as never, null)

                // Should register the well-known route
                expect(mockRoutes['get']!['/.well-known/oauth-protected-resource']).toBeDefined()
            } finally {
                global.fetch = originalFetch
            }
        })

    })
})
