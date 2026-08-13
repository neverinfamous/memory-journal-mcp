/**
 * E2E Tests: Stateless HTTP Mode
 *
 * Tests the --stateless mode behavior. Uses a test-local server
 * on port 3102 to avoid conflicting with the main webServer.
 */

import { test, expect } from './test-fixture.js'
import { startServer, stopServer } from './helpers.js'

const workerIndex = Number(process.env.TEST_PARALLEL_INDEX || 0)
const STATELESS_PORT = 4200 + (workerIndex * 10)
const STATELESS_BASE = `http://localhost:${STATELESS_PORT}`

test.describe('Stateless HTTP Mode', () => {
    test.beforeAll(async () => {
        await startServer(STATELESS_PORT, ['--stateless'], 'stateless')
    })

    test.afterAll(() => {
        stopServer(STATELESS_PORT)
    })

    test('POST /mcp should accept requests without session ID (stateless)', async () => {
        const response = await fetch(`${STATELESS_BASE}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'mcp-protocol-version': '2026-07-28',
                'mcp-method': 'tools/list'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientCapabilities': {}
                    }
                }
            }),
        })

        const text = await response.text()
        if (response.status !== 200) {
            console.error('SERVER RESPONDED WITH:', response.status, text)
        }
        
        expect(response.status).toBe(200)
        const body = JSON.parse(text)
        expect(body).toHaveProperty('jsonrpc', '2.0')
        expect(body).toHaveProperty('id', 1)
        expect(body.result).toBeDefined()
    })

    test('GET /mcp should return 405 (SSE not available in stateless)', async () => {
        const response = await fetch(`${STATELESS_BASE}/mcp`)

        expect(response.status).toBe(405)
        const body = await response.json()
        expect(body.error).toHaveProperty(
            'message',
            'SSE streaming not available in stateless mode'
        )
    })

    test('DELETE /mcp should return 204 (no-op in stateless)', async () => {
        const response = await fetch(`${STATELESS_BASE}/mcp`, {
            method: 'DELETE',
        })

        expect(response.status).toBe(204)
    })

    test('GET /sse should return 404 (legacy SSE not available in stateless)', async () => {
        const response = await fetch(`${STATELESS_BASE}/sse`)

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body).toHaveProperty('error', 'Not found')
    })

    test('/health should still work in stateless mode', async () => {
        const response = await fetch(`${STATELESS_BASE}/health`)
        expect(response.status).toBe(200)

        const body = await response.json()
        expect(body).toHaveProperty('status', 'healthy')
    })
})
