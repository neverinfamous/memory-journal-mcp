/**
 * E2E Tests: Health & Root Info
 *
 * Verifies the HTTP server's health check and root info endpoints
 * return correct responses with expected structure.
 */

import { test, expect } from '@playwright/test'

test.describe('Health & Root Info', () => {
    test('should return 200 OK from /health endpoint', async ({ request }) => {
        const response = await request.get('/health')
        expect(response.status()).toBe(200)

        const body = await response.json()
        expect(body).toHaveProperty('status', 'healthy')
        expect(body).toHaveProperty('timestamp')
        // Timestamp should be a valid ISO string
        expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
    })

    test('should return server metadata on GET /', async ({ request }) => {
        const response = await request.get('/')
        expect(response.status()).toBe(200)

        const body = await response.json()
        expect(body).toHaveProperty('name', 'memory-journal-mcp')
        expect(body).toHaveProperty('version')
        expect(body).toHaveProperty('description')
        expect(body).toHaveProperty('endpoints')
        expect(body.endpoints).toHaveProperty('POST /mcp')
        expect(body.endpoints).toHaveProperty('GET /sse')
        expect(body.endpoints).toHaveProperty('GET /health')
    })

    test('should accept MCP initialization request on /mcp', async ({ request }) => {
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
                        name: 'playwright-test',
                        version: '1.0.0',
                    },
                },
            },
        })

        expect(response.status()).toBe(200)
        // Session ID should be returned in response headers
        const sessionId = response.headers()['mcp-session-id']
        expect(sessionId).toBeDefined()
        expect(typeof sessionId).toBe('string')
        expect(sessionId!.length).toBeGreaterThan(0)
    })
})
