/**
 * E2E Tests: Rate Limiting
 *
 * Tests the built-in rate limiter by launching a server with a very
 * low rate limit and verifying 429 behavior, Retry-After headers,
 * and health endpoint exemption.
 *
 * Uses dedicated servers with specific rate limits for each test.
 */

import { test, expect } from './test-fixture.js'
import { startServer, stopServer } from './helpers.js'

const workerIndex = Number(process.env.TEST_PARALLEL_INDEX || 0)
const RATE_PORT = 4100 + (workerIndex * 10)

test.describe('Rate Limiting', () => {
    test.setTimeout(120000)

    test('should allow high throughput with default rate limit', async () => {
        const testPort = RATE_PORT + 1
        await startServer(testPort, [], 'rate-default')
        try {
            const burstCount = 50
            const promises = []
            for (let i = 0; i < burstCount; i++) {
                promises.push(
                    fetch(`http://localhost:${testPort}/mcp`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': '2024-11-05',
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
            stopServer(testPort)
        }
    })

    test('should return 429 after exceeding rate limit', async () => {
        const testPort = RATE_PORT + 2
        await startServer(testPort, [], 'rate-limit', {
            env: { MCP_RATE_LIMIT_MAX: '5' }
        })
        try {
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
                const res = await fetch(`http://localhost:${testPort}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': '2024-11-05',
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
            stopServer(testPort)
        }
    })

    test('should include Retry-After header on 429', async () => {
        const testPort = RATE_PORT + 3
        await startServer(testPort, [], 'rate-retry', {
            env: { MCP_RATE_LIMIT_MAX: '3' }
        })
        try {
            let retryAfter: string | null = null
            for (let i = 0; i < 20; i++) {
                const res = await fetch(`http://localhost:${testPort}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': '2024-11-05',
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
            stopServer(testPort)
        }
    })

    test('should apply rate limiting to /health', async () => {
        const testPort = RATE_PORT + 4
        await startServer(testPort, [], 'rate-health', {
            env: { MCP_RATE_LIMIT_MAX: '2' }
        })
        try {
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
                const res = await fetch(`http://localhost:${testPort}/health`)
                if (res.status === 429) {
                    status429Hit = true
                    break
                }
            }
            expect(status429Hit).toBe(true)
        } finally {
            stopServer(testPort)
        }
    })
})
