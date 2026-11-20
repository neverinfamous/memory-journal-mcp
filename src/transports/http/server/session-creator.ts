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
const MAX_SESSIONS_PER_PRINCIPAL = 20

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

function nonEmptyClaim(val: unknown): string | undefined {
    if (typeof val !== 'string') return undefined
    const trimmed = val.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

export function resolveRequestSubject(): string | undefined {
    const auth = getAuthContext()
    if (auth?.authenticated === false) return undefined
    const claims = auth?.claims as
        | {
              sub?: string
              email?: string
              email_verified?: boolean
              client_id?: string
              subject?: string
              clientId?: string
          }
        | undefined
    const verifiedEmail =
        claims?.email_verified === true ? nonEmptyClaim(claims.email) : undefined
    return (
        nonEmptyClaim(claims?.sub) ??
        verifiedEmail ??
        nonEmptyClaim(claims?.client_id) ??
        nonEmptyClaim(claims?.subject) ??
        nonEmptyClaim(claims?.clientId)
    )
}

/** Remove all bookkeeping for a session (transport, owner, activity, subscriptions). */
export function forgetSession(state: McpRouteState, sid: string): void {
    state.sseTransports.delete(sid)
    state.sessionOwners.delete(sid)
    state.sessionLastActivity.delete(sid)
    globalSubscriptionManager.unregisterServer(sid)
    clearHttpSessionProject(sid)
}

function countPrincipalSessions(
    state: McpRouteState,
    subject: string
): { count: number; oldestSid: string | undefined; oldestTime: number } {
    let count = 0
    let oldestSid: string | undefined
    let oldestTime = Infinity
    for (const [sid, owner] of state.sessionOwners.entries()) {
        if (owner !== subject || !state.sseTransports.has(sid)) continue
        count++
        const lastActive = state.sessionLastActivity.get(sid) ?? 0
        if (lastActive < oldestTime) {
            oldestTime = lastActive
            oldestSid = sid
        }
    }
    return { count, oldestSid, oldestTime }
}

function evictSessionIfIdle(
    state: McpRouteState,
    sid: string | undefined,
    lastActive: number
): void {
    if (sid === undefined || Date.now() - lastActive <= 5_000) return
    const staleTransport = state.sseTransports.get(sid)
    if (staleTransport !== undefined) {
        closeTransportQuietly(staleTransport, 'Failed to close evicted SSE transport')
    }
    forgetSession(state, sid)
}

function evictOldestIdleSessionIfFull(
    state: McpRouteState,
    callerSubject: string | undefined
): void {
    const { sseTransports, sessionOwners, sessionLastActivity } = state
    if (callerSubject !== undefined) {
        const principal = countPrincipalSessions(state, callerSubject)
        if (
            principal.count >= MAX_SESSIONS_PER_PRINCIPAL ||
            sseTransports.size >= MAX_ACTIVE_SESSIONS
        ) {
            evictSessionIfIdle(state, principal.oldestSid, principal.oldestTime)
        }
        return
    }
    if (sseTransports.size < MAX_ACTIVE_SESSIONS) return

    // Evict the oldest idle unowned session (LRU) past 5s without crossing into owned tenant sessions.
    let oldestSid: string | undefined
    let oldestTime = Infinity
    for (const [candidateSid, lastActive] of sessionLastActivity.entries()) {
        if (sessionOwners.has(candidateSid) || !sseTransports.has(candidateSid)) continue
        if (lastActive < oldestTime) {
            oldestTime = lastActive
            oldestSid = candidateSid
        }
    }
    evictSessionIfIdle(state, oldestSid, oldestTime)
}

function connectTransportToServer(
    state: McpRouteState,
    sessionId: string,
    transport: NodeStreamableHTTPServerTransport | LegacySSEServerTransport,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { serverFactory, activeServers, sseTransports, sessionOwners, sessionLastActivity } = state
    const server = serverFactory()
    const callerSubject = resolveRequestSubject()
    if (callerSubject !== undefined) sessionOwners.set(sessionId, callerSubject)
    sessionLastActivity.set(sessionId, Date.now())

    logger.info(`New MCP stateful session initialized${callerSubject !== undefined ? ` as ${callerSubject}` : ''}`, {
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
            logger.error('Error closing server on transport close', { error: String(err) })
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
            transport
                .handleRequest(req, res, req.body)
                .then(() => {
                    if (transport.sessionId === undefined) void server.close()
                })
                .catch((err: unknown) => {
                    if (transport.sessionId === undefined) void server.close()
                    logger.error('Error handling transport request', {
                        error: String(err),
                        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
                    })
                    next(err)
                })
        })
        .catch((err: unknown) => {
            logger.error('Error connecting server to transport', { error: String(err) })
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
    const callerSubject = resolveRequestSubject()
    evictOldestIdleSessionIfFull(state, callerSubject)

    if (
        callerSubject !== undefined &&
        countPrincipalSessions(state, callerSubject).count >= MAX_SESSIONS_PER_PRINCIPAL
    ) {
        res.status(429).json({
            error: {
                message: 'Too Many Requests: Maximum active stateful sessions per principal reached',
            },
        })
        return
    }

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
