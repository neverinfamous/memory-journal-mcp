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
            return { close: vi.fn(), on: vi.fn() }
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
                host: '0.0.0.0',
                corsOrigins: ['*'],
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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

            expect(mockApp.use).toHaveBeenCalled()
            expect(mockApp.listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function))
        })

        it('should warn about wildcard CORS and no auth', async () => {
            const { logger } = await import('../../src/utils/logger.js')
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

            expect(logger.warning).toHaveBeenCalledWith(
                expect.stringContaining('CORS origin'),
                expect.any(Object)
            )
            expect(logger.warning).toHaveBeenCalledWith(
                expect.stringContaining('No authentication'),
                expect.any(Object)
            )
        })
    })

    // ========================================================================
    // start — stateful with auth
    // ========================================================================

    describe('start - stateful mode with auth', () => {
        it('should setup auth middleware when token provided', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigin: 'http://localhost',
                stateless: false,
                authToken: 'test-token-123',
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
                enableHSTS: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

            const handler = mockRoutes['get']!['/mcp']
            expect(handler).toBeDefined()

            const res = mockRes()
            handler!(mockReq(), res)
            expect(res['status'] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(405)
        })

        it('should return 204 for DELETE /mcp in stateless mode', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const mockScheduler = { start: vi.fn(), stop: vi.fn() }
            const transport = new HttpTransport(config)
            await transport.start(
                mockServer,
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
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)
            await transport.stop(null)
            // Should not throw
        })

        it('should stop scheduler on stop', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigin: '*',
                stateless: true,
            }
            const mockScheduler = { start: vi.fn(), stop: vi.fn() }
            const transport = new HttpTransport(config)
            await transport.start(
                mockServer,
                mockScheduler as unknown as Parameters<HttpTransport['start']>[1]
            )
            await transport.stop(mockScheduler as unknown as Parameters<HttpTransport['stop']>[0])

            expect(mockScheduler.stop).toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Auth middleware
    // ========================================================================

    describe('auth middleware', () => {
        it('should reject bad tokens with 401', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigins: ['http://localhost'],
                stateless: true,
                authToken: 'secret-token',
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

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
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
                oauthEnabled: true,
                oauthIssuer: 'https://auth.example.com',
                oauthAudience: 'test-audience',
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

            // Should register the well-known route
            expect(mockRoutes['get']!['/.well-known/oauth-protected-resource']).toBeDefined()
        })

        it('should enforce OAuth scopes on tools/call requests', async () => {
            const config: HttpTransportConfig = {
                port: 3000,
                host: '0.0.0.0',
                corsOrigins: ['*'],
                stateless: true,
                oauthEnabled: true,
                oauthIssuer: 'https://auth.example.com',
                oauthAudience: 'test-audience',
            }
            const transport = new HttpTransport(config)
            await transport.start(mockServer, null)

            // The OAuth scope middleware is pushed into mockMiddlewares.
            // We can find it by passing a request with no `req.auth` and a tool call body, which returns 401.
            let scopeMw: Function | undefined
            for (const mw of mockMiddlewares) {
                const req = mockReq({
                    method: 'POST',
                    body: { method: 'tools/call', params: { name: 'mj_execute_code' } },
                })
                const res = mockRes()
                try {
                    mw(req, res, () => {})
                } catch {}
                if ((res['status'] as any).mock.calls.some((c: any) => c[0] === 401)) {
                    scopeMw = mw
                    break
                }
            }
            expect(scopeMw).toBeDefined()

            // Test non-POST / non-tools/call
            const req1 = mockReq({ method: 'GET' })
            const next1 = vi.fn()
            scopeMw!(req1, mockRes(), next1)
            expect(next1).toHaveBeenCalled()

            // Test no params name
            const req2 = mockReq({ method: 'POST', body: { method: 'tools/call' } })
            const next2 = vi.fn()
            scopeMw!(req2, mockRes(), next2)
            expect(next2).toHaveBeenCalled()

            // Test sufficient scope
            const req3 = mockReq({
                method: 'POST',
                body: { method: 'tools/call', params: { name: 'mj_execute_code' } },
                auth: { scopes: ['admin'] }, // codemode requires admin scope
            })
            const next3 = vi.fn()
            scopeMw!(req3, mockRes(), next3)
            expect(next3).toHaveBeenCalled()

            // Test insufficient scope
            const req4 = mockReq({
                method: 'POST',
                body: { method: 'tools/call', params: { name: 'mj_execute_code' } },
                auth: { scopes: ['read'] },
            })
            const res4 = mockRes()
            scopeMw!(req4, res4, vi.fn())
            expect(res4['status']).toHaveBeenCalledWith(403)
        })
    })
})
