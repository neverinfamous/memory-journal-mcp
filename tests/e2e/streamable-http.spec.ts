/**
 * E2E Tests: Streamable HTTP Transport (MCP 2025-03-26)
 *
 * Validates that the modern Streamable HTTP transport works with full
 * SDK round-trips: tools, resources, and prompts.
 *
 * The existing streaming.spec.ts tests raw SSE event format.
 * This spec validates SDK-level round-trips via Streamable HTTP.
 *
 * Ported from db-mcp/tests/e2e/streamable-http.spec.ts — adapted for memory-journal-mcp.
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, stopServer } from './helpers.js'

test.describe.configure({ mode: 'serial' })

const STREAM_PORT = 3108
const STREAM_BASE = `http://localhost:${STREAM_PORT}`

test.describe('Streamable HTTP Transport (MCP 2025-03-26)', () => {
    async function createStreamableClient() {
        const transport = new StreamableHTTPClientTransport(new URL(`${STREAM_BASE}/mcp`))
        const client = new Client(
            { name: 'playwright-streamable-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
        return client
    }

    test.beforeAll(async () => {
        await startServer(STREAM_PORT, [], 'streamable-http')
    })

    test.afterAll(() => {
        stopServer(STREAM_PORT)
    })

    test('should initialize via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            // Connection succeeded — Streamable HTTP handshake works
            const tools = await client.listTools()
            expect(tools.tools.length).toBeGreaterThan(0)
        } finally {
            await client.close()
        }
    })

    test('should list tools via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            const listResponse = await client.listTools()

            expect(listResponse.tools).toBeDefined()
            expect(Array.isArray(listResponse.tools)).toBe(true)
            expect(listResponse.tools.length).toBeGreaterThan(0)

            const names = listResponse.tools.map((t) => t.name)
            expect(names).toContain('create_entry')
            expect(names).toContain('search_entries')
        } finally {
            await client.close()
        }
    })

    test('should call a read tool via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            const response = await client.callTool({
                name: 'get_recent_entries',
                arguments: { limit: 5 },
            })

            expect(response.isError).toBeUndefined()
            expect(Array.isArray(response.content)).toBe(true)
            expect(response.content.length).toBeGreaterThan(0)
        } finally {
            await client.close()
        }
    })

    test('should call a write tool via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            const response = await client.callTool({
                name: 'create_entry',
                arguments: {
                    content: 'Streamable HTTP transport test entry',
                    entry_type: 'test_entry',
                },
            })

            expect(response.isError).toBeUndefined()
            expect(Array.isArray(response.content)).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('should list and read resources via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            const listResponse = await client.listResources()
            expect(listResponse.resources.length).toBeGreaterThan(0)

            // Read the recent entries resource
            const recentResource = await client.readResource({
                uri: 'memory://recent',
            })
            expect(recentResource.contents).toBeDefined()
            expect(recentResource.contents.length).toBeGreaterThan(0)
        } finally {
            await client.close()
        }
    })

    test('should list and get prompts via Streamable HTTP', async () => {
        const client = await createStreamableClient()
        try {
            const listResponse = await client.listPrompts()
            expect(listResponse.prompts.length).toBeGreaterThan(0)

            // Find a prompt without required arguments, or provide args for one that does
            const firstPrompt = listResponse.prompts[0]

            // Build arguments: supply a default string for any required argument
            const args: Record<string, string> = {}
            if (firstPrompt.arguments) {
                for (const arg of firstPrompt.arguments) {
                    if (arg.required) {
                        args[arg.name] = 'test'
                    }
                }
            }

            const prompt = await client.getPrompt({
                name: firstPrompt.name,
                arguments: args,
            })
            expect(prompt.messages).toBeDefined()
            expect(prompt.messages.length).toBeGreaterThan(0)
        } finally {
            await client.close()
        }
    })
})
