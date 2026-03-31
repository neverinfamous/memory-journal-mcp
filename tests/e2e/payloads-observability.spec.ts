/**
 * Payload Contract Tests: Observability & Audit (Phase 2)
 *
 * Validates the 5 new resources introduced in Phase 2:
 *   memory://metrics/summary  — aggregate call/error/token stats (YAML text)
 *   memory://metrics/tokens   — per-tool token breakdown (YAML text)
 *   memory://metrics/system   — process-level system metrics (YAML text)
 *   memory://metrics/users    — per-user call counts (YAML text, may be empty)
 *   memory://audit            — last 50 audit entries (YAML text, unconfigured in test env)
 *
 * Also verifies that _meta.tokenEstimate is injected on tool call responses
 * after the metrics interceptor is wired into callTool() dispatch.
 *
 * All five resources return text/plain YAML-style payloads (not JSON).
 * Tests use substring key checks appropriate for this format.
 *
 * Notes on test environment:
 *   - AUDIT_LOG_PATH is not set → memory://audit returns "not configured" message.
 *   - No OAuth user tracking → memory://metrics/users returns empty breakdown.
 *   - Metrics accumulate across tests within this describe block (serial mode).
 */

import { test, expect } from '@playwright/test'
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Narrow the SDK's content union ({ text } | { blob }) and return the text.
 * All observability/audit resources are text/plain or application/json,
 * so the blob branch is unreachable here. Throws if a blob is returned unexpectedly.
 */
function getResourceText(response: ReadResourceResult): string {
    const first = response.contents[0]!
    if ('text' in first) return first.text
    throw new Error(`Expected text content but got blob for URI: ${first.uri}`)
}

// ─── Suite ──────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Observability & Audit', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    // =========================================================================
    // Warm-up: make at least one tool call so metrics are non-zero
    // =========================================================================

    test('warm-up: create_entry to seed metrics accumulator', async () => {
        const payload = await callToolAndParse(client, 'create_entry', {
            content: 'Observability E2E warm-up entry',
            entry_type: 'test_entry',
            tags: ['observability', 'e2e'],
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })

    // =========================================================================
    // Resource list
    // =========================================================================

    test('resource list includes all 5 observability/audit URIs', async () => {
        const listResponse = await client.listResources()
        const uris = listResponse.resources.map((r) => r.uri)

        expect(uris).toContain('memory://metrics/summary')
        expect(uris).toContain('memory://metrics/tokens')
        expect(uris).toContain('memory://metrics/system')
        expect(uris).toContain('memory://metrics/users')
        expect(uris).toContain('memory://audit')
    })

    // =========================================================================
    // Resource: memory://metrics/summary
    // =========================================================================

    test('memory://metrics/summary — returns YAML text with required keys', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/summary' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        expect(text.length).toBeGreaterThan(0)

        // YAML-style plain text — check required key prefixes
        expect(text).toContain('metrics_summary:')
        expect(text).toContain('up_since:')
        expect(text).toContain('as_of:')
        expect(text).toContain('total_calls:')
        expect(text).toContain('total_errors:')
        expect(text).toContain('error_rate_pct:')
        expect(text).toContain('total_duration_ms:')
        expect(text).toContain('avg_duration_ms:')
        expect(text).toContain('total_input_tokens:')
        expect(text).toContain('total_output_tokens:')
        expect(text).toContain('tools_called:')
    })

    test('memory://metrics/summary — total_calls >= 1 after warm-up', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/summary' })
        const text = getResourceText(response)

        // Extract the integer after "total_calls: "
        const match = /total_calls:\s*(\d+)/.exec(text)
        expect(match).not.toBeNull()
        const totalCalls = parseInt(match![1]!, 10)
        expect(totalCalls).toBeGreaterThanOrEqual(1)
    })

    // =========================================================================
    // Resource: memory://metrics/tokens
    // =========================================================================

    test('memory://metrics/tokens — returns YAML text with token_breakdown key', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/tokens' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        expect(text).toContain('token_breakdown:')
        expect(text).toContain('as_of:')
    })

    test('memory://metrics/tokens — contains per-tool rows after warm-up', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/tokens' })
        const text = getResourceText(response)

        // After at least one tool call the breakdown should list tool entries.
        // The empty-state fallback only contains a "note:" line.
        expect(text).not.toContain('No tool calls recorded yet')
        expect(text).toContain('tool:')
        expect(text).toContain('calls:')
        expect(text).toContain('input_tokens:')
        expect(text).toContain('output_tokens:')
        expect(text).toContain('avg_output_tokens:')
    })

    // =========================================================================
    // Resource: memory://metrics/system
    // =========================================================================

    test('memory://metrics/system — returns YAML text with system_metrics key', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/system' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        expect(text).toContain('system_metrics:')
        expect(text).toContain('up_since:')
        expect(text).toContain('uptime_seconds:')
        expect(text).toContain('process_memory_mb:')
        expect(text).toContain('node_version:')
        expect(text).toContain('platform:')
        expect(text).toContain('as_of:')
    })

    test('memory://metrics/system — uptime_seconds is a non-negative integer', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/system' })
        const text = getResourceText(response)

        const match = /uptime_seconds:\s*(\d+)/.exec(text)
        expect(match).not.toBeNull()
        const uptimeSeconds = parseInt(match![1]!, 10)
        expect(uptimeSeconds).toBeGreaterThanOrEqual(0)
    })

    test('memory://metrics/system — node_version starts with "v"', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/system' })
        const text = getResourceText(response)

        const match = /node_version:\s*(\S+)/.exec(text)
        expect(match).not.toBeNull()
        expect(match![1]!.startsWith('v')).toBe(true)
    })

    test('memory://metrics/system — process_memory_mb is a positive integer', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/system' })
        const text = getResourceText(response)

        const match = /process_memory_mb:\s*(\d+)/.exec(text)
        expect(match).not.toBeNull()
        const memMb = parseInt(match![1]!, 10)
        expect(memMb).toBeGreaterThan(0)
    })

    // =========================================================================
    // Resource: memory://metrics/users
    // =========================================================================

    test('memory://metrics/users — returns YAML text with user_metrics key', async () => {
        const response = await client.readResource({ uri: 'memory://metrics/users' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        expect(text).toContain('user_metrics:')
        expect(text).toContain('as_of:')
    })

    test('memory://metrics/users — graceful empty state when no OAuth tracking', async () => {
        // The test server runs without OAuth, so no user identifiers are available.
        // The resource should return the "not available" note, not an error.
        const response = await client.readResource({ uri: 'memory://metrics/users' })
        const text = getResourceText(response)

        // Either empty-state note OR actual user rows — both are valid.
        // We assert the top-level key is always present.
        expect(text).toContain('user_metrics:')
    })

    // =========================================================================
    // Resource: memory://audit
    // =========================================================================

    test('memory://audit — returns plain text (not configured in test env)', async () => {
        // AUDIT_LOG_PATH is not set in the default test server launch.
        // The resource should return a "not configured" message rather than an error.
        const response = await client.readResource({ uri: 'memory://audit' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://audit — unconfigured state contains informational hint', async () => {
        const response = await client.readResource({ uri: 'memory://audit' })
        const text = getResourceText(response)

        // When AUDIT_LOG_PATH is not set the resource emits:
        // "audit: not configured\nhint: Set AUDIT_LOG_PATH env var ..."
        expect(text).toContain('audit:')
        expect(text).toContain('not configured')
        expect(text).toContain('AUDIT_LOG_PATH')
    })

    // =========================================================================
    // _meta.tokenEstimate injection
    // =========================================================================

    test('_meta.tokenEstimate is present on create_entry response', async () => {
        const payload = await callToolAndParse(client, 'create_entry', {
            content: 'Token estimate injection test',
            entry_type: 'test_entry',
        })
        expectSuccess(payload)

        // The interceptor post-processes callTool() results to inject _meta
        expect(payload._meta).toBeDefined()
        const meta = payload._meta as Record<string, unknown>
        expect(typeof meta.tokenEstimate).toBe('number')
        expect(meta.tokenEstimate as number).toBeGreaterThan(0)
    })

    test('_meta.tokenEstimate is present on get_recent_entries response', async () => {
        const payload = await callToolAndParse(client, 'get_recent_entries', { limit: 5 })
        expectSuccess(payload)

        expect(payload._meta).toBeDefined()
        const meta = payload._meta as Record<string, unknown>
        expect(typeof meta.tokenEstimate).toBe('number')
        expect(meta.tokenEstimate as number).toBeGreaterThan(0)
    })

    test('_meta.tokenEstimate is present on search_entries response', async () => {
        const payload = await callToolAndParse(client, 'search_entries', {
            query: 'observability',
            limit: 5,
        })
        expectSuccess(payload)

        expect(payload._meta).toBeDefined()
        const meta = payload._meta as Record<string, unknown>
        expect(typeof meta.tokenEstimate).toBe('number')
        // Search with results → non-trivial output
        expect(meta.tokenEstimate as number).toBeGreaterThanOrEqual(1)
    })

    // =========================================================================
    // memory://health — metrics section present after Phase 2
    // =========================================================================

    test('memory://health — includes metrics subsection after Phase 2', async () => {
        const response = await client.readResource({ uri: 'memory://health' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = getResourceText(response)
        const parsed = JSON.parse(text) as Record<string, unknown>

        // Phase 2 added a metrics subsection to the health resource.
        // Fields emitted: totalCalls, totalErrors, totalOutputTokens, upSince.
        expect(parsed).toHaveProperty('metrics')
        const metrics = parsed.metrics as Record<string, unknown>
        expect(typeof metrics.totalCalls).toBe('number')
        expect(typeof metrics.totalErrors).toBe('number')
        expect(typeof metrics.totalOutputTokens).toBe('number')
        expect(typeof metrics.upSince).toBe('string')
    })
})
