/**
 * E2E Tests: HTTP/SSE Streaming
 *
 * Validates raw SSE event stream behavior for both Streamable HTTP
 * (GET /mcp) and Legacy SSE (GET /sse) transports.
 *
 * Uses a dedicated server on port 3107 to avoid disrupting SDK-based
 * tests on the shared port 3100 (raw SSE connections interfere with
 * McpServer.connect() single-transport state).
 */

import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers.js'

const STREAM_PORT = 3123
const STREAM_BASE = `http://localhost:${STREAM_PORT}`

test.describe('HTTP/SSE Streaming', () => {
    test.beforeAll(async () => {
        await startServer(STREAM_PORT, [], 'streaming')
    })

    test.afterAll(() => {
        stopServer(STREAM_PORT)
    })

    test.describe('Streamable HTTP (GET /mcp)', () => {
        test('should require session ID for GET /mcp SSE stream', async () => {
            const response = await fetch(`${STREAM_BASE}/mcp`)
            expect(response.status).toBe(400)
        })

        test('should accept GET /mcp with valid session ID', async () => {
            // First, initialize a session
            const initResponse = await fetch(`${STREAM_BASE}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'streaming-test', version: '1.0.0' },
                    },
                }),
            })

            expect(initResponse.status).toBe(200)
            const sessionId = initResponse.headers.get('mcp-session-id')
            expect(sessionId).toBeDefined()

            // Open SSE stream with session ID — use raw fetch with AbortController
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 3000)

            try {
                const sseResponse = await fetch(`${STREAM_BASE}/mcp`, {
                    headers: {
                        'mcp-session-id': sessionId!,
                        Accept: 'text/event-stream',
                    },
                    signal: controller.signal,
                })

                // Server should accept the SSE connection
                expect(sseResponse.status).toBe(200)
                expect(sseResponse.headers.get('content-type')).toContain('text/event-stream')
            } catch (error) {
                // AbortError is expected when we timeout the long-lived SSE stream
                if (error instanceof Error && error.name !== 'AbortError') {
                    throw error
                }
            } finally {
                clearTimeout(timeout)
            }
        })

        test('should accept Last-Event-ID header for reconnection', async () => {
            // Initialize session
            const initResponse = await fetch(`${STREAM_BASE}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'reconnect-test', version: '1.0.0' },
                    },
                }),
            })

            const sessionId = initResponse.headers.get('mcp-session-id')
            expect(sessionId).toBeDefined()

            // Reconnect with Last-Event-ID — server should accept (not error)
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 2000)

            try {
                const sseResponse = await fetch(`${STREAM_BASE}/mcp`, {
                    headers: {
                        'mcp-session-id': sessionId!,
                        'Last-Event-ID': 'test-event-id-123',
                        Accept: 'text/event-stream',
                    },
                    signal: controller.signal,
                })

                // Should still return 200 with event-stream
                expect(sseResponse.status).toBe(200)
            } catch (error) {
                if (error instanceof Error && error.name !== 'AbortError') {
                    throw error
                }
            } finally {
                clearTimeout(timeout)
            }
        })
    })

    test.describe('Legacy SSE (GET /sse)', () => {
        test('should return text/event-stream from /sse endpoint', async () => {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 3000)

            try {
                const response = await fetch(`${STREAM_BASE}/sse`, {
                    headers: { Accept: 'text/event-stream' },
                    signal: controller.signal,
                })

                expect(response.status).toBe(200)
                expect(response.headers.get('content-type')).toContain('text/event-stream')

                // Read the first chunk of SSE data — should contain the endpoint event
                const reader = response.body!.getReader()
                const decoder = new TextDecoder()

                const { value } = await reader.read()
                const text = decoder.decode(value)

                // Legacy SSE sends an 'endpoint' event with the message URL
                expect(text).toContain('event: endpoint')
                expect(text).toContain('/messages?sessionId=')

                reader.releaseLock()
            } catch (error) {
                if (error instanceof Error && error.name !== 'AbortError') {
                    throw error
                }
            } finally {
                clearTimeout(timeout)
            }
        })

        // Note: Full SSE SDK round-trip test is in protocols.spec.ts (legacy SSE section).
        // Duplicating it here consistently times out due to the single-transport
        // limitation in McpServer.connect(). The raw stream test above validates
        // SSE format and endpoint event delivery.
    })

    // Note: Streamable HTTP SDK round-trip tests live in tools.spec.ts and
    // resources.spec.ts. Duplicating them here causes timeouts due to the
    // single-transport limitation in McpServer.connect().
})
