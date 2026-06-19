/**
 * E2E Tests: MCP Tool Execution via SDK Client
 *
 * Uses the official @modelcontextprotocol/sdk client to connect
 * via Streamable HTTP transport and execute tools end-to-end.
 */

import { test, expect } from './test-fixture.js'
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

    test('should execute create_entry and get structured response', async () => {
        const response = await client.callTool({
            name: 'create_entry',
            arguments: { 
                project_number: 1, 
                content: 'Playwright e2e test entry',
                trust_score: 0.8,
                impact_score: 0.5,
                validation_status: 'passed'
            },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)
        expect((response.content as any[]).length).toBeGreaterThan(0)

        const parsed = getOutput(response) as any
        expect(parsed).toHaveProperty('success', true)
        expect(parsed).toHaveProperty('entry')
        expect(parsed.entry).toHaveProperty('id')
        expect(parsed.entry).toHaveProperty('trustScore', 0.8)
        expect(parsed.entry).toHaveProperty('impactScore', 0.5)
        expect(parsed.entry).toHaveProperty('validationStatus', 'passed')
    })

    test('should execute mark_anchors_stale tool', async () => {
        const response = await client.callTool({
            name: 'mark_anchors_stale',
            arguments: { updates: [{ id: 999999, status: 'stale' }] }, // It will execute but just update 0 rows in DB realistically, or maybe error depending on DB schema, but we just verify it executes without schema errors
        })

        expect(response.isError).toBeUndefined()
        const parsed = getOutput(response) as any
        expect(parsed).toHaveProperty('success', true)
        expect(parsed).toHaveProperty('updated_count', 1)
    })

    test('should execute get_recent_entries and return entries array', async () => {
        const response = await client.callTool({
            name: 'get_recent_entries',
            arguments: { project_number: 1, limit: 3 },
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
                project_number: 1,
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
