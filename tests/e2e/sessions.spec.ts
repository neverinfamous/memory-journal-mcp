/**
 * E2E Tests: Session Lifecycle
 *
 * Tests the full Streamable HTTP session lifecycle: initialization,
 * tool calls with session ID, session termination (DELETE /mcp),
 * and rejection of stale/invalid sessions.
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.describe('Session Lifecycle', () => {
    let sessionId: string

    test('should initialize a session and return session ID', async ({ request }) => {
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
                        name: 'playwright-session-test',
                        version: '1.0.0',
                    },
                },
            },
        })

        expect(response.status()).toBe(200)
        sessionId = response.headers()['mcp-session-id']!
        expect(sessionId).toBeDefined()
        expect(sessionId.length).toBeGreaterThan(0)
    })

    test('should accept requests with valid session ID', async ({ request }) => {
        // Send initialized notification (required by MCP protocol after init)
        const response = await request.post('/mcp', {
            headers: {
                Accept: 'application/json, text/event-stream',
                'mcp-session-id': sessionId,
            },
            data: {
                jsonrpc: '2.0',
                method: 'notifications/initialized',
            },
        })

        // Notifications return 202 (accepted, no response body) or 200
        expect([200, 202, 204]).toContain(response.status())
    })

    test('should allow tool calls with valid session ID', async ({ request }) => {
        const response = await request.post('/mcp', {
            headers: {
                Accept: 'application/json, text/event-stream',
                'mcp-session-id': sessionId,
            },
            data: {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
            },
        })

        expect(response.status()).toBe(200)
    })

    test('GET /mcp (SSE) should reject without session ID', async ({ request }) => {
        const response = await request.get('/mcp')
        expect(response.status()).toBe(400)
    })

    test('DELETE /mcp should reject without session ID', async ({ request }) => {
        const response = await request.delete('/mcp')
        expect(response.status()).toBe(400)
    })

    test('DELETE /mcp should terminate a valid session', async ({ request }) => {
        const response = await request.delete('/mcp', {
            headers: {
                'mcp-session-id': sessionId,
            },
        })

        // DELETE returns 200 or 204
        expect([200, 204]).toContain(response.status())
    })
})
