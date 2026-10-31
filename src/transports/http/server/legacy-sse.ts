import type { Transport, JSONRPCMessage } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { logger } from '../../../utils/logger.js'

/**
 * A custom Server Transport that implements the Legacy SSE (MCP 2024-11-05) protocol.
 * This is required because the official @modelcontextprotocol/server v2 package
 * removed stateful SSEServerTransport in favor of Streamable HTTP (MCP 2025-03-26).
 * This transport allows older clients (like SSEClientTransport) to connect using
 * `GET /sse` followed by `POST /messages`.
 */
export class LegacySSEServerTransport implements Transport {
    private res: Response | null = null
    public sessionId: string
    public onclose?: () => void
    public onerror?: (error: Error) => void
    public onmessage?: (message: JSONRPCMessage) => void

    constructor(private messagesEndpoint: string, sessionId?: string) {
        this.sessionId = sessionId ?? randomUUID()
    }

    async start(): Promise<void> {
        // No-op for Legacy SSE.
        // The transport is "started" implicitly when connected.
    }

    close(): Promise<void> {
        if (this.res) {
            this.res.end()
            this.res = null
        }
        const onclose = this.onclose
        this.onclose = undefined
        onclose?.()
        return Promise.resolve()
    }

    send(message: JSONRPCMessage): Promise<void> {
        if (!this.res) {
            return Promise.reject(new Error("Not connected"))
        }
        // Send JSON-RPC message as SSE data
        this.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
        return Promise.resolve()
    }

    /**
     * Handles the initial GET request to establish the SSE stream.
     */
    handleSseRequest(req: Request, res: Response): void {
        this.res = res
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'mcp-session-id': this.sessionId
        })
        
        // Send the endpoint event immediately to inform the client where to POST messages
        const endpointUrl = `${this.messagesEndpoint}?sessionId=${this.sessionId}`
        res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`)

        // Keep the connection alive
        req.on('close', () => {
            this.close().catch((err: unknown) => {
                logger.error('Error closing Legacy SSE transport', { error: String(err) })
            })
        })
    }

    /**
     * Handles incoming POST requests containing JSON-RPC messages.
     */
    handlePostMessage(req: Request, res: Response): void {
        const body = req.body as unknown
        if (body === undefined || body === null || typeof body !== 'object') {
            res.status(400).json({ error: 'Invalid JSON body' })
            return
        }

        if (this.onmessage) {
            this.onmessage(req.body as JSONRPCMessage)
        }
        
        // Legacy POST /messages must respond with 202 Accepted
        res.status(202).end()
    }
}
