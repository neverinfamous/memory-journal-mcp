import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'node:crypto'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import { SESSION_TIMEOUT_MS, SESSION_SWEEP_INTERVAL_MS } from '../types.js'
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

export interface StatefulContext {
    transports: Map<string, StreamableHTTPServerTransport>
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat
    sseTransports: Map<string, SSEServerTransport>
    sessionLastActivity: Map<string, number>
    touchSession: (sid: string) => void
}

export function setupStateful(ctx: StatefulContext, app: Express, server: McpServer): ReturnType<typeof setInterval> {
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
                    ctx.sessionLastActivity.delete(sid)
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
                    ctx.sessionLastActivity.delete(sid)
                }
            }
        }, SESSION_SWEEP_INTERVAL_MS)

        // POST /mcp — Handle JSON-RPC requests
        app.post('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            void (async () => {
                try {
                    let httpTransport: StreamableHTTPServerTransport | undefined

                    if (sessionId !== undefined && ctx.transports.has(sessionId)) {
                        // Cross-protocol guard: reject SSE session IDs on /mcp
                        if (ctx.sseTransports.has(sessionId)) {
                            res.status(400).json({
                                jsonrpc: '2.0',
                                error: {
                                    code: -32000,
                                    message:
                                        'Bad Request: Session uses Legacy SSE transport, not Streamable HTTP',
                                },
                                id: null,
                            })
                            return
                        }

                        // Reuse existing transport and refresh session activity
                        ctx.touchSession(sessionId)
                        httpTransport = ctx.transports.get(sessionId)
                    } else if (sessionId === undefined && isInitializeRequest(req.body)) {
                        // New initialization request — create transport
                        const newTransport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: () => randomUUID(),
                            onsessioninitialized: (sid: string) => {
                                logger.info('HTTP session initialized', {
                                    module: 'HTTP',
                                    sessionId: sid,
                                })
                                ctx.transports.set(sid, newTransport)
                                ctx.touchSession(sid)
                            },
                        })

                        // Clean up on transport close
                        newTransport.onclose = () => {
                            const sid = newTransport.sessionId
                            if (sid !== undefined && ctx.transports.has(sid)) {
                                logger.info('HTTP transport closed', {
                                    module: 'HTTP',
                                    sessionId: sid,
                                })
                                ctx.transports.delete(sid)
                                ctx.sessionLastActivity.delete(sid)
                            }
                        }

                        // Connect transport to server
                        // SDK McpServer only supports one active transport — close first
                        try {
                            await server.connect(newTransport)
                        } catch {
                            await server.close()
                            await server.connect(newTransport)
                        }
                        await newTransport.handleRequest(
                            req as IncomingMessage,
                            res as ServerResponse,
                            req.body,
                        )
                        return
                    } else {
                        // Invalid request — no session ID or not initialization
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: 'Bad Request: No valid session ID provided',
                            },
                            id: null,
                        })
                        return
                    }

                    // Handle request with existing transport
                    if (httpTransport !== undefined) {
                        await httpTransport.handleRequest(
                            req as IncomingMessage,
                            res as ServerResponse,
                            req.body,
                        )
                    }
                } catch (error) {
                    logger.error('Error handling MCP request', {
                        module: 'HTTP',
                        error: error instanceof Error ? error.message : String(error),
                    })
                    if (!res.headersSent) {
                        res.status(500).json({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal server error' },
                            id: null,
                        })
                    }
                }
            })()
        })

        // GET /mcp — SSE stream for server-to-client notifications
        app.get('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !ctx.transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
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
                void httpTransport.handleRequest(
                    req as IncomingMessage,
                    res as ServerResponse,
                )
            }
        })

        // DELETE /mcp — Session termination
        app.delete('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !ctx.transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
            }

            logger.info('Session termination requested', {
                module: 'HTTP',
                sessionId,
            })

            const httpTransport = ctx.transports.get(sessionId)
            if (httpTransport !== undefined) {
                void httpTransport.handleRequest(
                    req as IncomingMessage,
                    res as ServerResponse,
                )
            }
        })
    return sessionSweepTimer;
}

