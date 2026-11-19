import type { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import type { McpServer } from '@modelcontextprotocol/server'
import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import express from 'express'
import type { Express, Request, Response, RequestHandler, NextFunction } from 'express'
import { logger } from '../../../utils/logger.js'
import type { HttpTransportConfig, RateLimitEntry } from '../types.js'
import {
    DEFAULT_MAX_BODY_BYTES,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
} from '../types.js'
import {
    setSecurityHeaders,
    setCorsHeaders,
    checkRateLimit,
    buildAllowedHostHeaders,
    isLoopbackHost,
} from '../security.js'
import {
    handleHealthCheck,
    handleRootInfo,
    handlePrometheusMetrics,
} from '../handlers.js'
import { oauthErrorHandler } from '../../../auth/index.js'
import { requireScope } from '../../../auth/middleware.js'
import { installHttpAuthentication } from './http-oauth-setup.js'
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/express'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import type { LegacySSEServerTransport } from './legacy-sse.js'
import { registerMcpProtocolRoutes } from './protocol-handlers.js'
import { assertHttpBindIsSafe } from './protocol-route-handlers.js'
import { createPropagateContextMiddleware } from './context-middleware.js'

/**
 * HTTP Transport for Memory Journal MCP Server
 *
 * Supports two transport protocols simultaneously:
 * 1. Streamable HTTP (MCP 2025-03-26) via `/mcp` — preferred for modern clients
 * 2. Legacy SSE (MCP 2024-11-05) via `/sse` + `/messages` — backward compatibility
 */
export { buildAllowedHostHeaders } from '../security.js'

function isWildcardBindHost(host: string): boolean {
    const h = host.trim().toLowerCase()
    return h === '0.0.0.0' || h === '::' || h === '[::]'
}

function isValidWildcardHostHeader(rawHost: string | string[] | undefined): boolean {
    if (typeof rawHost !== 'string') return false
    const trimmed = rawHost.trim()
    if (trimmed.length === 0 || /\s/.test(trimmed)) return false
    try {
        const parsed = new URL(`http://${trimmed}`)
        return (
            parsed.username === '' &&
            parsed.password === '' &&
            parsed.pathname === '/' &&
            parsed.search === '' &&
            parsed.hash === '' &&
            parsed.hostname.length > 0
        )
    } catch {
        return false
    }
}

function createWildcardHostValidationMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!isValidWildcardHostHeader(req.headers.host)) {
            res.status(403).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Forbidden: Invalid or missing Host header',
                },
                id: null,
            })
            return
        }
        next()
    }
}

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
    private stopSessionSweep: (() => void) | null = null

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

    private installHostValidation(host: string, isLocalhost: boolean, hasAuth: boolean): void {
        const baseAllowedHosts = buildAllowedHostHeaders(host, undefined)
        const allowedHosts = buildAllowedHostHeaders(host, this.config.publicOrigin)
        const hasCustomPublicOrigin =
            this.config.publicOrigin !== undefined &&
            this.config.publicOrigin.trim() !== '' &&
            allowedHosts.length > baseAllowedHosts.length
        const isAuthenticatedWildcard =
            isWildcardBindHost(host) && hasAuth && !hasCustomPublicOrigin

        this.app.use(createWildcardHostValidationMiddleware())
        if (!isAuthenticatedWildcard) {
            this.app.use(
                isLocalhost && !hasCustomPublicOrigin
                    ? localhostHostValidation()
                    : hostHeaderValidation(allowedHosts)
            )
        }
        logger.info('DNS rebinding protection enabled (host header validation)', {
            module: 'HTTP',
            allowedHosts:
                isLocalhost && !hasCustomPublicOrigin
                    ? ['localhost', '127.0.0.1', '[::1]']
                    : isAuthenticatedWildcard
                      ? ['* (authenticated wildcard bind)']
                      : allowedHosts,
        })
    }

    async start(
        serverFactory: McpServerFactory,
        runtime: ServerRuntime
    ): Promise<void> {
        const { port, host, authToken, corsOrigins } = this.config
        assertHttpBindIsSafe(
            host,
            authToken,
            corsOrigins,
            this.config.oauthEnabled,
            (msg) => logger.warning(msg, { module: 'HTTP' }),
            (msg) => logger.error(msg, { module: 'HTTP' })
        )
        const isLocalhost = isLoopbackHost(host)
        const hasAuth = Boolean(authToken) || this.config.oauthEnabled === true
        this.installHostValidation(host, isLocalhost, hasAuth)

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

        try {
            // [INVARIANT] Rate limiting and authentication run before body parsing so
            // rate-limited (429) and unauthenticated (401) requests never parse JSON bodies (M4).
            this.installRateLimiting()
            const oauthInstalled = await installHttpAuthentication(
                this.app,
                this.config,
                host,
                port,
                authToken,
                isLocalhost
            )
            this.installBodyParsing()
            this.installRoutes(serverFactory, runtime, oauthInstalled)
            await this.listen(port, host)
        } catch (error) {
            // [SIDE-EFFECT] Release timers so a failed start does not keep the process alive.
            if (this.rateLimitCleanupTimer !== null) {
                clearInterval(this.rateLimitCleanupTimer)
                this.rateLimitCleanupTimer = null
            }
            this.stopSessionSweep?.()
            this.stopSessionSweep = null
            throw error
        }
    }

    /** Install the body-size guard, JSON parser and body-parser error responses. */
    private installBodyParsing(): void {
        const maxBody = this.config.maxBodySize ?? DEFAULT_MAX_BODY_BYTES
        const jsonParser = express.json({ limit: maxBody }) as RequestHandler
        this.app.use((req: Request, res: Response, next: NextFunction) => {
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
            jsonParser(req, res, next)
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

    }

    /** Install per-IP rate limiting and its periodic cleanup timer. */
    private installRateLimiting(): void {
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

    }

    /** Register context propagation, health/metrics/root endpoints, MCP protocol routes, OAuth error handler and the 404 handler. */
    private installRoutes(
        serverFactory: McpServerFactory,
        runtime: ServerRuntime,
        oauthInstalled = false
    ): void {
        /* codeql[js/missing-rate-limiting] */ this.app.use(createPropagateContextMiddleware())

        this.app.get('/health', handleHealthCheck)

        if (this.config.metricsExport === 'prometheus') {
            if (this.config.oauthEnabled === true) {
                this.app.get('/metrics', requireScope('audit'), handlePrometheusMetrics(runtime))
            } else {
                this.app.get('/metrics', handlePrometheusMetrics(runtime))
            }
            logger.info('Prometheus metrics export enabled on /metrics', { module: 'HTTP' })
        }

        this.app.get('/', handleRootInfo)

        this.stopSessionSweep = registerMcpProtocolRoutes(
            this.app,
            this.config,
            serverFactory,
            this.activeServers,
            this.sseTransports
        )

        if (oauthInstalled) {
            this.app.use(oauthErrorHandler)
        }

        this.app.use((req: Request, res: Response): void => {
            logger.debug('404 Not Found', {
                method: req.method,
                path: req.path,
            })
            res.status(404).json({ error: 'Not found' })
        })
    }

    /** Bind the HTTP server; rejects on bind errors (e.g. EADDRINUSE). */
    private async listen(port: number, host: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const server = this.app.listen(port, host, () => {
                logger.info(
                    `MCP server started on HTTP (${this.config.stateless ? 'stateless' : 'stateful'})`,
                    {
                        module: 'HTTP',
                        port,
                        host,
                        endpoint: `http://${host}:${String(port)}/mcp`,
                    }
                )
                resolve()
            })
            this.httpServer = server
            server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS
            server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS
            server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS

            server.on('error', (err: Error) => {
                logger.error('HTTP server failed to bind', {
                    module: 'HTTP',
                    error: err.message,
                })
                // Rejecting after start() already resolved is a no-op, so only a bind failure surfaces.
                reject(err)
            })

            server.on('close', () => {
                logger.info('HTTP server closed', { module: 'HTTP' })
            })
        })
    }

    async stop(): Promise<void> {
        logger.info('Shutting down HTTP server...', { module: 'HTTP' })

        if (this.rateLimitCleanupTimer !== null) {
            clearInterval(this.rateLimitCleanupTimer)
            this.rateLimitCleanupTimer = null
        }
        this.stopSessionSweep?.()
        this.stopSessionSweep = null

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
            const server = this.httpServer
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) reject(err)
                    else resolve()
                })
                // Drop lingering keep-alive sockets so close() cannot hang shutdown
                if (typeof server.closeAllConnections === 'function') {
                    server.closeAllConnections()
                }
            })
        }

        logger.info('Shutdown complete', { module: 'HTTP' })
    }
}
