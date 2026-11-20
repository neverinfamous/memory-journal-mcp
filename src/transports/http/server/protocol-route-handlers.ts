import { toNodeHandler, type NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import { logger } from '../../../utils/logger.js'
import { isPlaceholderAuthToken } from '../../../utils/security-utils.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import type { HttpTransportConfig } from '../types.js'
import { DEFAULT_MAX_BODY_BYTES, SESSION_TIMEOUT_MS, SESSION_SWEEP_INTERVAL_MS } from '../types.js'
import { LegacySSEServerTransport } from './legacy-sse.js'
import {
    closeTransportQuietly,
    createSessionCreator,
    forgetSession,
    resolveRequestSubject,
    type SessionCreator,
} from './session-creator.js'

export { createSessionCreator, type SessionCreator }

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

export function extractSessionId(req: Request): string | undefined {
    const candidate = req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']
    if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        return trimmed.length > 0 ? trimmed : undefined
    }
    if (Array.isArray(candidate) && typeof candidate[0] === 'string') {
        const trimmed = candidate[0].trim()
        return trimmed.length > 0 ? trimmed : undefined
    }
    return undefined
}

export function assertHttpBindIsSafe(
    host: string,
    authToken: string | undefined,
    corsOrigins: string[] | undefined,
    oauthEnabled: boolean | undefined,
    logWarning: (msg: string) => void,
    logError: (msg: string) => void
): void {
    const normalizedHost = host.trim().toLowerCase()
    const isLocalhost =
        normalizedHost === 'localhost' ||
        normalizedHost === '127.0.0.1' ||
        normalizedHost === '::1' ||
        normalizedHost === '[::1]'
    const hasCorsOpen = corsOrigins?.includes('*') ?? false
    if (authToken !== undefined && authToken !== '' && authToken.trim() === '') {
        const errorMsg = 'FATAL: Authentication token cannot be whitespace-only.'
        logError(errorMsg)
        throw new Error(errorMsg)
    }
    const hasAuth = Boolean(authToken?.trim()) || oauthEnabled === true

    if (!hasAuth && hasCorsOpen) {
        const errorMsg = `FATAL: Refusing to bind HTTP with open wildcard CORS ('*') without explicit authentication. You MUST specify --auth-token (or OAuth) or restrict --cors-origin to specific trusted origins.`
        logError(errorMsg)
        throw new Error(errorMsg)
    }

    if (isPlaceholderAuthToken(authToken)) {
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
                const prevOnClose = server.server.onclose
                server.server.onclose = () => {
                    activeServers.delete(server)
                    prevOnClose?.()
                }
                return server
            },
            { legacy: 'reject' }
        ),
        { maxRequestBodySize: state.config.maxBodySize ?? DEFAULT_MAX_BODY_BYTES }
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
                res.setTimeout(0)
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

function hasUnparsedNonEmptyBody(req: Request): boolean {
    if (req.body !== undefined) return false
    if (req.headers['transfer-encoding'] !== undefined) return true
    const contentLength = req.headers['content-length']
    if (typeof contentLength === 'string' && contentLength.trim() !== '' && contentLength.trim() !== '0') {
        return true
    }
    return false
}

export function createPostHandler(
    state: McpRouteState,
    createSessionAndHandle: SessionCreator,
    verifySessionOwner: (res: Response, sid: string) => boolean,
    statelessMcpHandler: ReturnType<typeof toNodeHandler>
): RouteHandler {
    const { config, sseTransports } = state
    return (req, res, next) => {
        if (hasUnparsedNonEmptyBody(req)) {
            res.status(415).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Unsupported Media Type: Expected application/json request body',
                },
                id: null,
            })
            return
        }
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
