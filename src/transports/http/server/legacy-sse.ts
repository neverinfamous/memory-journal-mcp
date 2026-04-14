import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServerFactory } from '../../../server/mcp-server.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import type { StatefulContext } from './stateful.js'
import { JSONRPC_SERVER_ERROR } from '../types.js'

export function setupLegacySSE(ctx: StatefulContext, app: Express, serverFactory: McpServerFactory): void {
    app.get('/sse', (req: Request, res: Response): void => {
        logger.info('Legacy SSE connection requested', { module: 'HTTP' })

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

        void (async () => {
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
        })()

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

        void transport.handlePostMessage(req as IncomingMessage, res as ServerResponse, req.body)
    })
}
