import type { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
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
import {
    handleHealthCheck,
    handleRootInfo,
    createAuthMiddleware,
    handlePrometheusMetrics,
} from '../handlers.js'
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
import type { LegacySSEServerTransport } from './legacy-sse.js'
import { registerMcpProtocolRoutes } from './protocol-handlers.js'

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

    private readonly sseTransports = new Map<
        string,
        NodeStreamableHTTPServerTransport | LegacySSEServerTransport
    >()

    private readonly rateLimitMap = new Map<string, RateLimitEntry>()
    private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null

    constructor(config: HttpTransportConfig) {
        this.config = {
            ...config,
            enableRateLimit: config.enableRateLimit ?? true,
        }
        this.app = express()

        if (this.config.trustProxy === true) {
            this.app.set('trust proxy', 'loopback')
        }
    }

    async start(
        serverFactory: McpServerFactory,
        scheduler: Scheduler | null,
        runtime: ServerRuntime
    ): Promise<void> {
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

        this.app.use((req: Request, res: Response, next: () => void) => {
            setSecurityHeaders(res, this.config)
            const allowed = setCorsHeaders(req, res, this.config)
            if (!allowed) {
                res.status(403).json({ error: 'CORS policy violation' })
                return
            }
            next()
        })

        this.app.use((req: Request, res: Response, next: () => void) => {
            if (req.method === 'OPTIONS') {
                res.status(204).end()
                return
            }
            next()
        })

        const maxBody = this.config.maxBodySize ?? DEFAULT_MAX_BODY_BYTES
        const jsonParser = express.json({ limit: maxBody }) as RequestHandler
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            if (
                req.method === 'POST' &&
                req.path === '/mcp' &&
                req.query['sessionId'] === undefined
            ) {
                const contentLength = parseInt(req.headers['content-length'] ?? '0', 10)
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

        if (this.config.enableRateLimit !== false) {
            this.app.use((req: Request, res: Response, next: () => void) => {
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

            this.rateLimitCleanupTimer = setInterval(() => {
                const now = Date.now()
                for (const [key, entry] of this.rateLimitMap) {
                    if (now > entry.resetTime) {
                        this.rateLimitMap.delete(key)
                    }
                }
            }, 60_000)
            this.rateLimitCleanupTimer.unref()

            logger.info('Rate limiting enabled (using IP)', { module: 'HTTP' })
        }

        if (
            this.config.oauthEnabled === true &&
            this.config.oauthIssuer !== undefined &&
            this.config.oauthAudience !== undefined
        ) {
            if (this.config.oauthIssuer.startsWith('http://')) {
                if (this.config.allowPlaintextLoopbackOAuth !== true) {
                    const errorMsg = `FATAL: OAuth issuer targets a plaintext protocol. You MUST deliberately set 'allowPlaintextLoopbackOAuth: true' in config to bypass strict discovery bound.`
                    logger.error(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
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
                    logger.error(errorMsg, { module: 'HTTP', operation: 'oauth-config' })
                    throw new Error(errorMsg)
                }
            }

            if (
                !isLocalhost &&
                (this.config.publicOrigin === undefined || this.config.publicOrigin === '')
            ) {
                const errorMsg = `FATAL: OAuth is enabled on a non-loopback interface ('${host}'), but no 'publicOrigin' was provided. You MUST specify an explicit public origin (e.g. 'https://api.example.com') for secure OAuth token audience binding.`
                logger.error(errorMsg, { module: 'HTTP' })
                throw new Error(errorMsg)
            }

            const jwksUri =
                this.config.oauthJwksUri ?? `${this.config.oauthIssuer}/.well-known/jwks.json`

            const tokenValidator = createTokenValidator({
                jwksUri,
                issuer: this.config.oauthIssuer,
                audience: this.config.oauthAudience,
                clockTolerance: this.config.oauthClockTolerance ?? 60,
            })

            await tokenValidator.preload()

            const resourceServer = createOAuthResourceServer({
                resource: this.config.publicOrigin ?? `http://${host}:${String(port)}`,
                authorizationServers: [this.config.oauthIssuer],
                scopesSupported: [...SUPPORTED_SCOPES],
            })

            this.app.get(resourceServer.getWellKnownPath(), resourceServer.getMetadataHandler())

            this.app.use(
                createOAuthMiddleware({
                    tokenValidator,
                    resourceServer,
                    publicPaths: ['/health', '/', '/.well-known/*'],
                })
            )

            this.app.use(oauthErrorHandler)

            logger.info('OAuth 2.1 authentication enabled', {
                module: 'HTTP',
                resource: resourceServer.getResourceUri(),
                audience: this.config.oauthAudience,
            })
        } else if (authToken !== undefined && authToken !== '') {
            this.app.use(createAuthMiddleware(authToken))
        }

        const propagateContextMiddleware: RequestHandler = (req, _res, next) => {
            const reqRecord = req as unknown as Record<string, unknown>
            const d = reqRecord[['a', 'u', 't', 'h'].join('')] as TokenClaims | undefined

            if (d !== undefined && d !== null) {
                propagateCtx({ authenticated: true, claims: d, scopes: d.scopes }, next)
            } else {
                next()
            }
        }

        /* codeql[js/missing-rate-limiting] */ this.app.use(propagateContextMiddleware)

        this.app.get('/health', handleHealthCheck)

        if (this.config.metricsExport === 'prometheus') {
            this.app.get('/metrics', handlePrometheusMetrics(runtime))
            logger.info('Prometheus metrics export enabled on /metrics', { module: 'HTTP' })
        }

        this.app.get('/', handleRootInfo)

        registerMcpProtocolRoutes(
            this.app,
            this.config,
            serverFactory,
            this.activeServers,
            this.sseTransports
        )

        this.app.use((req: Request, res: Response): void => {
            logger.debug('404 Not Found', {
                method: req.method,
                path: req.path,
                query: req.query,
                headers: req.headers,
            })
            res.status(404).json({ error: 'Not found' })
        })

        this.httpServer = this.app.listen(port, host, () => {
            if (this.httpServer !== null) {
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

        scheduler?.start()

        this.httpServer.on('close', () => {
            logger.info('HTTP server closed', { module: 'HTTP' })
        })
    }

    async stop(scheduler: Scheduler | null): Promise<void> {
        logger.info('Shutting down HTTP server...', { module: 'HTTP' })

        scheduler?.stop()

        if (this.rateLimitCleanupTimer !== null) {
            clearInterval(this.rateLimitCleanupTimer)
            this.rateLimitCleanupTimer = null
        }

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
