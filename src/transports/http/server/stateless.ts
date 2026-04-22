import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServerFactory } from '../../../server/mcp-server.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import { JSONRPC_SERVER_ERROR } from '../types.js'
import { requestContextStorage } from '../../../utils/request-context.js'

export async function setupStateless(
    app: Express,
    serverFactory: McpServerFactory,
    isAuthExpected: boolean
): Promise<void> {
    const statelessTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    })

    const server = serverFactory()
    await server.connect(statelessTransport)
    logger.info('Stateless transport connected', { module: 'HTTP' })

    // POST /mcp — all requests go to the same transport
    app.post('/mcp', (req: Request, res: Response): void => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined

        // Failsafe: Ensure unauthenticated requests cannot enumerate tools or execute payloads
        // if authentication is globally configured but middleware was somehow bypassed.
        const authReq = req as unknown as { auth?: { sub?: string; subject?: string } }
        if (isAuthExpected && !authReq.auth) {
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: JSONRPC_SERVER_ERROR,
                    message: 'Unauthorized: missing authentication context',
                },
                id: null,
            })
            return
        }

        void requestContextStorage.run({ ip: req.ip, sessionId }, async () => {
            try {
                await statelessTransport.handleRequest(
                    req as IncomingMessage,
                    res as ServerResponse,
                    req.body
                )
            } catch (error) {
                logger.error('Unhandled fault in stateless transport handler', {
                    module: 'HTTP',
                    error: error instanceof Error ? error.message : String(error),
                })
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: JSONRPC_SERVER_ERROR,
                            message: 'Internal server error during stateless transport dispatch',
                        },
                        id: null,
                    })
                }
            }
        })
    })

    // GET /mcp — SSE not available in stateless mode
    app.get('/mcp', (_req: Request, res: Response): void => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: {
                code: JSONRPC_SERVER_ERROR,
                message: 'SSE streaming not available in stateless mode',
            },
            id: null,
        })
    })

    // DELETE /mcp — no-op in stateless mode
    app.delete('/mcp', (_req: Request, res: Response): void => {
        res.status(204).end()
    })
}
