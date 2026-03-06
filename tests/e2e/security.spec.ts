/**
 * E2E Tests: Security & Limits
 *
 * Tests HTTP transport security hardening: security headers,
 * body size limits, 404 handler, CORS, and HSTS.
 */

import { test, expect } from '@playwright/test'

test.describe('HTTP Transport Security & Limits', () => {
    test('should return 404 Not Found for unknown endpoints', async ({ request }) => {
        const response = await request.get('/non-existent-path')
        expect(response.status()).toBe(404)

        const body = await response.json()
        expect(body).toHaveProperty('error', 'Not found')
    })

    test('should return 413 Payload Too Large for excessive POST bodies', async ({ request }) => {
        // Generate a payload over 1 MB (1,048,576 bytes)
        const bulkyData = 'A'.repeat(1024 * 1025) // ~1.025 MB string

        const response = await request.post('/mcp', {
            headers: {
                Accept: 'application/json, text/event-stream',
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

    test('should inject security headers on responses', async ({ request }) => {
        const response = await request.get('/health')
        expect(response.status()).toBe(200)

        const headers = response.headers()
        expect(headers['x-content-type-options']).toBe('nosniff')
        expect(headers['x-frame-options']).toBe('DENY')
        expect(headers['cache-control']).toBe('no-store')
        expect(headers['content-security-policy']).toBe(
            "default-src 'none'; frame-ancestors 'none'"
        )
        expect(headers['referrer-policy']).toBe('no-referrer')
        expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    })

    test('should respond with 204 to CORS preflight OPTIONS requests', async ({ request }) => {
        const response = await request.fetch('/mcp', {
            method: 'OPTIONS',
        })

        expect(response.status()).toBe(204)
    })

    test('should include CORS headers on responses', async ({ request }) => {
        const response = await request.get('/health')
        const headers = response.headers()

        // Default CORS origin is * (configurable via --cors-origin)
        expect(headers['access-control-allow-origin']).toBe('*')
        expect(headers['access-control-allow-methods']).toContain('POST')
        expect(headers['access-control-allow-methods']).toContain('GET')
        expect(headers['access-control-expose-headers']).toContain('mcp-session-id')
    })

    test('should include HSTS header when X-Forwarded-Proto is https', async ({ request }) => {
        const response = await request.get('/health', {
            headers: {
                'X-Forwarded-Proto': 'https',
            },
        })

        expect(response.status()).toBe(200)
        const headers = response.headers()
        expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    })

    test('should NOT include HSTS header without X-Forwarded-Proto', async ({ request }) => {
        const response = await request.get('/health')
        expect(response.status()).toBe(200)

        const headers = response.headers()
        expect(headers['strict-transport-security']).toBeUndefined()
    })
})
