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
import { getBaseURL, startServer, stopServer } from './helpers.js'

const workerIndex = Number(process.env.TEST_PARALLEL_INDEX || 0)
const RATE_PORT = 4100 + workerIndex * 10

function postInitialize(baseUrl: string, id: number, clientName: string) {
    return fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2024-11-05',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: clientName, version: '1.0' },
            },
        }),
    })
}

test.describe('Rate Limiting', () => {
    test.setTimeout(120000)

    test('should allow high throughput with default rate limit', async ({ baseURL: _baseURL }, testInfo) => {
        const baseUrl = getBaseURL(testInfo)
        const burstCount = 50
        const batchSize = 10
        const sessionIds: string[] = []

        // Send 50 requests in bounded batches of 10 so all 50 land well inside the 60s
        // rate-limit window without starving the single-threaded accept queue past undici's 10s connect timeout.
        for (let offset = 0; offset < burstCount; offset += batchSize) {
            const count = Math.min(batchSize, burstCount - offset)
            const results = await Promise.all(
                Array.from({ length: count }, (_, i) =>
                    postInitialize(baseUrl, offset + i + 1, 'default-test')
                )
            )
            for (const res of results) {
                expect(res.status).not.toBe(429)
                const sid = res.headers.get('mcp-session-id')
                if (sid !== null && sid !== '') {
                    sessionIds.push(sid)
                }
                await res.body?.cancel()
            }
        }

        // Clean up initialized sessions on the shared worker server
        await Promise.allSettled(
            sessionIds.map((sid) =>
                fetch(`${baseUrl}/mcp`, {
                    method: 'DELETE',
                    headers: { 'mcp-session-id': sid },
                }).then((r) => r.body?.cancel())
            )
        )
    })

    test.describe('Low rate limit enforcement', () => {
        test.describe.configure({ mode: 'serial' })

        const lowLimitPort = RATE_PORT + 2
        const lowLimitBase = `http://localhost:${lowLimitPort}`

        test.beforeAll(async () => {
            await startServer(lowLimitPort, [], 'rate-limit', {
                env: { MCP_RATE_LIMIT_MAX: '5' },
            })
        })

        test.afterAll(() => {
            stopServer(lowLimitPort)
        })

        test('should return 429 after exceeding rate limit', async () => {
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
                const res = await postInitialize(lowLimitBase, i + 1, 'rate-test')
                if (res.status === 429) {
                    status429Hit = true
                    break
                }
            }
            expect(status429Hit).toBe(true)
        })

        test('should include Retry-After header on 429', async () => {
            let retryAfter: string | null = null
            for (let i = 0; i < 20; i++) {
                const res = await postInitialize(lowLimitBase, i + 1, 'retry-test')
                if (res.status === 429) {
                    retryAfter = res.headers.get('retry-after')
                    break
                }
            }
            expect(retryAfter).not.toBeNull()
            expect(Number(retryAfter)).toBeGreaterThan(0)
        })

        test('should apply rate limiting to /health', async () => {
            let status429Hit = false
            for (let i = 0; i < 20; i++) {
                const res = await fetch(`${lowLimitBase}/health`)
                if (res.status === 429) {
                    status429Hit = true
                    break
                }
            }
            expect(status429Hit).toBe(true)
        })
    })
})
