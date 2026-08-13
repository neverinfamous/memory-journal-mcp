/**
 * E2E Tests: Security & Limits
 *
 * Tests HTTP transport security hardening: security headers,
 * body size limits, 404 handler, CORS, and HSTS.
 */

import { test, expect } from './test-fixture.js'
import { startServer, stopServer, getBaseURL } from './helpers.js'

test.describe('HTTP Transport Security & Limits', () => {
    test('should return 404 Not Found for unknown endpoints', async ({ request }, testInfo) => {
        const baseURL = getBaseURL(testInfo)
        const response = await request.get(`${baseURL}/non-existent-path`)
        expect(response.status()).toBe(404)

        const body = await response.json()
        expect(body).toHaveProperty('error', 'Not found')
    })

    test('should return 413 Payload Too Large for excessive POST bodies', async ({ request }, testInfo) => {
        // Generate a payload over 1 MB (1,048,576 bytes)
        const bulkyData = 'A'.repeat(1024 * 1025) // ~1.025 MB string

        const baseURL = getBaseURL(testInfo)
        const response = await request.post(`${baseURL}/mcp`, {
            headers: {
                Accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': '2024-11-05',
            },
            data: {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: { testData: bulkyData },
            },
        })

        expect(response.status()).toBe(413)
    })

    test('should inject security headers on responses', async ({ request }, testInfo) => {
        const baseURL = getBaseURL(testInfo)
        const response = await request.get(`${baseURL}/health`)
        expect(response.status()).toBe(200)

        const headers = response.headers()
        expect(headers['x-content-type-options']).toBe('nosniff')
        expect(headers['x-frame-options']).toBe('DENY')
        expect(headers['cache-control']).toBe('no-store, no-cache, must-revalidate')
        expect(headers['content-security-policy']).toBe(
            "default-src 'none'; frame-ancestors 'none'"
        )
        expect(headers['referrer-policy']).toBe('no-referrer')
        expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    })

    test('should respond with 204 to CORS preflight OPTIONS requests', async ({ request }, testInfo) => {
        const baseURL = getBaseURL(testInfo)
        const response = await request.fetch(`${baseURL}/mcp`, {
            method: 'OPTIONS',
        })

        expect(response.status()).toBe(204)
    })

    test('should include CORS headers on responses', async ({ request }, testInfo) => {
        const baseURL = getBaseURL(testInfo)
        const response = await request.get(`${baseURL}/health`)
        const headers = response.headers()

        // Default CORS origin is strict-by-default (undefined) unless configured
        expect(headers['access-control-allow-origin']).toBeUndefined()
        expect(headers['access-control-allow-methods']).toContain('POST')
        expect(headers['access-control-allow-methods']).toContain('GET')
        expect(headers['access-control-expose-headers']).toContain('mcp-session-id')
    })

    test('should NOT include HSTS header without enableHSTS config', async ({ request }, testInfo) => {
        // HSTS is now config-driven (enableHSTS: true), not header-sniffed.
        // Without explicit config, X-Forwarded-Proto alone should NOT trigger HSTS.
        const baseURL = getBaseURL(testInfo)
        const response = await request.get(`${baseURL}/health`, {
            headers: {
                'X-Forwarded-Proto': 'https',
            },
        })

        expect(response.status()).toBe(200)
        const headers = response.headers()
        expect(headers['strict-transport-security']).toBeUndefined()
    })

    test('should NOT include HSTS header without X-Forwarded-Proto', async ({ request }, testInfo) => {
        const baseURL = getBaseURL(testInfo)
        const response = await request.get(`${baseURL}/health`)
        expect(response.status()).toBe(200)

        const headers = response.headers()
        expect(headers['strict-transport-security']).toBeUndefined()
    })

    test('should include HSTS header when --enable-hsts is configured', async () => {
        const HSTS_PORT = 5124 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)

        await startServer(HSTS_PORT, ['--enable-hsts'], 'hsts')

        try {
            const response = await fetch(`http://localhost:${HSTS_PORT}/health`)
            expect(response.status).toBe(200)

            const hsts = response.headers.get('strict-transport-security')
            expect(hsts).toBeDefined()
            expect(hsts).toContain('max-age=')
            expect(hsts).toContain('includeSubDomains')
        } finally {
            stopServer(HSTS_PORT)
        }
    })
})
