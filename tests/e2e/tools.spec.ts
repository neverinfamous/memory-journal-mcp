/**
 * E2E Tests: MCP Tool Execution via SDK Client
 *
 * Uses the official @modelcontextprotocol/sdk client to connect
 * via Streamable HTTP transport and execute tools end-to-end.
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Tool Execution (via MCP SDK Client)', () => {
    let client: Client

    test.beforeAll(async () => {
        const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3100/mcp'))
        client = new Client(
            { name: 'playwright-tool-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('should list available tools', async () => {
        const listResponse = await client.listTools()

        expect(listResponse.tools).toBeDefined()
        expect(Array.isArray(listResponse.tools)).toBe(true)
        expect(listResponse.tools.length).toBeGreaterThan(0)

        const toolNames = listResponse.tools.map((t) => t.name)
        expect(toolNames).toContain('create_entry')
        expect(toolNames).toContain('search_entries')
        expect(toolNames).toContain('get_recent_entries')
    })

    function getOutput(response: any): string | Record<string, unknown> {
        const text = (response.content[0] as { text: string }).text
        if (text === '[Structured output attached]' && 'structuredContent' in response) {
            return response.structuredContent as Record<string, unknown>
        }
        try {
            return JSON.parse(text)
        } catch {
            return text
        }
    }

    test('should execute create_entry_minimal and get structured response', async () => {
        const response = await client.callTool({
            name: 'create_entry_minimal',
            arguments: { content: 'Playwright e2e test entry' },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)
        expect((response.content as any[]).length).toBeGreaterThan(0)

        const parsed = getOutput(response) as any
        expect(parsed).toHaveProperty('success', true)
        expect(parsed).toHaveProperty('entry')
        expect(parsed.entry).toHaveProperty('id')
    })

    test('should execute get_recent_entries and return entries array', async () => {
        const response = await client.callTool({
            name: 'get_recent_entries',
            arguments: { limit: 3 },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)
        expect((response.content as any[]).length).toBeGreaterThan(0)

        const parsed = getOutput(response) as any
        expect(parsed).toHaveProperty('entries')
        expect(Array.isArray(parsed.entries)).toBe(true)
    })

    test('should return structured error for invalid entry_type', async () => {
        const response = await client.callTool({
            name: 'create_entry',
            arguments: {
                content: 'test validation',
                entry_type: 'invalid_type',
            },
        })

        // Should NOT be a raw MCP error — should be structured handler error
        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)

        const parsed = getOutput(response) as any
        expect(parsed).toHaveProperty('success', false)
        expect(parsed).toHaveProperty('error')
        expect(parsed.error).toContain('entry_type')
    })
})
