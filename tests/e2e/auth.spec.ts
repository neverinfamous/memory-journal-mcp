/**
 * E2E Tests: Bearer Token Authentication
 *
 * Tests the --auth-token middleware. Uses a test-local server
 * on port 3101 to avoid conflicting with the main webServer.
 */

import { test, expect } from '@playwright/test'
import { type ChildProcess, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const AUTH_TOKEN = 'test-secret-token-e2e'
const AUTH_PORT = 3101
const AUTH_BASE = `http://localhost:${AUTH_PORT}`

let serverProcess: ChildProcess | null = null

/**
 * Start a second MCP server with --auth-token on a different port.
 * Waits for /health to become reachable before returning.
 */
async function startAuthServer(): Promise<void> {
    serverProcess = spawn(
        'node',
        [
            'dist/cli.js',
            '--transport',
            'http',
            '--port',
            String(AUTH_PORT),
            '--db',
            './test-e2e-auth.db',
            '--auth-token',
            AUTH_TOKEN,
        ],
        {
            cwd: process.cwd(),
            stdio: 'pipe',
        }
    )

    // Wait for server to be ready (poll /health)
    const maxAttempts = 30
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(`${AUTH_BASE}/health`)
            if (res.ok) return
        } catch {
            // Server not ready yet
        }
        await delay(500)
    }
    throw new Error('Auth server did not start within timeout')
}

function stopAuthServer(): void {
    if (serverProcess) {
        serverProcess.kill('SIGTERM')
        serverProcess = null
    }
}

test.describe('Bearer Token Authentication', () => {
    test.beforeAll(async () => {
        await startAuthServer()
    })

    test.afterAll(() => {
        stopAuthServer()
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
