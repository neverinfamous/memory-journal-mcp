import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerFactory } from '../../../server/mcp-server.js'
import { randomUUID } from 'node:crypto'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import {
    SESSION_TIMEOUT_MS,
    SESSION_SWEEP_INTERVAL_MS,
    JSONRPC_SERVER_ERROR,
    JSONRPC_INTERNAL_ERROR,
} from '../types.js'
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { requestContextStorage } from '../../../utils/request-context.js'

export interface StatefulContext {
    transports: Map<string, StreamableHTTPServerTransport>
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat
    sseTransports: Map<string, SSEServerTransport>
    sessionLastActivity: Map<string, number>
    sessionSubjects: Map<string, string>
    touchSession: (sid: string) => void
    /** Tracks whether server.connect() has been called (close-before-reconnect pattern) */
    serverConnected: boolean
    /** Serialize concurrent transport connections to the singleton server */
    connectionLock?: Promise<void>
    sessionCreatedAt?: Map<string, number>
}

export function setupStateful(
    ctx: StatefulContext,
    app: Express,
    serverFactory: McpServerFactory
): ReturnType<typeof setInterval> {
    const sessionSweepTimer = setInterval(() => {
        const now = Date.now()
        for (const [sid, lastActivity] of ctx.sessionLastActivity) {
            const idleMs = now - lastActivity
            if (idleMs <= SESSION_TIMEOUT_MS) continue

            // Expire idle Streamable HTTP sessions
            if (ctx.transports.has(sid)) {
                logger.info('Expiring idle HTTP session', {
                    module: 'HTTP',
                    sessionId: sid,
                    idleMinutes: Math.round(idleMs / 60_000),
                })
                const t = ctx.transports.get(sid)
                if (t) {
                    void t.close()
                }
                ctx.transports.delete(sid)
                ctx.sessionSubjects.delete(sid)
                ctx.sessionLastActivity.delete(sid)
                if (ctx.sessionCreatedAt) ctx.sessionCreatedAt.delete(sid)
            }

            // Expire idle Legacy SSE sessions
            if (ctx.sseTransports.has(sid)) {
                logger.info('Expiring idle SSE session', {
                    module: 'HTTP',
                    sessionId: sid,
                    idleMinutes: Math.round(idleMs / 60_000),
                })
                const t = ctx.sseTransports.get(sid)
                if (t) {
                    void t.close()
                }
                ctx.sseTransports.delete(sid)
                ctx.sessionSubjects.delete(sid)
                ctx.sessionLastActivity.delete(sid)
                if (ctx.sessionCreatedAt) ctx.sessionCreatedAt.delete(sid)
            }
        }
    }, SESSION_SWEEP_INTERVAL_MS)
    sessionSweepTimer.unref()

    // Transports are instantiated dynamically upon receiving an initialize request
    // to support sequential test resets and client reconnections.

    // POST /mcp — Handle JSON-RPC requests
    app.post('/mcp', (req: Request, res: Response): void => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined

        void (async () => {
            try {
                if (sessionId !== undefined) {
                    // Cross-protocol guard: reject SSE session IDs on /mcp
                    if (ctx.sseTransports.has(sessionId)) {
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: JSONRPC_SERVER_ERROR,
                                message:
                                    'Bad Request: Session uses Legacy SSE transport, not Streamable HTTP',
                            },
                            id: null,
                        })
                        return
                    }

                    if (!ctx.transports.has(sessionId)) {
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: { code: JSONRPC_SERVER_ERROR, message: 'Session not found' },
                            id: null,
                        })
                        return
                    }

                    const authReq = req as unknown as { auth?: { sub?: string; subject?: string } }
                    const reqSubject = authReq.auth?.sub ?? authReq.auth?.subject
                    const expectedSub = ctx.sessionSubjects.get(sessionId)
                    if (reqSubject !== expectedSub) {
                        res.status(403).json({
                            jsonrpc: '2.0',
                            error: { code: JSONRPC_SERVER_ERROR, message: 'Forbidden: Session belongs to a different subject' },
                            id: null,
                        })
                        return
                    }
                    
                    if (ctx.sessionCreatedAt) {
                        const createdAt = ctx.sessionCreatedAt.get(sessionId) ?? Date.now()
                        // 24 hour absolute TTL
                        if (Date.now() - createdAt > 86400000) {
                            res.status(401).json({
                                jsonrpc: '2.0',
                                error: { code: JSONRPC_SERVER_ERROR, message: 'Unauthorized: Session absolute TTL expired' },
                                id: null,
                            })
                            return
                        }
                    }

                    ctx.touchSession(sessionId)
                } else if (!isInitializeRequest(req.body)) {
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: JSONRPC_SERVER_ERROR,
                            message: 'Bad Request: No valid session ID provided',
                        },
                        id: null,
                    })
                    return
                }

                let targetTransport: StreamableHTTPServerTransport

                if (sessionId !== undefined) {
                    const t = ctx.transports.get(sessionId)
                    if (!t) {
                        logger.error('Missing transport for active session', { module: 'HTTP', sessionId })
                        throw new Error('Critical: session ID exists but transport was lost')
                    }
                    targetTransport = t
                } else {
                    // This MUST be an initialize request due to the guard above.
                    // Enforce session limit to prevent unbounded memory growth
                    const envMax = process.env['MAX_STATEFUL_SESSIONS']
                    let maxSessions = 1000
                    if (envMax) {
                        const parsed = parseInt(envMax, 10)
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            maxSessions = parsed
                        }
                    }
                    
                    if (ctx.transports.size + ctx.sseTransports.size >= maxSessions) {
                        res.status(429).json({
                            jsonrpc: '2.0',
                            error: { code: JSONRPC_SERVER_ERROR, message: 'Too Many Requests: Maximum active sessions reached' },
                            id: null,
                        })
                        return
                    }

                    // Instantiate a fresh transport for the new session lifecycle.
                    const newTransport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid: string) => {
                            logger.info('HTTP session initialized', {
                                module: 'HTTP',
                                sessionId: sid,
                            })
                            ctx.transports.set(sid, newTransport)
                            ctx.touchSession(sid)

                            const authReq = req as unknown as { auth?: { sub?: string; subject?: string } }
                            const reqSubject = authReq.auth?.sub ?? authReq.auth?.subject
                            if (reqSubject) {
                                ctx.sessionSubjects.set(sid, reqSubject)
                            }
                            if (ctx.sessionCreatedAt) {
                                ctx.sessionCreatedAt.set(sid, Date.now())
                            }

                            // Attach close handler specifically for this session ID, preserving any existing handlers
                            // (e.g., from server.connect wrapper).
                            const existingOnClose = newTransport.onclose
                            newTransport.onclose = () => {
                                logger.info('HTTP transport closed', {
                                    module: 'HTTP',
                                    sessionId: sid,
                                })
                                ctx.transports.delete(sid)
                                ctx.sessionSubjects.delete(sid)
                                if (ctx.sessionCreatedAt) ctx.sessionCreatedAt.delete(sid)
                                if (existingOnClose) existingOnClose()
                            }
                        },
                    })

                    // Attach the new transport to the server, supporting concurrent clients.
                    const doConnect = async (): Promise<void> => {
                        const newServer = serverFactory()
                        await newServer.connect(newTransport)
                        ctx.serverConnected = true
                    }
                    
                    const priorLock: Promise<void> = ctx.connectionLock ?? Promise.resolve()
                    
                    // Chain the attempt
                    const attempt = priorLock.then(doConnect)
                    
                    // The global lock chain swallows errors to allow subsequent requests to proceed
                    ctx.connectionLock = attempt.catch((err: unknown) => {
                        logger.error('Background connection setup failed, releasing lock', { 
                            module: 'HTTP', 
                            error: err instanceof Error ? err.message : String(err) 
                        })
                    })
                    
                    // Block the current request on the attempt success
                    await attempt
                    
                    targetTransport = newTransport
                }

                await requestContextStorage.run({ ip: req.ip, sessionId }, async () => {
                    await targetTransport.handleRequest(
                        req as IncomingMessage,
                        res as ServerResponse,
                        req.body
                    )
                })
            } catch (error) {
                logger.error('Error handling MCP request', {
                    module: 'HTTP',
                    error: error instanceof Error ? error.message : String(error),
                })
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: JSONRPC_INTERNAL_ERROR, message: 'Internal server error' },
                        id: null,
                    })
                }
            }
        })().catch((error: unknown) => {
            logger.error('Unhandled async error in POST /mcp IIFE', {
                module: 'HTTP',
                error: error instanceof Error ? error.message : String(error),
            })
        })
    })

    // GET /mcp — SSE stream for server-to-client notifications
    app.get('/mcp', (req: Request, res: Response): void => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined

        if (sessionId === undefined || !ctx.transports.has(sessionId)) {
            res.status(400).send('Invalid or missing session ID')
            return
        }

        const authReq = req as unknown as { auth?: { sub?: string; subject?: string } }
        const reqSubject = authReq.auth?.sub ?? authReq.auth?.subject
        const expectedSub = ctx.sessionSubjects.get(sessionId)
        if (reqSubject !== expectedSub) {
            res.status(403).send('Forbidden: Session belongs to a different subject')
            return
        }
        
        if (ctx.sessionCreatedAt) {
            const createdAt = ctx.sessionCreatedAt.get(sessionId) ?? Date.now()
            // 24 hour absolute TTL
            if (Date.now() - createdAt > 86400000) {
                res.status(401).send('Unauthorized: Session absolute TTL expired')
                return
            }
        }

        // Refresh session activity on SSE reconnect
        ctx.touchSession(sessionId)

        const lastEventId = req.headers['last-event-id']
        if (lastEventId !== undefined) {
            logger.debug('Client reconnecting with Last-Event-ID', {
                module: 'HTTP',
                sessionId,
                lastEventId,
            })
        }

        const httpTransport = ctx.transports.get(sessionId)
        if (httpTransport !== undefined) {
            void httpTransport.handleRequest(req as IncomingMessage, res as ServerResponse)
        }
    })

    // DELETE /mcp — Session termination
    app.delete('/mcp', (req: Request, res: Response): void => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined

        if (sessionId === undefined || !ctx.transports.has(sessionId)) {
            res.status(400).send('Invalid or missing session ID')
            return
        }

        const authReq = req as unknown as { auth?: { sub?: string; subject?: string } }
        const reqSubject = authReq.auth?.sub ?? authReq.auth?.subject
        const expectedSub = ctx.sessionSubjects.get(sessionId)
        if (reqSubject !== expectedSub) {
            res.status(403).send('Forbidden: Session belongs to a different subject')
            return
        }

        logger.info('Session termination requested', {
            module: 'HTTP',
            sessionId,
        })

        const httpTransport = ctx.transports.get(sessionId)
        if (httpTransport !== undefined) {
            void httpTransport.handleRequest(req as IncomingMessage, res as ServerResponse)
        }
    })
    return sessionSweepTimer
}
