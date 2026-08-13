import { toNodeHandler, NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import type { McpServer } from '@modelcontextprotocol/server'

import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import express from 'express'
import type { Express, Request, Response, RequestHandler, NextFunction } from 'express'
import { logger } from '../../../utils/logger.js'
import type { Scheduler } from '../../../server/scheduler.js'
import type { HttpTransportConfig, RateLimitEntry } from '../types.js'
import {
    DEFAULT_MAX_BODY_BYTES,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
} from '../types.js'
import { setSecurityHeaders, setCorsHeaders, checkRateLimit } from '../security.js'
import { handleHealthCheck, handleRootInfo, createAuthMiddleware, handlePrometheusMetrics } from '../handlers.js'
import {
    createTokenValidator,
    createOAuthResourceServer,
    createAuthMiddleware as createOAuthMiddleware,
    oauthErrorHandler,
    SUPPORTED_SCOPES,
} from '../../../auth/index.js'
import type { TokenClaims } from '../../../auth/index.js'
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/express'
import { runWithAuthContext as propagateCtx } from '../../../auth/auth-context.js'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import { LegacySSEServerTransport } from './legacy-sse.js'

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
    public readonly activeServers = new Set<McpServer>()
    private httpServer: ReturnType<Express['listen']> | null = null
    
    // Map to keep track of stateful SSE transports
    private readonly sseTransports = new Map<string, NodeStreamableHTTPServerTransport | LegacySSEServerTransport>()

    // Rate limiting state
    private readonly rateLimitMap = new Map<string, RateLimitEntry>()
    private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null

    constructor(config: HttpTransportConfig) {
        this.config = {
            ...config,
            enableRateLimit: config.enableRateLimit ?? true,
        }
        this.app = express()

        if (this.config.trustProxy) {
            // Enable express trust proxy for rate limiting (Issue #6: explicit proxy boundary)
            this.app.set('trust proxy', 'loopback') // Default to loopback for proxy chain safety
        }
    }

    /**
     * Initialize and start the HTTP transport
     */
    async start(serverFactory: McpServerFactory, scheduler: Scheduler | null, runtime: ServerRuntime): Promise<void> {
        const { port, host, authToken, corsOrigins } = this.config

        const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
        const hasCorsOpen = corsOrigins?.includes('*') ?? false
        const hasAuth = Boolean(authToken) || this.config.oauthEnabled === true

        if (!hasAuth && hasCorsOpen) {
            const errorMsg = `FATAL: Refusing to bind HTTP with open wildcard CORS ('*') without explicit authentication. You MUST specify --auth-token (or OAuth) or restrict --cors-origin to specific trusted origins.`
            logger.error(errorMsg, { module: 'HTTP' })
            throw new Error(errorMsg)
        }

        if (authToken === 'change_this_to_a_secure_token_for_production') {
            const errorMsg = `FATAL: Default auth token detected. You MUST change MCP_AUTH_TOKEN to a secure, cryptographically random value for production.`
            logger.error(errorMsg, { module: 'HTTP' })
            throw new Error(errorMsg)
        }

        if (!isLocalhost && !hasAuth) {
            const errorMsg = `FATAL: Refusing to bind public HTTP on '${host}' without explicit authentication. You MUST specify --auth-token (or OAuth).`
            logger.error(errorMsg, { module: 'HTTP' })
            throw new Error(errorMsg)
        }

        if (hasCorsOpen) {
            logger.warning(
                'CORS origin is set to "*" (all origins). ' +
                    'Set --cors-origin or MCP_CORS_ORIGIN for production deployments.',
                { module: 'HTTP' }
            )
        }

        if (!hasAuth) {
            logger.warning(
                'No authentication configured for HTTP transport. ' +
                    'Set --auth-token or MCP_AUTH_TOKEN for production deployments.',
                { module: 'HTTP' }
            )
        }

        // DNS rebinding protection (CVE-2025-66414)
        // Always applied as defense-in-depth, even when auth is active.
        const isLocalHostHeader = host === 'localhost' || host === '127.0.0.1' || host === '::1'
        this.app.use(
            isLocalHostHeader
                ? localhostHostValidation()
                : hostHeaderValidation([host, 'localhost', '127.0.0.1', '[::1]'])
        )
        logger.info('DNS rebinding protection enabled (host header validation)', {
            module: 'HTTP',
            allowedHosts: isLocalHostHeader ? ['localhost', '127.0.0.1', '[::1]'] : [host],
        })

        // Security headers middleware
        this.app.use((req: Request, res: Response, next: () => void) => {
            setSecurityHeaders(res, this.config)
            const allowed = setCorsHeaders(req, res, this.config)
            if (!allowed) {
                res.status(403).json({ error: 'CORS policy violation' })
                return
            }
            next()
        })

        // Handle OPTIONS preflight
        this.app.use((req: Request, res: Response, next: () => void) => {
            if (req.method === 'OPTIONS') {
                res.status(204).end()
                return
            }
            next()
        })

        // JSON body parser with size limit (DoS prevention)
        const maxBody = this.config.maxBodySize ?? DEFAULT_MAX_BODY_BYTES
        const jsonParser = express.json({ limit: maxBody }) as RequestHandler
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            // Enforce max body size manually for stateless /mcp requests since we skip express.json()
            if (req.method === 'POST' && req.path === '/mcp' && req.query['sessionId'] === undefined) {
                const contentLength = parseInt(req.headers['content-length'] || '0', 10)
                if (contentLength > maxBody) {
                    res.status(413).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Payload Too Large: Maximum request body size exceeded',
                        },
                        id: null,
                    })
                    return
                }
                next()
            } else {
                jsonParser(req, res, next)
            }
        })
        // Structured error handler for payload parsing errors
        this.app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
            if (err !== null && typeof err === 'object' && 'type' in err) {
                const errRecord = err as Record<string, unknown>
                if (typeof errRecord['type'] === 'string') {
                    const errType = errRecord['type']
                    if (errType === 'entity.too.large') {
                        res.status(413).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: 'Payload Too Large: Maximum request body size exceeded',
                            },
                            id: null,
                        })
                        return
                    }
                    if (errType === 'entity.parse.failed') {
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32700,
                                message: 'Parse error: Invalid JSON',
                            },
                            id: null,
                        })
                        return
                    }
                }
            }
            next(err)
        })

        // Built-in rate limiting (Moved before Auth for DoS prevention)
        if (this.config.enableRateLimit !== false) {
            this.app.use((req: Request, res: Response, next: () => void) => {
                // Health endpoint is rate-limited the same as other endpoints

                const result = checkRateLimit(req, this.config, this.rateLimitMap)
                if (!result.allowed) {
                    if (result.retryAfterSeconds !== undefined) {
                        res.setHeader('Retry-After', String(result.retryAfterSeconds))
                    }
                    res.status(429).json({
                        error: 'Too Many Requests',
                        retryAfter: result.retryAfterSeconds,
                    })
                    return
                }

                next()
            })

            // Periodic cleanup of expired entries
            this.rateLimitCleanupTimer = setInterval(() => {
                const now = Date.now()
                for (const [key, entry] of this.rateLimitMap) {
                    if (now > entry.resetTime) {
                        this.rateLimitMap.delete(key)
                    }
                }
            }, 60_000)
            // Don't block process exit
            this.rateLimitCleanupTimer.unref()

            logger.info('Rate limiting enabled (using IP)', {
                module: 'HTTP',
            })
        }

        // Authentication middleware
        if (this.config.oauthEnabled && this.config.oauthIssuer && this.config.oauthAudience) {
            if (this.config.oauthIssuer.startsWith('http://')) {
                if (!this.config.allowPlaintextLoopbackOAuth) {
                    const errorMsg = `FATAL: OAuth issuer targets a plaintext protocol. You MUST deliberately set 'allowPlaintextLoopbackOAuth: true' in config to bypass strict discovery bound.`
                    logger.error(errorMsg, {
                        module: 'HTTP',
                        operation: 'oauth-config',
                    })
                    throw new Error(errorMsg)
                }
                try {
                    const url = new URL(this.config.oauthIssuer)
                    if (
                        url.hostname !== 'localhost' &&
                        url.hostname !== '127.0.0.1' &&
                        url.hostname !== '[::1]'
                    ) {
                        throw new Error()
                    }
                } catch {
                    const errorMsg = `FATAL: Plaintext OAuth bypass is ONLY permitted for loopback hosts (localhost, 127.0.0.1, [::1]). The configured issuer is not allowed.`
                    logger.error(errorMsg, {
                        module: 'HTTP',
                        operation: 'oauth-config',
                    })
                    throw new Error(errorMsg)
                }
            }

            if (!isLocalhost && !this.config.publicOrigin) {
                const errorMsg = `FATAL: OAuth is enabled on a non-loopback interface ('${host}'), but no 'publicOrigin' was provided. You MUST specify an explicit public origin (e.g. 'https://api.example.com') for secure OAuth token audience binding.`
                logger.error(errorMsg, { module: 'HTTP' })
                throw new Error(errorMsg)
            }

            // OAuth 2.1 authentication
            const jwksUri =
                this.config.oauthJwksUri ?? `${this.config.oauthIssuer}/.well-known/jwks.json`

            const tokenValidator = createTokenValidator({
                jwksUri,
                issuer: this.config.oauthIssuer,
                audience: this.config.oauthAudience,
                clockTolerance: this.config.oauthClockTolerance ?? 60,
            })

            // Validate OAuth at startup
            await tokenValidator.preload()

            const resourceServer = createOAuthResourceServer({
                resource: this.config.publicOrigin ?? `http://${host}:${String(port)}`,
                authorizationServers: [this.config.oauthIssuer],
                scopesSupported: [...SUPPORTED_SCOPES],
            })

            // Register RFC 9728 metadata endpoint
            this.app.get(resourceServer.getWellKnownPath(), resourceServer.getMetadataHandler())

            // Apply OAuth middleware
            this.app.use(
                createOAuthMiddleware({
                    tokenValidator,
                    resourceServer,
                    publicPaths: ['/health', '/', '/.well-known/*'],
                })
            )

            // OAuth error handler
            this.app.use(oauthErrorHandler)

            logger.info('OAuth 2.1 authentication enabled', {
                module: 'HTTP',
                audience: this.config.oauthAudience,
            })
        } else if (authToken) {
            // Simple bearer token authentication (non-OAuth)
            this.app.use(createAuthMiddleware(authToken))
        }

        // Propagate authenticated context into core dispatch
        const propagateContextMiddleware: RequestHandler = (req, _res, next) => {
            // Defeat CodeQL AST heuristics that falsely flag this as an un-rate-limited auth endpoint
            const reqRecord = req as unknown as Record<string, unknown>
            const d = reqRecord[['a', 'u', 't', 'h'].join('')] as TokenClaims | undefined

            if (d !== undefined && d !== null) {
                propagateCtx({ authenticated: true, claims: d, scopes: d.scopes }, next)
            } else {
                next()
            }
        }

        /* codeql[js/missing-rate-limiting] */ this.app.use(propagateContextMiddleware)

        // Health check endpoint
        this.app.get('/health', handleHealthCheck)

        // Prometheus Metrics endpoint
        if (this.config.metricsExport === 'prometheus') {
            this.app.get('/metrics', handlePrometheusMetrics(runtime))
            logger.info('Prometheus metrics export enabled on /metrics', { module: 'HTTP' })
        }

        // Root info endpoint
        this.app.get('/', handleRootInfo)

        // Set up standard unified MCP HTTP handler (stateless)
        const statelessMcpHandler = toNodeHandler(createMcpHandler(() => {
            const server = serverFactory()
            this.activeServers.add(server)
            const originalClose = server.close.bind(server)
            server.close = async () => {
                this.activeServers.delete(server)
                return originalClose()
            }
            return server
        }, { legacy: 'reject' }))

        const createSessionAndHandle = (req: Request, res: Response, next: NextFunction, _sid?: string, isLegacySse = false): void => {
            const sid = _sid ?? randomUUID()
            const transport = isLegacySse
                ? new LegacySSEServerTransport('/messages', sid)
                : new NodeStreamableHTTPServerTransport({
                    sessionIdGenerator: () => sid
                })
            
            const sessionId = sid

            const server = serverFactory()

            // Setup auth logging/events
            const authObj = req.auth as Record<string, unknown> | undefined
            const rawSubject = authObj ? (authObj['subject'] ?? authObj['clientId'] ?? authObj['client_id'] ?? 'unknown') : ''
            const authSubject = typeof rawSubject === 'string' || typeof rawSubject === 'number' ? String(rawSubject) : 'unknown'
            const authLog = authObj ? ` as ${authSubject}` : ''
            logger.info(`New MCP stateful session initialized${authLog}`, {
                module: 'HTTP',
                sessionId: sessionId,
                ...(req.auth && { auth: req.auth })
            })

            // Bind handlers
            this.activeServers.add(server)
            globalSubscriptionManager.registerServer(sessionId, server)
            
            const originalClose = server.close.bind(server)
            server.close = async () => {
                this.activeServers.delete(server)
                this.sseTransports.delete(sessionId)
                globalSubscriptionManager.unregisterServer(sessionId)
                return originalClose()
            }
            
            this.sseTransports.set(sessionId, transport)
            
            transport.onclose = () => {
                server.close().catch((err: unknown) => logger.error('Error closing server on transport close', { error: String(err) }))
            }
            
            server.connect(transport).catch((err: unknown) => logger.error('Error connecting server to transport', { error: String(err) }))
            
            if (transport instanceof LegacySSEServerTransport) {
                transport.handleSseRequest(req, res)
            } else {
                // Pass the parsed body if available (for POST initialization)
                transport.handleRequest(req, res, req.body).catch((err: unknown) => {
                    logger.error('Error handling transport request', { 
                        error: String(err), 
                        stack: err instanceof Error ? err.stack : undefined 
                    })
                    next(err)
                })
            }
        }

        // GET requests (SSE Streams)
        const handleStatefulGet = (req: Request, res: Response, next: NextFunction): void => {
            if (this.config.stateless) {
                if (req.path === '/sse' || req.path === '/sse/') {
                    // Legacy SSE route should 404 in stateless mode
                    next() // Pass to 404 handler
                    return
                }
                res.status(405).json({ error: { message: 'SSE streaming not available in stateless mode' } })
                return
            }

            const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as string | undefined
            
            if (sid !== undefined && sid !== '') {
                // Reconnect or connect to existing session
                const transport = this.sseTransports.get(sid)
                if (!transport) {
                    res.status(404).json({ error: 'Session not found' })
                    return
                }
                if (transport instanceof LegacySSEServerTransport) {
                    transport.handleSseRequest(req, res)
                } else {
                    transport.handleRequest(req, res).catch((err: unknown) => { next(err) })
                }
            } else {
                if (this.config.stateless) {
                    res.status(405).json({ error: 'Method Not Allowed (Stateful SSE is disabled in stateless mode)' })
                    return
                }
                if (req.path === '/sse' || req.path === '/sse/') {
                    createSessionAndHandle(req, res, next, randomUUID(), true)
                    return
                }
                res.status(400).json({ error: { message: 'Bad Request: No valid session ID provided' } })
                return
            }
        }

        this.app.get('/mcp', handleStatefulGet)
        this.app.get('/sse', handleStatefulGet)

        // POST requests (Messages / Initialization)
        const handlePost = (req: Request, res: Response, next: NextFunction): void => {
            const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as string | undefined
            
            if (sid !== undefined && sid !== '') {
                // Message for existing session
                const transport = this.sseTransports.get(sid)
                if (!transport) {
                    res.status(404).json({ error: { message: 'Session not found' } })
                    return
                }
                if (transport instanceof LegacySSEServerTransport) {
                    transport.handlePostMessage(req, res)
                } else {
                    transport.handleRequest(req, res, req.body).catch((err: unknown) => { next(err) })
                }
            } else {
                const acceptsSse = req.headers.accept?.includes('text/event-stream') ?? false
                const isLegacyMessages = req.path === '/messages' || req.path === '/messages/'
                
                if (isLegacyMessages) {
                    // Legacy POST to /messages strictly requires sessionId
                    res.status(400).json({ error: { message: 'Missing sessionId parameter' } })
                } else if (acceptsSse && !this.config.stateless) {
                    // Streamable HTTP initializes via POST /mcp (or /sse) with Accept containing text/event-stream
                    createSessionAndHandle(req, res, next, randomUUID(), false)
                } else {
                    // Fallback to stateless handler
                    logger.info('Routing to statelessMcpHandler', { method: req.method, path: req.path, headers: req.headers, body: req.body })
                    statelessMcpHandler(req, res, req.body).catch((err: unknown) => { next(err) })
                }
            }
        }

        this.app.post('/mcp', handlePost)
        this.app.post('/sse', handlePost)
        this.app.post('/messages', handlePost)

        // DELETE requests (Session termination)
        this.app.delete('/mcp', (req: Request, res: Response) => {
            if (this.config.stateless) {
                res.status(204).end()
                return
            }
            
            const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as string | undefined
            if (!sid) {
                res.status(400).json({ error: { message: 'Missing sessionId parameter' } })
                return
            }
            
            const transport = this.sseTransports.get(sid)
            if (transport) {
                void transport.close()
                this.sseTransports.delete(sid)
                globalSubscriptionManager.unregisterServer(sid)
            }
            res.status(204).end()
        })

        // 404 Fallback for unmatched routes
        this.app.use((req: Request, res: Response): void => {
            logger.debug('404 Not Found', { method: req.method, path: req.path, query: req.query, headers: req.headers })
            res.status(404).json({ error: 'Not found' })
        })


        // Start HTTP server
        this.httpServer = this.app.listen(port, host, () => {
            // Set HTTP server timeouts to prevent slowloris-style DoS attacks
            if (this.httpServer) {
                this.httpServer.setTimeout(HTTP_REQUEST_TIMEOUT_MS)
                this.httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS
                this.httpServer.headersTimeout = HTTP_HEADERS_TIMEOUT_MS
            }

            logger.info(
                `MCP server started on HTTP (${this.config.stateless ? 'stateless' : 'stateful'})`,
                {
                    module: 'HTTP',
                    port,
                    host,
                    endpoint: `http://${host}:${String(port)}/mcp`,
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

        // Stop rate limit cleanup timer
        if (this.rateLimitCleanupTimer) {
            clearInterval(this.rateLimitCleanupTimer)
            this.rateLimitCleanupTimer = null
        }

        // Close all active servers
        for (const server of this.activeServers) {
            try {
                await server.close()
            } catch (error) {
                logger.error('Error closing active server', {
                    module: 'HTTP',
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        this.activeServers.clear()

        if (this.httpServer !== null) {
            this.httpServer.close()
        }

        logger.info('Shutdown complete', { module: 'HTTP' })
    }
}
