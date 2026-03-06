/* eslint-disable @typescript-eslint/no-deprecated -- Intentional: SSEServerTransport provides backward compatibility for MCP 2024-11-05 clients */
/**
 * Memory Journal MCP Server - HTTP Transport
 *
 * Dual-protocol HTTP transport:
 * - `/mcp` — Streamable HTTP transport (MCP 2025-03-26)
 * - `/sse` + `/messages` — Legacy SSE transport (MCP 2024-11-05)
 *
 * Modes:
 * - Stateful (default): Multi-session management with SSE streaming
 * - Stateless (opt-in): Lightweight serverless-compatible mode
 *
 * Security: headers, CORS, rate limiting, body size enforcement.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import express from 'express'
import type { Express, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { logger } from '../utils/logger.js'
import type { Scheduler } from '../server/Scheduler.js'
import pkg from '../../package.json' with { type: 'json' }

/** Session timeout for stateful HTTP mode (30 minutes) */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** Session timeout sweep interval (5 minutes) */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig {
    port: number
    host: string
    corsOrigin: string
    stateless: boolean
    authToken?: string
}

/**
 * HTTP Transport for Memory Journal MCP Server
 *
 * Supports two transport protocols simultaneously:
 * 1. Streamable HTTP (MCP 2025-03-26) via `/mcp` — preferred for modern clients
 * 2. Legacy SSE (MCP 2024-11-05) via `/sse` + `/messages` — backward compatibility
 */
export class HttpTransport {
    private readonly app: Express
    private readonly config: HttpTransportConfig
    private readonly transports = new Map<string, StreamableHTTPServerTransport>()
    private readonly sseTransports = new Map<string, SSEServerTransport>()
    private readonly sessionLastActivity = new Map<string, number>()
    private httpServer: ReturnType<Express['listen']> | null = null
    private sessionSweepTimer: ReturnType<typeof setInterval> | null = null

    constructor(config: HttpTransportConfig) {
        this.config = config
        this.app = express()
    }

    /**
     * Initialize and start the HTTP transport
     */
    async start(server: McpServer, scheduler: Scheduler | null): Promise<void> {
        const { port, host, corsOrigin, authToken } = this.config

        if (corsOrigin === '*') {
            logger.warning(
                'CORS origin is set to "*" (all origins). ' +
                    'Set --cors-origin or MCP_CORS_ORIGIN for production deployments.',
                { module: 'HTTP' }
            )
        }

        if (!authToken) {
            logger.warning(
                'No authentication configured for HTTP transport. ' +
                    'Set --auth-token or MCP_AUTH_TOKEN for production deployments.',
                { module: 'HTTP' }
            )
        }

        // Security headers middleware
        this.app.use((req: Request, res: Response, next: () => void) => {
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('X-Frame-Options', 'DENY')
            res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('Referrer-Policy', 'no-referrer')
            res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
            // HSTS — only emit when behind a TLS-terminating reverse proxy
            if (req.headers?.['x-forwarded-proto'] === 'https') {
                res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
            }
            next()
        })

        // CORS middleware
        this.app.use((req: Request, res: Response, next: () => void) => {
            res.setHeader('Access-Control-Allow-Origin', corsOrigin)
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Content-Type, Accept, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version'
            )
            res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')

            if (req.method === 'OPTIONS') {
                res.status(204).end()
                return
            }

            next()
        })

        // JSON body parser with size limit (DoS prevention)
        this.app.use(express.json({ limit: '1mb' }))

        // Rate limiting (100 requests/minute per IP)
        const limiter = rateLimit({
            windowMs: 60 * 1000,
            limit: 100,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: { error: 'Too many requests, please try again later' },
        })
        this.app.use(limiter)
        logger.info('Rate limiting enabled: 100 requests/minute per IP', {
            module: 'HTTP',
        })

        // Bearer token authentication (when configured)
        if (authToken) {
            this.app.use((req: Request, res: Response, next: () => void) => {
                if (req.path === '/health') {
                    next()
                    return
                }

                const header = req.headers.authorization
                const expected = Buffer.from(`Bearer ${authToken}`)
                const received = Buffer.from(header ?? '')
                if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
                    res.status(401).json({ error: 'Unauthorized' })
                    return
                }
                next()
            })
            logger.info('Bearer token authentication enabled', { module: 'HTTP' })
        }

        // Health check endpoint (before /mcp routes)
        this.app.get('/health', (_req: Request, res: Response): void => {
            res.status(200).json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
            })
        })

        // Root info endpoint
        this.app.get('/', (_req: Request, res: Response): void => {
            res.status(200).json({
                name: 'memory-journal-mcp',
                version: pkg.version,
                description: 'Project context management for AI-assisted development',
                endpoints: {
                    'POST /mcp': 'JSON-RPC requests (Streamable HTTP, MCP 2025-03-26)',
                    'GET /mcp': 'SSE stream for server-to-client notifications',
                    'DELETE /mcp': 'Session termination',
                    'GET /sse': 'Legacy SSE connection (MCP 2024-11-05)',
                    'POST /messages': 'Legacy SSE message endpoint',
                    'GET /health': 'Health check',
                },
                documentation: 'https://github.com/neverinfamous/memory-journal-mcp',
            })
        })

        // OPTIONS handler for /mcp — MUST be before other /mcp routes
        this.app.all('/mcp', (req: Request, res: Response, next: () => void) => {
            if (req.method === 'OPTIONS') {
                res.status(204).end()
                return
            }
            next()
        })

        if (this.config.stateless) {
            await this.setupStateless(server)
        } else {
            this.setupStateful(server)
            this.setupLegacySSE(server)
        }

        // 404 handler — must be after all routes
        this.app.use((_req: Request, res: Response): void => {
            res.status(404).json({ error: 'Not found' })
        })

        // Start HTTP server
        this.httpServer = this.app.listen(port, host, () => {
            logger.info(
                `MCP server started on HTTP (${this.config.stateless ? 'stateless' : 'stateful'})`,
                {
                    module: 'HTTP',
                    port,
                    host,
                    endpoint: `http://${host}:${port}/mcp`,
                }
            )
        })

        // Start scheduler after HTTP server is listening
        scheduler?.start()

        this.httpServer.on('close', () => {
            logger.info('HTTP server closed', { module: 'HTTP' })
        })
    }

    /**
     * Graceful shutdown
     */
    async stop(scheduler: Scheduler | null): Promise<void> {
        logger.info('Shutting down HTTP server...', { module: 'HTTP' })

        scheduler?.stop()

        // Close all Streamable HTTP transports
        for (const [sessionId, transport] of this.transports) {
            try {
                logger.debug('Closing Streamable HTTP transport', {
                    module: 'HTTP',
                    sessionId,
                })
                await transport.close()
            } catch (error) {
                logger.error('Error closing transport', {
                    module: 'HTTP',
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        this.transports.clear()

        // Close all Legacy SSE transports
        for (const [sessionId, transport] of this.sseTransports) {
            try {
                logger.debug('Closing Legacy SSE transport', {
                    module: 'HTTP',
                    sessionId,
                })
                await transport.close()
            } catch (error) {
                logger.error('Error closing SSE transport', {
                    module: 'HTTP',
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        this.sseTransports.clear()

        this.sessionLastActivity.clear()
        if (this.sessionSweepTimer !== null) {
            clearInterval(this.sessionSweepTimer)
        }

        if (this.httpServer !== null) {
            this.httpServer.close()
        }

        logger.info('Shutdown complete', { module: 'HTTP' })
    }

    // =========================================================================
    // Stateless Mode
    // =========================================================================

    /**
     * Setup stateless transport (single transport, no session management)
     */
    private async setupStateless(server: McpServer): Promise<void> {
        const statelessTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        })

        await server.connect(statelessTransport)
        logger.info('Stateless transport connected', { module: 'HTTP' })

        // POST /mcp — all requests go to the same transport
        this.app.post('/mcp', (req: Request, res: Response): void => {
            void statelessTransport.handleRequest(
                req as unknown as IncomingMessage,
                res as unknown as ServerResponse,
                req.body as unknown
            )
        })

        // GET /mcp — SSE not available in stateless mode
        this.app.get('/mcp', (_req: Request, res: Response): void => {
            res.status(405).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'SSE streaming not available in stateless mode',
                },
                id: null,
            })
        })

        // DELETE /mcp — no-op in stateless mode
        this.app.delete('/mcp', (_req: Request, res: Response): void => {
            res.status(204).end()
        })
    }

    // =========================================================================
    // Stateful Mode
    // =========================================================================

    /** Update the last-activity timestamp for a session */
    private touchSession(sid: string): void {
        this.sessionLastActivity.set(sid, Date.now())
    }

    /**
     * Setup stateful transport (multi-session, SSE streaming)
     */
    private setupStateful(server: McpServer): void {
        // Start session timeout sweep (runs every 5 minutes)
        this.sessionSweepTimer = setInterval(() => {
            const now = Date.now()
            for (const [sid, lastActivity] of this.sessionLastActivity) {
                const idleMs = now - lastActivity
                if (idleMs <= SESSION_TIMEOUT_MS) continue

                // Expire idle Streamable HTTP sessions
                if (this.transports.has(sid)) {
                    logger.info('Expiring idle HTTP session', {
                        module: 'HTTP',
                        sessionId: sid,
                        idleMinutes: Math.round(idleMs / 60_000),
                    })
                    const t = this.transports.get(sid)
                    if (t) {
                        void t.close()
                    }
                    this.transports.delete(sid)
                    this.sessionLastActivity.delete(sid)
                }

                // Expire idle Legacy SSE sessions
                if (this.sseTransports.has(sid)) {
                    logger.info('Expiring idle SSE session', {
                        module: 'HTTP',
                        sessionId: sid,
                        idleMinutes: Math.round(idleMs / 60_000),
                    })
                    const t = this.sseTransports.get(sid)
                    if (t) {
                        void t.close()
                    }
                    this.sseTransports.delete(sid)
                    this.sessionLastActivity.delete(sid)
                }
            }
        }, SESSION_SWEEP_INTERVAL_MS)

        // POST /mcp — Handle JSON-RPC requests
        this.app.post('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            void (async () => {
                try {
                    let httpTransport: StreamableHTTPServerTransport | undefined

                    if (sessionId !== undefined && this.transports.has(sessionId)) {
                        // Cross-protocol guard: reject SSE session IDs on /mcp
                        if (this.sseTransports.has(sessionId)) {
                            res.status(400).json({
                                jsonrpc: '2.0',
                                error: {
                                    code: -32000,
                                    message:
                                        'Bad Request: Session uses Legacy SSE transport, not Streamable HTTP',
                                },
                                id: null,
                            })
                            return
                        }

                        // Reuse existing transport and refresh session activity
                        this.touchSession(sessionId)
                        httpTransport = this.transports.get(sessionId)
                    } else if (sessionId === undefined && isInitializeRequest(req.body)) {
                        // New initialization request — create transport
                        const newTransport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: () => randomUUID(),
                            onsessioninitialized: (sid: string) => {
                                logger.info('HTTP session initialized', {
                                    module: 'HTTP',
                                    sessionId: sid,
                                })
                                this.transports.set(sid, newTransport)
                                this.touchSession(sid)
                            },
                        })

                        // Clean up on transport close
                        newTransport.onclose = () => {
                            const sid = newTransport.sessionId
                            if (sid !== undefined && this.transports.has(sid)) {
                                logger.info('HTTP transport closed', {
                                    module: 'HTTP',
                                    sessionId: sid,
                                })
                                this.transports.delete(sid)
                                this.sessionLastActivity.delete(sid)
                            }
                        }

                        // Connect transport to server
                        // SDK McpServer only supports one active transport — close first
                        try {
                            await server.connect(newTransport)
                        } catch {
                            await server.close()
                            await server.connect(newTransport)
                        }
                        await newTransport.handleRequest(
                            req as unknown as IncomingMessage,
                            res as unknown as ServerResponse,
                            req.body as unknown
                        )
                        return
                    } else {
                        // Invalid request — no session ID or not initialization
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: 'Bad Request: No valid session ID provided',
                            },
                            id: null,
                        })
                        return
                    }

                    // Handle request with existing transport
                    if (httpTransport !== undefined) {
                        await httpTransport.handleRequest(
                            req as unknown as IncomingMessage,
                            res as unknown as ServerResponse,
                            req.body as unknown
                        )
                    }
                } catch (error) {
                    logger.error('Error handling MCP request', {
                        module: 'HTTP',
                        error: error instanceof Error ? error.message : String(error),
                    })
                    if (!res.headersSent) {
                        res.status(500).json({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal server error' },
                            id: null,
                        })
                    }
                }
            })()
        })

        // GET /mcp — SSE stream for server-to-client notifications
        this.app.get('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !this.transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
            }

            // Refresh session activity on SSE reconnect
            this.touchSession(sessionId)

            const lastEventId = req.headers['last-event-id']
            if (lastEventId !== undefined) {
                logger.debug('Client reconnecting with Last-Event-ID', {
                    module: 'HTTP',
                    sessionId,
                    lastEventId,
                })
            }

            const httpTransport = this.transports.get(sessionId)
            if (httpTransport !== undefined) {
                void httpTransport.handleRequest(
                    req as unknown as IncomingMessage,
                    res as unknown as ServerResponse
                )
            }
        })

        // DELETE /mcp — Session termination
        this.app.delete('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !this.transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
            }

            logger.info('Session termination requested', {
                module: 'HTTP',
                sessionId,
            })

            const httpTransport = this.transports.get(sessionId)
            if (httpTransport !== undefined) {
                void httpTransport.handleRequest(
                    req as unknown as IncomingMessage,
                    res as unknown as ServerResponse
                )
            }
        })
    }

    // =========================================================================
    // Legacy SSE (MCP 2024-11-05)
    // =========================================================================

    /**
     * Setup Legacy SSE endpoints for backward compatibility.
     * Stateful mode only.
     */
    private setupLegacySSE(server: McpServer): void {
        // GET /sse — Open Legacy SSE connection
        this.app.get('/sse', (req: Request, res: Response): void => {
            logger.info('Legacy SSE connection requested', { module: 'HTTP' })

            const sseTransport = new SSEServerTransport(
                '/messages',
                res as unknown as ServerResponse
            )

            // Store transport by session ID after start
            sseTransport.onclose = () => {
                logger.info('Legacy SSE transport closed', {
                    module: 'HTTP',
                    sessionId: sseTransport.sessionId,
                })
                this.sseTransports.delete(sseTransport.sessionId)
            }

            void (async () => {
                try {
                    // Connect SSE transport to server
                    // SDK McpServer only supports one active transport — close first
                    try {
                        await server.connect(
                            sseTransport as unknown as Parameters<typeof server.connect>[0]
                        )
                    } catch {
                        await server.close()
                        await server.connect(
                            sseTransport as unknown as Parameters<typeof server.connect>[0]
                        )
                    }
                    // Note: server.connect() auto-calls start() on SSEServerTransport
                    this.sseTransports.set(sseTransport.sessionId, sseTransport)
                    this.touchSession(sseTransport.sessionId)
                    logger.info('Legacy SSE connection established', {
                        module: 'HTTP',
                        sessionId: sseTransport.sessionId,
                    })
                } catch (error) {
                    logger.error('Error starting SSE transport', {
                        module: 'HTTP',
                        error: error instanceof Error ? error.message : String(error),
                    })
                    if (!res.headersSent) {
                        res.status(500).end()
                    }
                }
            })()

            // Clean up when client disconnects
            req.on('close', () => {
                this.sseTransports.delete(sseTransport.sessionId)
                this.sessionLastActivity.delete(sseTransport.sessionId)
            })
        })

        // POST /messages?sessionId=<id> — Route messages to Legacy SSE transport
        this.app.post('/messages', (req: Request, res: Response): void => {
            const sessionId =
                typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined

            if (sessionId === undefined) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Missing sessionId parameter' },
                    id: null,
                })
                return
            }

            const transport = this.sseTransports.get(sessionId)
            if (transport === undefined) {
                res.status(404).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Session not found' },
                    id: null,
                })
                return
            }

            // Refresh session activity on message receipt
            this.touchSession(sessionId)

            void transport.handlePostMessage(
                req as unknown as IncomingMessage,
                res as unknown as ServerResponse,
                req.body as unknown
            )
        })
    }
}
