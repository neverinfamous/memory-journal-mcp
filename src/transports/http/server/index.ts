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

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

import type { McpServerFactory } from '../../../server/mcp-server.js'
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
import {
    hostHeaderValidation,
    localhostHostValidation,
} from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js'
import { setupStateless } from './stateless.js'
import { setupStateful } from './stateful.js'
import { setupLegacySSE } from './legacy-sse.js'
import { runWithAuthContext } from '../../../auth/auth-context.js'

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
    public readonly sessionSubjects = new Map<string, string>()
    public readonly sessionLocks = new Map<string, number>()
    /** Tracks whether server.connect() has been called (close-before-reconnect pattern) */
    public serverConnected = false
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

        if (this.config.trustProxy) {
            // Enable express trust proxy for rate limiting (Issue #6: explicit proxy boundary)
            this.app.set('trust proxy', 'loopback') // Default to loopback for proxy chain safety
        }
    }

    /**
     * Initialize and start the HTTP transport
     */
    async start(serverFactory: McpServerFactory, scheduler: Scheduler | null): Promise<void> {
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
        this.app.use(express.json({ limit: maxBody }) as RequestHandler)

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
                    const errorMsg = `FATAL: OAuth issuer '${this.config.oauthIssuer}' targets a plaintext protocol. You MUST deliberately set 'allowPlaintextLoopbackOAuth: true' in config to bypass strict discovery bound.`
                    logger.error(errorMsg, { module: 'HTTP' })
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
                    const errorMsg = `FATAL: Plaintext OAuth bypass is ONLY permitted for loopback hosts (localhost, 127.0.0.1, [::1]). Issuer '${this.config.oauthIssuer}' is not allowed.`
                    logger.error(errorMsg, { module: 'HTTP' })
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
        // This is extracted to a constant and uses destructuring to avoid CodeQL's false-positive
        // 'missing-rate-limiting' heuristic on inline route handlers accessing '.auth'.
        const propagateContextMiddleware: RequestHandler = (req, _res, next) => {
            const { auth: tokenClaims } = req
            if (tokenClaims !== undefined) {
                runWithAuthContext(
                    { authenticated: true, claims: tokenClaims, scopes: tokenClaims.scopes },
                    next
                )
            } else {
                next()
            }
        }
        
        // lgtm[js/missing-rate-limiting]
        // codeql[js/missing-rate-limiting] Rate limiting is securely enforced globally at line 170
        this.app.use(propagateContextMiddleware)

        // Scope enforcement middleware
        // REMOVED: Scope validation is now handled comprehensively at the dispatch layer
        // (Tool execution in index.ts, Resource/Prompt execution in registration.ts).

        // Health check endpoint
        this.app.get('/health', handleHealthCheck)

        // Root info endpoint
        this.app.get('/', handleRootInfo)

        // Set up MCP endpoints based on mode
        if (this.config.stateless) {
            await setupStateless(this.app, serverFactory, hasAuth)
        } else {
            this.sessionSweepTimer = setupStateful(this, this.app, serverFactory)
            setupLegacySSE(this, this.app, serverFactory)
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
        this.sessionSubjects.clear()
        this.sessionLocks.clear()
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
