/**
 * E2E Tests: Bearer Token Authentication
 *
 * Tests the --auth-token middleware. Uses a test-local server
 * on port 3101 to avoid conflicting with the main webServer.
 */

import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers.js'

const AUTH_TOKEN = 'test-secret-token-e2e'
const AUTH_PORT = 3101
const AUTH_BASE = `http://localhost:${AUTH_PORT}`

test.describe('Bearer Token Authentication', () => {
    test.beforeAll(async () => {
        await startServer(AUTH_PORT, ['--auth-token', AUTH_TOKEN], 'auth')
    })

    test.afterAll(() => {
        stopServer(AUTH_PORT)
    })

    test('/health should be accessible without token (exempt)', async () => {
        const response = await fetch(`${AUTH_BASE}/health`)
        expect(response.status).toBe(200)

        const body = await response.json()
        expect(body).toHaveProperty('status', 'healthy')
    })

    test('POST /mcp should return 401 without Authorization header', async () => {
        const response = await fetch(`${AUTH_BASE}/mcp`, {
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
                    clientInfo: { name: 'test', version: '1.0' },
                },
            }),
        })

        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body).toHaveProperty('error', 'Unauthorized')
    })

    test('POST /mcp should return 401 with wrong token', async () => {
        const response = await fetch(`${AUTH_BASE}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: 'Bearer wrong-token',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            }),
        })

        expect(response.status).toBe(401)
    })

    test('POST /mcp should succeed with correct Bearer token', async () => {
        const response = await fetch(`${AUTH_BASE}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            }),
        })

        expect(response.status).toBe(200)
    })

    test('GET / should return 401 without token', async () => {
        const response = await fetch(`${AUTH_BASE}/`)
        expect(response.status).toBe(401)
    })
})
