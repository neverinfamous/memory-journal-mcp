/**
 * memory-journal-mcp — HTTP Transport Server
 *
 * Dual-protocol HTTP transport:
 * - `/mcp` — Streamable HTTP transport (MCP 2025-03-26)
 * - `/sse` + `/messages` — Legacy SSE transport (MCP 2024-11-05)
 *
 * Modes:
 * - Stateful (default): Multi-session management with SSE streaming
 * - Stateless (opt-in): Lightweight serverless-compatible mode
 *
 * Security utilities and handlers in ./security.ts and ./handlers.ts.
 * Config types and constants in ./types.ts.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import express from 'express'
import type { Express, Request, Response, RequestHandler } from 'express'
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
import { handleHealthCheck, handleRootInfo, createAuthMiddleware } from '../handlers.js'
import {
    createTokenValidator,
    createOAuthResourceServer,
    createAuthMiddleware as createOAuthMiddleware,
    oauthErrorHandler,
    SUPPORTED_SCOPES,
} from '../../../auth/index.js'

import { setupStateless } from './stateless.js'
import { setupStateful } from './stateful.js'
import { setupLegacySSE } from './legacy-sse.js'

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
    public readonly transports = new Map<string, StreamableHTTPServerTransport>()
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat for MCP 2024-11-05 clients
    public readonly sseTransports = new Map<string, SSEServerTransport>()
    public readonly sessionLastActivity = new Map<string, number>()
    private httpServer: ReturnType<Express['listen']> | null = null
    private sessionSweepTimer: ReturnType<typeof setInterval> | null = null

    // Rate limiting state
    private readonly rateLimitMap = new Map<string, RateLimitEntry>()
    private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null

    constructor(config: HttpTransportConfig) {
        this.config = {
            ...config,
            enableRateLimit: config.enableRateLimit ?? true,
        }
        this.app = express()
    }

    /**
     * Initialize and start the HTTP transport
     */
    async start(server: McpServer, scheduler: Scheduler | null): Promise<void> {
        const { port, host, authToken, corsOrigins } = this.config

        if (!corsOrigins || corsOrigins.includes('*')) {
            logger.warning(
                'CORS origin is set to "*" (all origins). ' +
                    'Set --cors-origin or MCP_CORS_ORIGIN for production deployments.',
                { module: 'HTTP' },
            )
        }

        if (!authToken) {
            logger.warning(
                'No authentication configured for HTTP transport. ' +
                    'Set --auth-token or MCP_AUTH_TOKEN for production deployments.',
                { module: 'HTTP' },
            )
        }

        // Security headers middleware
        this.app.use((req: Request, res: Response, next: () => void) => {
            setSecurityHeaders(res, this.config)
            setCorsHeaders(req, res, this.config)
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
        this.app.use(express.json({ limit: maxBody }) as unknown as RequestHandler)

        // Built-in rate limiting (replaces express-rate-limit)
        if (this.config.enableRateLimit !== false) {
            this.app.use((req: Request, res: Response, next: () => void) => {
                // Health check bypasses rate limiting
                if (req.path === '/health') {
                    next()
                    return
                }

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
                for (const [ip, entry] of this.rateLimitMap) {
                    if (now > entry.resetTime) {
                        this.rateLimitMap.delete(ip)
                    }
                }
            }, 60_000)
            // Don't block process exit
            this.rateLimitCleanupTimer.unref()

            logger.info('Rate limiting enabled: 100 requests/minute per IP', {
                module: 'HTTP',
            })
        }

        // Authentication middleware
        if (
            this.config.oauthEnabled &&
            this.config.oauthIssuer &&
            this.config.oauthAudience
        ) {
            // OAuth 2.1 authentication
            const jwksUri =
                this.config.oauthJwksUri ??
                `${this.config.oauthIssuer}/.well-known/jwks.json`

            const tokenValidator = createTokenValidator({
                jwksUri,
                issuer: this.config.oauthIssuer,
                audience: this.config.oauthAudience,
                clockTolerance: this.config.oauthClockTolerance ?? 60,
            })

            const resourceServer = createOAuthResourceServer({
                resource: `http://${host}:${String(port)}`,
                authorizationServers: [this.config.oauthIssuer],
                scopesSupported: [...SUPPORTED_SCOPES],
            })

            // Register RFC 9728 metadata endpoint
            this.app.get(
                resourceServer.getWellKnownPath(),
                resourceServer.getMetadataHandler()
            )

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
                issuer: this.config.oauthIssuer,
                audience: this.config.oauthAudience,
            })
        } else if (authToken) {
            // Simple bearer token authentication (non-OAuth)
            this.app.use(createAuthMiddleware(authToken))
        }

        // Health check endpoint
        this.app.get('/health', handleHealthCheck)

        // Root info endpoint
        this.app.get('/', handleRootInfo)

        // Set up MCP endpoints based on mode
        if (this.config.stateless) {
            await setupStateless(this.app, server)
        } else {
            this.sessionSweepTimer = setupStateful(this, this.app, server)
            setupLegacySSE(this, this.app, server)
        }
        // 404 handler — must be after all routes
        this.app.use((_req: Request, res: Response): void => {
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
                },
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
    // Session  Activity Tracking
    // =========================================================================

    /** Update the last-activity timestamp for a session */
    public touchSession(sid: string): void {
        this.sessionLastActivity.set(sid, Date.now())
    }

    // =========================================================================
}
