/**
 * E2E Tests: Rate Limiting
 *
 * Tests the built-in rate limiter by launching a server with a very
 * low rate limit and verifying 429 behavior, Retry-After headers,
 * and health endpoint exemption.
 *
 * Uses a dedicated server on port 3103 with MCP_RATE_LIMIT_MAX=5.
 */

import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers.js'

const RATE_PORT = 3103
const RATE_BASE = `http://localhost:${RATE_PORT}`

test.describe('Rate Limiting', () => {
    test.beforeAll(async () => {
        await startServer(RATE_PORT, [], 'rate-limit')
    })

    test.afterAll(() => {
        stopServer(RATE_PORT)
    })

    test('should return 429 after exceeding rate limit', async () => {
        // The server on this port uses the default env MCP_RATE_LIMIT_MAX=10000.
        // We need to override it. Since startServer doesn't pass MCP_RATE_LIMIT_MAX
        // for rate limit tests (checked in the helper), we use direct fetch with
        // a tight burst.

        // Actually, let's stop the default server and start one with low limit
        stopServer(RATE_PORT)

        // Start with explicit low rate limit via env override
        const { spawn } = await import('node:child_process')
        const { setTimeout: delay } = await import('node:timers/promises')

        const serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--transport',
                'http',
                '--port',
                String(RATE_PORT),
                '--db',
                './.test-output/e2e/test-e2e-rate-limit.db',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    MCP_RATE_LIMIT_MAX: '5',
                },
            },
        )

        // Wait for server to start
        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${RATE_BASE}/health`)
                if (res.ok) break
            } catch {
                // Not ready
            }
            await delay(500)
        }

        try {
            // Send 5 requests (within limit)
            for (let i = 0; i < 5; i++) {
                const res = await fetch(`${RATE_BASE}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: i + 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2025-03-26',
                            capabilities: {},
                            clientInfo: { name: 'rate-test', version: '1.0' },
                        },
                    }),
                })
                // These should succeed (200 or 400 for non-init, but not 429)
                expect(res.status).not.toBe(429)
            }

            // 6th request should be rate-limited
            const limitedResponse = await fetch(`${RATE_BASE}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 99,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'rate-test', version: '1.0' },
                    },
                }),
            })

            expect(limitedResponse.status).toBe(429)
        } finally {
            serverProcess.kill('SIGTERM')
        }
    })

    test('should include Retry-After header on 429', async () => {
        const { spawn } = await import('node:child_process')
        const { setTimeout: delay } = await import('node:timers/promises')

        const serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--transport',
                'http',
                '--port',
                String(RATE_PORT),
                '--db',
                './.test-output/e2e/test-e2e-rate-retry.db',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    MCP_RATE_LIMIT_MAX: '3',
                },
            },
        )

        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${RATE_BASE}/health`)
                if (res.ok) break
            } catch {
                // Not ready
            }
            await delay(500)
        }

        try {
            // Exhaust the limit
            for (let i = 0; i < 3; i++) {
                await fetch(`${RATE_BASE}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: i + 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2025-03-26',
                            capabilities: {},
                            clientInfo: { name: 'retry-test', version: '1.0' },
                        },
                    }),
                })
            }

            // Next request should be 429 with Retry-After
            const response = await fetch(`${RATE_BASE}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 99,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'retry-test', version: '1.0' },
                    },
                }),
            })

            expect(response.status).toBe(429)
            const retryAfter = response.headers.get('retry-after')
            expect(retryAfter).toBeDefined()
            expect(Number(retryAfter)).toBeGreaterThan(0)
        } finally {
            serverProcess.kill('SIGTERM')
        }
    })

    test('should exempt /health from rate limiting', async () => {
        const { spawn } = await import('node:child_process')
        const { setTimeout: delay } = await import('node:timers/promises')

        const serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--transport',
                'http',
                '--port',
                String(RATE_PORT),
                '--db',
                './.test-output/e2e/test-e2e-rate-health.db',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    MCP_RATE_LIMIT_MAX: '2',
                },
            },
        )

        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${RATE_BASE}/health`)
                if (res.ok) break
            } catch {
                // Not ready
            }
            await delay(500)
        }

        try {
            // Exhaust rate limit
            for (let i = 0; i < 2; i++) {
                await fetch(`${RATE_BASE}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: i + 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2025-03-26',
                            capabilities: {},
                            clientInfo: { name: 'health-test', version: '1.0' },
                        },
                    }),
                })
            }

            // /health should still work
            const healthResponse = await fetch(`${RATE_BASE}/health`)
            expect(healthResponse.status).toBe(200)
            const body = await healthResponse.json()
            expect(body).toHaveProperty('status', 'healthy')

            // But /mcp should be 429
            const mcpResponse = await fetch(`${RATE_BASE}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 99,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'health-test', version: '1.0' },
                    },
                }),
            })
            expect(mcpResponse.status).toBe(429)
        } finally {
            serverProcess.kill('SIGTERM')
        }
    })
})
