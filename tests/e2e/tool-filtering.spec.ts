/**
 * E2E Tests: Tool Filtering
 *
 * Launches a server with --tool-filter starter and validates that
 * only the expected subset of tools is exposed.
 *
 * Uses a dedicated server on port 3104.
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, stopServer } from './helpers.js'

const FILTER_PORT = 3104

test.describe('Tool Filtering', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(FILTER_PORT, ['--tool-filter', 'starter'], 'tool-filter')

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${FILTER_PORT}/mcp`)
        )
        client = new Client({ name: 'tool-filter-test', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(FILTER_PORT)
    })

    test('should expose only starter tools (not all 44)', async () => {
        const response = await client.listTools()

        expect(response.tools).toBeDefined()
        expect(Array.isArray(response.tools)).toBe(true)
        // Starter preset has ~11 tools (core+search+codemode), not the full 44+
        expect(response.tools.length).toBeLessThan(20)
        expect(response.tools.length).toBeGreaterThan(3)
    })

    test('should include core tools in starter preset', async () => {
        const response = await client.listTools()
        const names = response.tools.map((t) => t.name)

        expect(names).toContain('create_entry')
        expect(names).toContain('get_recent_entries')
    })

    test('should include codemode in starter preset', async () => {
        const response = await client.listTools()
        const names = response.tools.map((t) => t.name)

        // starter = ['core', 'search', 'codemode'] — codemode is always auto-injected into shortcuts
        expect(names).toContain('mj_execute_code')
    })

    test('should exclude github tools in starter preset', async () => {
        const response = await client.listTools()
        const names = response.tools.map((t) => t.name)

        expect(names).not.toContain('get_github_issues')
        expect(names).not.toContain('get_github_prs')
        expect(names).not.toContain('get_kanban_board')
    })

    test('should exclude admin tools in starter preset', async () => {
        const response = await client.listTools()
        const names = response.tools.map((t) => t.name)

        expect(names).not.toContain('delete_entry')
        expect(names).not.toContain('rebuild_vector_index')
    })
})
