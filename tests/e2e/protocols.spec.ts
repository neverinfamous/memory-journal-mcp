/**
 * E2E Tests: HTTP Transport Protocols
 *
 * Tests both Streamable HTTP (MCP 2025-03-26) and Legacy SSE (MCP 2024-11-05)
 * protocol error handling and routing.
 */

import { test, expect } from '@playwright/test'

test.describe('HTTP Transport Protocols', () => {
    test.describe('Streamable HTTP (MCP 2025-03-26)', () => {
        test('should reject non-init request without session ID', async ({ request }) => {
            const response = await request.post('/mcp', {
                headers: {
                    Accept: 'application/json, text/event-stream',
                },
                data: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'ping',
                },
            })

            expect(response.status()).toBe(400)
            const body = await response.json()
            expect(body.error).toHaveProperty(
                'message',
                'Bad Request: No valid session ID provided'
            )
        })

        test('should reject malformed JSON body on /mcp', async ({ request }) => {
            const response = await request.post('/mcp', {
                headers: {
                    Accept: 'application/json, text/event-stream',
                    'Content-Type': 'application/json',
                },
                data: Buffer.from('{"broken": json}'),
            })

            // Express JSON parser rejects invalid JSON before reaching our handler
            expect(response.status()).toBe(400)
        })

        test('should accept initialization and return session ID', async ({ request }) => {
            const response = await request.post('/mcp', {
                headers: {
                    Accept: 'application/json, text/event-stream',
                },
                data: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: {
                            name: 'playwright-protocol-test',
                            version: '1.0.0',
                        },
                    },
                },
            })

            expect(response.status()).toBe(200)
            const sessionId = response.headers()['mcp-session-id']
            expect(sessionId).toBeDefined()
        })
    })

    test.describe('Legacy SSE (MCP 2024-11-05)', () => {
        test('should reject /messages POST without sessionId parameter', async ({ request }) => {
            const response = await request.post('/messages', {
                data: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'test', version: '1.0' },
                    },
                },
            })

            expect(response.status()).toBe(400)
            const body = await response.json()
            expect(body.error).toHaveProperty('message', 'Missing sessionId parameter')
        })

        test('should reject /messages POST with unknown sessionId', async ({ request }) => {
            const response = await request.post('/messages?sessionId=invalid-session-uuid', {
                data: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'ping',
                },
            })

            expect(response.status()).toBe(404)
            const body = await response.json()
            expect(body.error).toHaveProperty('message', 'Session not found')
        })

        test('should complete full SDK client round-trip via Legacy SSE', async () => {
            // Regression test: server.connect() auto-calls start() on SSEServerTransport,
            // so a redundant start() call would throw "already started!" and break SSE entirely.
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
            const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')

            const transport = new SSEClientTransport(new URL('http://localhost:3100/sse'))
            const client = new Client(
                { name: 'playwright-sse-regression', version: '1.0.0' },
                { capabilities: {} }
            )

            try {
                await client.connect(transport)

                const response = await client.callTool({
                    name: 'get_recent_entries',
                    arguments: { limit: 1 },
                })

                expect(response.isError).toBeUndefined()
                expect(Array.isArray(response.content)).toBe(true)
            } finally {
                await client.close()
            }
        })
    })
})
