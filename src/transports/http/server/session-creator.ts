import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { getAuthContext } from '../../../auth/auth-context.js'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import { logger } from '../../../utils/logger.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { clearHttpSessionProject } from '../../../utils/workspace-resolver-session.js'
import { LegacySSEServerTransport } from './legacy-sse.js'
import type { McpRouteState } from './protocol-route-handlers.js'

const MAX_ACTIVE_SESSIONS = 100

export type SessionCreator = (
    req: Request,
    res: Response,
    next: NextFunction,
    _sid?: string,
    isLegacySse?: boolean
) => void

/** Close an SSE/streamable transport without awaiting; failures are logged, never thrown. */
export function closeTransportQuietly(
    transport: { close(): Promise<void> },
    failureMessage: string
): void {
    transport.close().catch((error: unknown) => {
        logger.warning(failureMessage, {
            module: 'HTTP',
            error: error instanceof Error ? error.message : String(error),
        })
    })
}

export function resolveRequestSubject(): string | undefined {
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

/** Remove all bookkeeping for a session (transport, owner, activity, subscriptions). */
export function forgetSession(state: McpRouteState, sid: string): void {
    state.sseTransports.delete(sid)
    state.sessionOwners.delete(sid)
    state.sessionLastActivity.delete(sid)
    globalSubscriptionManager.unregisterServer(sid)
    clearHttpSessionProject(sid)
}

function evictOldestIdleSessionIfFull(state: McpRouteState): void {
    const { sseTransports, sessionLastActivity } = state
    if (sseTransports.size < MAX_ACTIVE_SESSIONS) return

    // Evict the oldest idle stateful session (LRU) if past a brief grace window (5s),
    // preventing multi-client test suites from exhausting the cap while still enforcing
    // the hard cap under burst floods.
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

function connectTransportToServer(
    state: McpRouteState,
    sessionId: string,
    transport: NodeStreamableHTTPServerTransport | LegacySSEServerTransport,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { serverFactory, activeServers, sseTransports, sessionOwners, sessionLastActivity } =
        state
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
                    ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
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
}

function handleSessionCreation(
    state: McpRouteState,
    req: Request,
    res: Response,
    next: NextFunction,
    requestedSid?: string,
    isLegacySse = false
): void {
    evictOldestIdleSessionIfFull(state)

    if (state.sseTransports.size >= MAX_ACTIVE_SESSIONS) {
        res.status(503).json({
            error: { message: 'Service Unavailable: Maximum active stateful sessions reached' },
        })
        return
    }

    const sessionId = requestedSid ?? randomUUID()
    const transport = isLegacySse
        ? new LegacySSEServerTransport('/messages', sessionId)
        : new NodeStreamableHTTPServerTransport({
              sessionIdGenerator: () => sessionId,
          })

    const existingCtx = getRequestContext()
    requestContextStorage.run({ ...existingCtx, sessionId }, () => {
        connectTransportToServer(state, sessionId, transport, req, res, next)
    })
}

export function createSessionCreator(state: McpRouteState): SessionCreator {
    return (req, res, next, _sid, isLegacySse = false) =>
        handleSessionCreation(state, req, res, next, _sid, isLegacySse)
}
