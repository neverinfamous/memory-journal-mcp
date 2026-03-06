/**
 * E2E Tests: MCP Resource Reads via SDK Client
 *
 * Uses the official @modelcontextprotocol/sdk client to connect
 * via Streamable HTTP transport and read resources end-to-end.
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Resource Reads (via MCP SDK Client)', () => {
    let client: Client

    test.beforeAll(async () => {
        const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3100/mcp'))
        client = new Client(
            { name: 'playwright-resource-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('should list available resources', async () => {
        const listResponse = await client.listResources()

        expect(listResponse.resources).toBeDefined()
        expect(Array.isArray(listResponse.resources)).toBe(true)
        expect(listResponse.resources.length).toBeGreaterThan(0)

        const uris = listResponse.resources.map((r) => r.uri)
        expect(uris).toContain('memory://health')
        expect(uris).toContain('memory://briefing')
        expect(uris).toContain('memory://recent')
        expect(uris).toContain('memory://statistics')
    })

    test('should read memory://health resource', async () => {
        const response = await client.readResource({ uri: 'memory://health' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('database')
        expect(parsed).toHaveProperty('vectorIndex')
        expect(parsed).toHaveProperty('scheduler')
    })

    test('should read memory://briefing resource', async () => {
        const response = await client.readResource({ uri: 'memory://briefing' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('userMessage')
        expect(parsed).toHaveProperty('journal')
    })

    test('should read memory://recent resource', async () => {
        const response = await client.readResource({ uri: 'memory://recent' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        // May be empty if no entries exist, but should be valid JSON
        expect(parsed).toBeDefined()
    })

    test('should read memory://statistics resource', async () => {
        const response = await client.readResource({ uri: 'memory://statistics' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('totalEntries')
    })

    test('should list resource templates', async () => {
        const response = await client.listResourceTemplates()

        expect(response.resourceTemplates).toBeDefined()
        expect(Array.isArray(response.resourceTemplates)).toBe(true)
        expect(response.resourceTemplates.length).toBeGreaterThan(0)

        const uriTemplates = response.resourceTemplates.map((t) => t.uriTemplate)
        expect(uriTemplates).toContain('memory://issues/{issue_number}/entries')
        expect(uriTemplates).toContain('memory://kanban/{project_number}')
    })
})
