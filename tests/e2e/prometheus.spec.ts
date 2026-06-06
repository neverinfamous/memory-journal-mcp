/**
 * E2E Tests: Prometheus Metrics Export
 *
 * Verifies the HTTP server's /metrics endpoint exposes Prometheus metrics.
 */

import { test, expect } from '@playwright/test'

test.describe('Prometheus Metrics Export', () => {
    test('should return 200 OK from /metrics endpoint with text/plain content type', async ({ request }) => {
        const response = await request.get('/metrics')
        expect(response.status()).toBe(200)

        // Prometheus format uses version=0.0.4 parameters
        const contentType = response.headers()['content-type']
        expect(contentType).toContain('text/plain')
        expect(contentType).toContain('version=0.0.4')

        const body = await response.text()
        
        // Assert some basic metrics are present
        expect(body).toContain('mcp_process_uptime_seconds')
        expect(body).toContain('mcp_process_memory_bytes')
        expect(body).toContain('mcp_tool_calls_total')
    })
})
