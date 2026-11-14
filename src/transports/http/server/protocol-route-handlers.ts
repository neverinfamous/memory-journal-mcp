import { toNodeHandler, NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { getAuthContext } from '../../../auth/auth-context.js'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import { logger } from '../../../utils/logger.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { clearHttpSessionProject } from '../../../utils/workspace-resolver-session.js'
import type { HttpTransportConfig } from '../types.js'
import { SESSION_TIMEOUT_MS, SESSION_SWEEP_INTERVAL_MS } from '../types.js'
import { LegacySSEServerTransport } from './legacy-sse.js'

export type SseTransportMap = Map<
    string,
    NodeStreamableHTTPServerTransport | LegacySSEServerTransport
>

type RouteHandler = (req: Request, res: Response, next: NextFunction) => void

/** Shared mutable state used by every MCP protocol route handler. */
export interface McpRouteState {
    config: HttpTransportConfig
    serverFactory: McpServerFactory
    activeServers: Set<McpServer>
    sseTransports: SseTransportMap
    sessionOwners: Map<string, string>
    sessionLastActivity: Map<string, number>
}

const MAX_ACTIVE_SESSIONS = 100

/** Close an SSE/streamable transport without awaiting; failures are logged, never thrown. */
function closeTransportQuietly(transport: { close(): Promise<void> }, failureMessage: string): void {
    transport.close().catch((error: unknown) => {
        logger.warning(failureMessage, {
            module: 'HTTP',
            error: error instanceof Error ? error.message : String(error),
        })
    })
}

function resolveRequestSubject(): string | undefined {
    const claims = getAuthContext()?.claims as
        | { sub?: string; email?: string; client_id?: string; subject?: string; clientId?: string }
        | undefined
    const sub =
        claims?.sub ??
        claims?.email ??
        claims?.client_id ??
        claims?.subject ??
        claims?.clientId
    return typeof sub === 'string' && sub.length > 0 ? sub : undefined
}

export function extractSessionId(req: Request): string | undefined {
    return (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as string | undefined
}

export function assertHttpBindIsSafe(
    host: string,
    authToken: string | undefined,
    corsOrigins: string[] | undefined,
    oauthEnabled: boolean | undefined,
    logWarning: (msg: string) => void,
    logError: (msg: string) => void
): void {
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    const hasCorsOpen = corsOrigins?.includes('*') ?? false
    const hasAuth = Boolean(authToken) || oauthEnabled === true

    if (!hasAuth && hasCorsOpen) {
        const errorMsg = `FATAL: Refusing to bind HTTP with open wildcard CORS ('*') without explicit authentication. You MUST specify --auth-token (or OAuth) or restrict --cors-origin to specific trusted origins.`
        logError(errorMsg)
        throw new Error(errorMsg)
    }

    if (authToken === 'change_this_to_a_secure_token_for_production') {
        const errorMsg = `FATAL: Default auth token detected. You MUST change MCP_AUTH_TOKEN to a secure, cryptographically random value for production.`
        logError(errorMsg)
        throw new Error(errorMsg)
    }

    if (!isLocalhost && !hasAuth) {
        const errorMsg = `FATAL: Refusing to bind public HTTP on '${host}' without explicit authentication. You MUST specify --auth-token (or OAuth).`
        logError(errorMsg)
        throw new Error(errorMsg)
    }

    if (hasCorsOpen) {
        logWarning(
            'CORS origin is set to "*" (all origins). ' +
                'Set --cors-origin or MCP_CORS_ORIGIN for production deployments.'
        )
    }

    if (!hasAuth) {
        logWarning(
            'No authentication configured for HTTP transport. ' +
                'Set --auth-token or MCP_AUTH_TOKEN for production deployments.'
        )
    }
}

/** Remove all bookkeeping for a session (transport, owner, activity, subscriptions). */
function forgetSession(state: McpRouteState, sid: string): void {
    state.sseTransports.delete(sid)
    state.sessionOwners.delete(sid)
    state.sessionLastActivity.delete(sid)
    globalSubscriptionManager.unregisterServer(sid)
    clearHttpSessionProject(sid)
}

export function createStatelessHandler(
    state: McpRouteState
): ReturnType<typeof toNodeHandler> {
    const { serverFactory, activeServers } = state
    return toNodeHandler(
        createMcpHandler(
            () => {
                const server = serverFactory()
                activeServers.add(server)
                const originalClose = server.close.bind(server)
                server.close = async () => {
                    activeServers.delete(server)
                    return originalClose()
                }
                return server
            },
            { legacy: 'reject' }
        )
    )
}

/** Starts the idle-session sweeper; returns the (unref'd) timer. */
export function startSessionSweeper(state: McpRouteState): NodeJS.Timeout {
    const sweepTimer = setInterval(() => {
        const now = Date.now()
        for (const [sid, lastActive] of state.sessionLastActivity.entries()) {
            if (now - lastActive > SESSION_TIMEOUT_MS) {
                const transport = state.sseTransports.get(sid)
                if (transport !== undefined) {
                    closeTransportQuietly(transport, 'Failed to close idle SSE transport')
                }
                forgetSession(state, sid)
            }
        }
    }, SESSION_SWEEP_INTERVAL_MS)
    sweepTimer.unref()
    return sweepTimer
}

export function createSessionOwnerVerifier(
    state: McpRouteState
): (res: Response, sid: string) => boolean {
    return (res, sid) => {
        const expectedOwner = state.sessionOwners.get(sid)
        const callerSubject = resolveRequestSubject()
        if (expectedOwner !== undefined && expectedOwner !== callerSubject) {
            res.status(403).json({ error: { message: 'Forbidden: Session belongs to another principal' } })
            return false
        }
        state.sessionLastActivity.set(sid, Date.now())
        return true
    }
}

export type SessionCreator = (
    req: Request,
    res: Response,
    next: NextFunction,
    _sid?: string,
    isLegacySse?: boolean
) => void

export function createSessionCreator(state: McpRouteState): SessionCreator {
    const { serverFactory, activeServers, sseTransports, sessionOwners, sessionLastActivity } =
        state
    return (req, res, next, _sid, isLegacySse = false) => {
        if (sseTransports.size >= MAX_ACTIVE_SESSIONS) {
            // Evict the oldest idle stateful session (LRU) if there are idle sessions
            // past a brief grace window (5s), preventing multi-client test suites from
            // exhausting the cap while still enforcing the hard cap under burst floods.
            let oldestSid: string | undefined
            let oldestTime = Infinity
            for (const [candidateSid, lastActive] of sessionLastActivity.entries()) {
                if (lastActive < oldestTime) {
                    oldestTime = lastActive
                    oldestSid = candidateSid
                }
            }
            if (oldestSid !== undefined && Date.now() - oldestTime > 5_000) {
                const staleTransport = sseTransports.get(oldestSid)
                if (staleTransport !== undefined) {
                    closeTransportQuietly(staleTransport, 'Failed to close evicted SSE transport')
                }
                forgetSession(state, oldestSid)
            }
        }

        if (sseTransports.size >= MAX_ACTIVE_SESSIONS) {
            res.status(503).json({
                error: { message: 'Service Unavailable: Maximum active stateful sessions reached' },
            })
            return
        }

        const sid = _sid ?? randomUUID()
        const transport = isLegacySse
            ? new LegacySSEServerTransport('/messages', sid)
            : new NodeStreamableHTTPServerTransport({
                  sessionIdGenerator: () => sid,
              })

        const sessionId = sid
        const existingCtx = getRequestContext()
        requestContextStorage.run({ ...existingCtx, sessionId }, () => {
            const server = serverFactory()

            const callerSubject = resolveRequestSubject()
            if (callerSubject !== undefined) {
                sessionOwners.set(sessionId, callerSubject)
            }
            sessionLastActivity.set(sessionId, Date.now())

            const authLog = callerSubject !== undefined ? ` as ${callerSubject}` : ''
            logger.info(`New MCP stateful session initialized${authLog}`, {
                module: 'HTTP',
                sessionId,
                ...(callerSubject !== undefined ? { subject: callerSubject } : {}),
            })

            activeServers.add(server)
            globalSubscriptionManager.registerServer(sessionId, server)

            const originalClose = server.close.bind(server)
            server.close = async () => {
                activeServers.delete(server)
                forgetSession(state, sessionId)
                return originalClose()
            }

            sseTransports.set(sessionId, transport)

            transport.onclose = () => {
                server.close().catch((err: unknown) =>
                    logger.error('Error closing server on transport close', {
                        error: String(err),
                    })
                )
            }

            // [INVARIANT] The server must be connected before the transport handles the first request.
            server
                .connect(transport)
                .then(() => {
                    if (transport instanceof LegacySSEServerTransport) {
                        transport.handleSseRequest(req, res)
                        return
                    }
                    transport.handleRequest(req, res, req.body).catch((err: unknown) => {
                        logger.error('Error handling transport request', {
                            error: String(err),
                            ...(err instanceof Error && err.stack !== undefined
                                ? { stack: err.stack }
                                : {}),
                        })
                        next(err)
                    })
                })
                .catch((err: unknown) => {
                    logger.error('Error connecting server to transport', {
                        error: String(err),
                    })
                    activeServers.delete(server)
                    sseTransports.delete(sessionId)
                    forgetSession(state, sessionId)
                    if (!res.headersSent) {
                        res.status(500).json({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Failed to initialize session' },
                            id: null,
                        })
                    }
                })
        })
    }
}

export function createStatefulGetHandler(
    state: McpRouteState,
    createSessionAndHandle: SessionCreator,
    verifySessionOwner: (res: Response, sid: string) => boolean
): RouteHandler {
    const { config, sseTransports } = state
    return (req, res, next) => {
        if (config.stateless) {
            if (req.path === '/sse' || req.path === '/sse/') {
                next()
                return
            }
            res.status(405).json({
                error: { message: 'SSE streaming not available in stateless mode' },
            })
            return
        }

        const sid = extractSessionId(req)

        // The session id selects an existing session. It does not skip authentication:
        // http-transport.ts already applied auth middleware, and verifySessionOwner runs
        // before that session is used. Omitting the id never opens another principal's session.
        /* codeql[js/user-controlled-bypass] */
        if (sid !== undefined && sid !== '') {
            const transport = sseTransports.get(sid)
            if (transport === undefined) {
                res.status(400).json({ error: { message: 'Session not found' } })
                return
            }
            if (!verifySessionOwner(res, sid)) return
            if (transport instanceof LegacySSEServerTransport) {
                transport.handleSseRequest(req, res)
            } else {
                transport.handleRequest(req, res).catch((err: unknown) => {
                    next(err)
                })
            }
        } else {
            if (req.path === '/sse' || req.path === '/sse/') {
                createSessionAndHandle(req, res, next, randomUUID(), true)
                return
            }
            res.status(405).json({
                error: 'Method Not Allowed (Streamable HTTP requires POST initialization)',
            })
            return
        }
    }
}

export function createPostHandler(
    state: McpRouteState,
    createSessionAndHandle: SessionCreator,
    verifySessionOwner: (res: Response, sid: string) => boolean,
    statelessMcpHandler: ReturnType<typeof toNodeHandler>
): RouteHandler {
    const { config, sseTransports } = state
    return (req, res, next) => {
        const sid = extractSessionId(req)

        /* codeql[js/user-controlled-bypass] */
        if (sid !== undefined && sid !== '') {
            const transport = sseTransports.get(sid)
            if (transport === undefined) {
                res.status(400).json({ error: { message: 'Session not found' } })
                return
            }
            if (!verifySessionOwner(res, sid)) return
            if (transport instanceof LegacySSEServerTransport) {
                transport.handlePostMessage(req, res)
            } else {
                transport.handleRequest(req, res, req.body).catch((err: unknown) => {
                    next(err)
                })
            }
        } else {
            const acceptsSse = req.headers.accept?.includes('text/event-stream') ?? false
            const isLegacyMessages = req.path === '/messages' || req.path === '/messages/'

            if (isLegacyMessages) {
                res.status(400).json({ error: { message: 'Missing sessionId parameter' } })
            } else if (acceptsSse && !config.stateless) {
                createSessionAndHandle(req, res, next, randomUUID(), false)
            } else {
                logger.debug('Routing to statelessMcpHandler', {
                    method: req.method,
                    path: req.path,
                })
                const currentCtx = { ...(getRequestContext() ?? {}) }
                delete currentCtx.sessionId
                requestContextStorage.run({ ...currentCtx, ephemeralSessionProject: {} }, () => {
                    statelessMcpHandler(req, res, req.body).catch((err: unknown) => {
                        next(err)
                    })
                })
            }
        }
    }
}

export function createDeleteHandler(
    state: McpRouteState,
    verifySessionOwner: (res: Response, sid: string) => boolean
): (req: Request, res: Response) => void {
    const { config, sseTransports } = state
    return (req, res) => {
        if (config.stateless) {
            res.status(204).end()
            return
        }

        const sid = extractSessionId(req)
        if (sid === undefined || sid === '') {
            res.status(400).json({ error: { message: 'Missing sessionId parameter' } })
            return
        }

        const transport = sseTransports.get(sid)
        if (transport !== undefined) {
            if (!verifySessionOwner(res, sid)) return
            closeTransportQuietly(transport, 'Failed to close SSE transport on DELETE')
            forgetSession(state, sid)
        }
        res.status(204).end()
    }
}
