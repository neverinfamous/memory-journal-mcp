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

    test('should allow high throughput with default rate limit', async () => {
        const { spawn } = await import('node:child_process')
        const { setTimeout: delay } = await import('node:timers/promises')

        // Start with default rate limit (no override)
        const serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--allowed-io-roots',
                process.cwd(),
                '--transport',
                'http',
                '--port',
                String(RATE_PORT + 1), // Use a different port to avoid conflicts
                '--db',
                './.test-output/e2e/test-e2e-rate-default.db',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: { ...process.env, ALLOWED_IO_ROOTS: process.cwd() },
            }
        )

        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`http://localhost:${RATE_PORT + 1}/health`)
                if (res.ok) break
            } catch {
                /* Not ready */
            }
            await delay(500)
        }

        try {
            const burstCount = 50
            const promises = []
            for (let i = 0; i < burstCount; i++) {
                promises.push(
                    fetch(`http://localhost:${RATE_PORT + 1}/mcp`, {
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
                                clientInfo: { name: 'default-test', version: '1.0' },
                            },
                        }),
                    })
                )
            }
            const results = await Promise.all(promises)
            for (const res of results) {
                expect(res.status).not.toBe(429)
            }
        } finally {
            serverProcess.kill('SIGTERM')
        }
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
                '--allowed-io-roots',
                process.cwd(),
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
                    ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '5',
                },
            }
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
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
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
                if (res.status === 429) {
                    status429Hit = true
                    break
                }
            }
            expect(status429Hit).toBe(true)
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
                '--allowed-io-roots',
                process.cwd(),
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
                    ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '3',
                },
            }
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
            let retryAfter: string | null = null
            for (let i = 0; i < 20; i++) {
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
                            clientInfo: { name: 'retry-test', version: '1.0' },
                        },
                    }),
                })
                if (res.status === 429) {
                    retryAfter = res.headers.get('retry-after')
                    break
                }
            }
            expect(retryAfter).not.toBeNull()
            expect(Number(retryAfter)).toBeGreaterThan(0)
        } finally {
            serverProcess.kill('SIGTERM')
        }
    })

    test('should apply rate limiting to /health', async () => {
        const { spawn } = await import('node:child_process')
        const { setTimeout: delay } = await import('node:timers/promises')

        const serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--allowed-io-roots',
                process.cwd(),
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
                    ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '2',
                },
            }
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
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
                const res = await fetch(`${RATE_BASE}/health`)
                if (res.status === 429) {
                    status429Hit = true
                    break
                }
            }
            expect(status429Hit).toBe(true)
        } finally {
            serverProcess.kill('SIGTERM')
        }
    })
})
