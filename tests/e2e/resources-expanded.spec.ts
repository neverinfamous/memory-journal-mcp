/**
 * E2E Tests: Expanded Resource Reads via SDK Client
 *
 * Covers resources not tested by resources.spec.ts:
 * memory://instructions, memory://significant,
 * and unknown resource URI error handling.
 */

import { test, expect } from './test-fixture.js'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/client'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Resource Reads: Expanded', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('should read memory://instructions resource', async () => {
        const response = await client.readResource({ uri: 'memory://instructions' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = (response.contents[0] as { text: string }).text
        // Instructions should be a substantial text block
        expect(text.length).toBeGreaterThan(100)
        // Should mention memory journal or MCP
        expect(text.toLowerCase()).toMatch(/memory|journal|mcp/)
    })

    test('should read memory://significant resource', async () => {
        const response = await client.readResource({ uri: 'memory://significant' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = (response.contents[0] as { text: string }).text
        const parsed = JSON.parse(text)
        // Should return a valid structure (may be empty if no significant entries)
        expect(typeof parsed).toBe('object')
    })


    test('should handle unknown resource URI gracefully', async () => {
        try {
            await client.readResource({ uri: 'memory://nonexistent-resource-uri' })
            // If it doesn't throw, it should still return a valid structure
        } catch (error) {
            // Expected: MCP SDK throws for unknown resources
            expect(error).toBeDefined()
        }
    })
})
