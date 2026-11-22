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
    public onmessage?: Transport['onmessage']

    constructor(private messagesEndpoint: string, sessionId?: string) {
        this.sessionId = sessionId ?? randomUUID()
    }

    async start(): Promise<void> {
        // No-op for Legacy SSE.
        // The transport is "started" implicitly when connected.
    }

    close(): Promise<void> {
        try {
            if (this.res) {
                this.res.end()
            }
        } finally {
            this.res = null
            const onclose = this.onclose
            this.onclose = undefined
            onclose?.()
        }
        return Promise.resolve()
    }

    send(message: JSONRPCMessage): Promise<void> {
        if (!this.res || this.res.writableEnded || this.res.destroyed) {
            return Promise.reject(new Error('Not connected'))
        }
        // Send JSON-RPC message as SSE data
        this.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
        return Promise.resolve()
    }

    /**
     * Handles the initial GET request to establish the SSE stream.
     */
    handleSseRequest(req: Request, res: Response): void {
        if (this.res !== null) {
            res.status(409).json({ error: { message: 'SSE stream already connected for this session' } })
            return
        }
        if (req.destroyed || res.writableEnded || res.destroyed) {
            void this.close()
            return
        }
        this.res = res
        if (typeof res.setTimeout === 'function') {
            res.setTimeout(0)
        }
        try {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'mcp-session-id': this.sessionId,
            })

            // Send the endpoint event immediately to inform the client where to POST messages
            const endpointUrl = `${this.messagesEndpoint}?sessionId=${this.sessionId}`
            res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`)
        } catch (err) {
            void this.close()
            throw err
        }

        const onStreamAbort = (err?: Error): void => {
            if (err !== undefined) {
                this.onerror?.(err)
            }
            this.close().catch((closeErr: unknown) => {
                logger.error('Error closing Legacy SSE transport', { error: String(closeErr) })
            })
        }
        if (typeof req.on === 'function') {
            req.on('close', () => onStreamAbort())
            req.on('error', onStreamAbort)
        }
        if (typeof res.on === 'function') {
            res.on('close', () => onStreamAbort())
            res.on('error', onStreamAbort)
        }
    }

    /**
     * Handles incoming POST requests containing JSON-RPC messages.
     */
    handlePostMessage(req: Request, res: Response): void {
        if (
            this.res === null ||
            this.res.writableEnded ||
            this.res.destroyed
        ) {
            res.status(410).json({ error: 'SSE stream closed' })
            return
        }

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
