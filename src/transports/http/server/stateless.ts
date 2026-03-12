import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'

export async function setupStateless(app: Express, server: McpServer): Promise<void> {
    const statelessTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    })

    await server.connect(statelessTransport)
    logger.info('Stateless transport connected', { module: 'HTTP' })

    // POST /mcp — all requests go to the same transport
    app.post('/mcp', (req: Request, res: Response): void => {
            void statelessTransport.handleRequest(
                req as unknown as IncomingMessage,
                res as unknown as ServerResponse,
                req.body as unknown,
            )
        })

    // GET /mcp — SSE not available in stateless mode
    app.get('/mcp', (_req: Request, res: Response): void => {
            res.status(405).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
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
