import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServerFactory } from '../../../server/mcp-server.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import type { StatefulContext } from './stateful.js'
import { JSONRPC_SERVER_ERROR } from '../types.js'
import { requestContextStorage } from '../../../utils/request-context.js'

export function setupLegacySSE(ctx: StatefulContext, app: Express, serverFactory: McpServerFactory): void {
    app.get('/sse', (req: Request, res: Response): void => {
        logger.info('Legacy SSE connection requested', { module: 'HTTP' })

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

        // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat for MCP 2024-11-05 clients
        const sseTransport = new SSEServerTransport('/messages', res as ServerResponse)

        // Store transport by session ID after start
        sseTransport.onclose = () => {
            logger.info('Legacy SSE transport closed', {
                module: 'HTTP',
                sessionId: sseTransport.sessionId,
            })
            ctx.sseTransports.delete(sseTransport.sessionId)
        }

        // SEC-2.1: Run legacy SSE connection within request context so rate limiting
        // and audit attribution work under the legacy transport (mirrors Streamable HTTP).
        void requestContextStorage.run({ ip: req.ip }, async () => {
            try {
                const doConnect = async (): Promise<void> => {
                    const newServer = serverFactory()
                    await newServer.connect(sseTransport as Parameters<typeof newServer.connect>[0])
                    ctx.serverConnected = true
                                    }

                const priorLock: Promise<void> = ctx.connectionLock ?? Promise.resolve()
                ctx.connectionLock = priorLock.then(doConnect).catch(doConnect)
                await ctx.connectionLock

                ctx.sseTransports.set(sseTransport.sessionId, sseTransport)
                ctx.touchSession(sseTransport.sessionId)
                logger.info('Legacy SSE connection established', {
                    module: 'HTTP',
                    sessionId: sseTransport.sessionId,
                })
            } catch (error) {
                logger.error('Error starting SSE transport', {
                    module: 'HTTP',
                    error: error instanceof Error ? error.message : String(error),
                })
                if (!res.headersSent) {
                    res.status(500).end()
                }
            }
        })

        // Clean up when client disconnects
        req.on('close', () => {
            ctx.sseTransports.delete(sseTransport.sessionId)
            ctx.sessionLastActivity.delete(sseTransport.sessionId)
        })
    })

    // POST /messages?sessionId=<id> — Route messages to Legacy SSE transport
    app.post('/messages', (req: Request, res: Response): void => {
        const sessionId =
            typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined

        if (sessionId === undefined) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: JSONRPC_SERVER_ERROR, message: 'Missing sessionId parameter' },
                id: null,
            })
            return
        }

        const transport = ctx.sseTransports.get(sessionId)
        if (transport === undefined) {
            res.status(404).json({
                jsonrpc: '2.0',
                error: { code: JSONRPC_SERVER_ERROR, message: 'Session not found' },
                id: null,
            })
            return
        }

        // Refresh session activity on message receipt
        ctx.touchSession(sessionId)

        // SEC-2.1: Thread request context into the message dispatch so per-request
        // attributes (IP, sessionId) are visible to rate limiters and audit loggers.
        void requestContextStorage.run({ ip: req.ip, sessionId }, async () => {
            try {
                await transport.handlePostMessage(req as IncomingMessage, res as ServerResponse, req.body)
            } catch (error) {
                logger.error('Unhandled fault in legacy SSE message handler', {
                    module: 'HTTP',
                    error: error instanceof Error ? error.message : String(error),
                })
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: JSONRPC_SERVER_ERROR, message: 'Internal server error during legacy SSE dispatch' },
                        id: null,
                    })
                }
            }
        })
    })
}
