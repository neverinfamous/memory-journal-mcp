import { toNodeHandler, NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import type { Express, Request, Response, NextFunction } from 'express'
import { globalSubscriptionManager } from '../../../server/subscription-manager.js'
import type { McpServerFactory } from '../../../server/mcp-server/index.js'
import { logger } from '../../../utils/logger.js'
import type { HttpTransportConfig } from '../types.js'
import { SESSION_TIMEOUT_MS, SESSION_SWEEP_INTERVAL_MS } from '../types.js'
import { LegacySSEServerTransport } from './legacy-sse.js'

export type SseTransportMap = Map<
    string,
    NodeStreamableHTTPServerTransport | LegacySSEServerTransport
>

const MAX_ACTIVE_SESSIONS = 100

function resolveRequestSubject(req: Request): string | undefined {
    const reqRecord = req as unknown as {
        tokenClaims?: { sub?: string; email?: string; client_id?: string }
        auth?: { sub?: string; subject?: string; clientId?: string; client_id?: string }
    }
    const sub =
        reqRecord.tokenClaims?.sub ??
        reqRecord.tokenClaims?.email ??
        reqRecord.tokenClaims?.client_id ??
        reqRecord.auth?.sub ??
        reqRecord.auth?.subject ??
        reqRecord.auth?.clientId ??
        reqRecord.auth?.client_id
    return typeof sub === 'string' && sub.length > 0 ? sub : undefined
}

export function registerMcpProtocolRoutes(
    app: Express,
    config: HttpTransportConfig,
    serverFactory: McpServerFactory,
    activeServers: Set<McpServer>,
    sseTransports: SseTransportMap
): void {
    const statelessMcpHandler = toNodeHandler(
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

    const sessionOwners = new Map<string, string>()
    const sessionLastActivity = new Map<string, number>()

    const sweepTimer = setInterval(() => {
        const now = Date.now()
        for (const [sid, lastActive] of sessionLastActivity.entries()) {
            if (now - lastActive > SESSION_TIMEOUT_MS) {
                const transport = sseTransports.get(sid)
                if (transport !== undefined) {
                    void transport.close()
                    sseTransports.delete(sid)
                }
                sessionOwners.delete(sid)
                sessionLastActivity.delete(sid)
                globalSubscriptionManager.unregisterServer(sid)
            }
        }
    }, SESSION_SWEEP_INTERVAL_MS)
    sweepTimer.unref()

    const verifySessionOwner = (req: Request, res: Response, sid: string): boolean => {
        const expectedOwner = sessionOwners.get(sid)
        const callerSubject = resolveRequestSubject(req)
        if (expectedOwner !== undefined && expectedOwner !== callerSubject) {
            res.status(403).json({ error: { message: 'Forbidden: Session belongs to another principal' } })
            return false
        }
        sessionLastActivity.set(sid, Date.now())
        return true
    }

    const createSessionAndHandle = (
        req: Request,
        res: Response,
        next: NextFunction,
        _sid?: string,
        isLegacySse = false
    ): void => {
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
        const server = serverFactory()

        const callerSubject = resolveRequestSubject(req)
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
            sseTransports.delete(sessionId)
            sessionOwners.delete(sessionId)
            sessionLastActivity.delete(sessionId)
            globalSubscriptionManager.unregisterServer(sessionId)
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

        server.connect(transport).catch((err: unknown) =>
            logger.error('Error connecting server to transport', {
                error: String(err),
            })
        )

        if (transport instanceof LegacySSEServerTransport) {
            transport.handleSseRequest(req, res)
        } else {
            transport.handleRequest(req, res, req.body).catch((err: unknown) => {
                logger.error('Error handling transport request', {
                    error: String(err),
                    ...(err instanceof Error && err.stack !== undefined
                        ? { stack: err.stack }
                        : {}),
                })
                next(err)
            })
        }
    }

    const handleStatefulGet = (req: Request, res: Response, next: NextFunction): void => {
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

        const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as
            | string
            | undefined

        // codeql[js/user-controlled-bypass] False positive: sessionId selects an existing session vs creating a new session; authentication is enforced upstream
        if (sid !== undefined && sid !== '') {
            const transport = sseTransports.get(sid)
            if (transport === undefined) {
                res.status(400).json({ error: { message: 'Session not found' } })
                return
            }
            if (!verifySessionOwner(req, res, sid)) return
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

    /* codeql[js/missing-rate-limiting] */ app.get('/mcp', handleStatefulGet)
    /* codeql[js/missing-rate-limiting] */ app.get('/sse', handleStatefulGet)

    const handlePost = (req: Request, res: Response, next: NextFunction): void => {
        const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as
            | string
            | undefined

        // codeql[js/user-controlled-bypass] False positive: sessionId selects an existing session vs initializing a new session; authentication is enforced upstream
        if (sid !== undefined && sid !== '') {
            const transport = sseTransports.get(sid)
            if (transport === undefined) {
                res.status(400).json({ error: { message: 'Session not found' } })
                return
            }
            if (!verifySessionOwner(req, res, sid)) return
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
                statelessMcpHandler(req, res, req.body).catch((err: unknown) => {
                    next(err)
                })
            }
        }
    }

    /* codeql[js/missing-rate-limiting] */ app.post('/mcp', handlePost)
    /* codeql[js/missing-rate-limiting] */ app.post('/sse', handlePost)
    /* codeql[js/missing-rate-limiting] */ app.post('/messages', handlePost)

    /* codeql[js/missing-rate-limiting] */ app.delete('/mcp', (req: Request, res: Response) => {
        if (config.stateless) {
            res.status(204).end()
            return
        }

        const sid = (req.query?.['sessionId'] ?? req.headers?.['mcp-session-id']) as
            | string
            | undefined
        if (sid === undefined || sid === '') {
            res.status(400).json({ error: { message: 'Missing sessionId parameter' } })
            return
        }

        const transport = sseTransports.get(sid)
        if (transport !== undefined) {
            if (!verifySessionOwner(req, res, sid)) return
            void transport.close()
            sseTransports.delete(sid)
            sessionOwners.delete(sid)
            sessionLastActivity.delete(sid)
            globalSubscriptionManager.unregisterServer(sid)
        }
        res.status(204).end()
    })
}
