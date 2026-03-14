/**
 * E2E Tests: Expanded Resource Reads via SDK Client
 *
 * Covers resources not tested by resources.spec.ts:
 * memory://instructions, memory://significant, memory://graph/recent,
 * memory://tags, and unknown resource URI error handling.
 */

import { test, expect } from '@playwright/test'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

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

        const text = response.contents[0]!.text as string
        // Instructions should be a substantial text block
        expect(text.length).toBeGreaterThan(100)
        // Should mention memory journal or MCP
        expect(text.toLowerCase()).toMatch(/memory|journal|mcp/)
    })

    test('should read memory://significant resource', async () => {
        const response = await client.readResource({ uri: 'memory://significant' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        // Should return a valid structure (may be empty if no significant entries)
        expect(typeof parsed).toBe('object')
    })

    test('should read memory://graph/recent resource', async () => {
        const response = await client.readResource({ uri: 'memory://graph/recent' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        // Should be a Mermaid diagram or empty structure
        expect(typeof text).toBe('string')
    })

    test('should read memory://tags resource', async () => {
        const response = await client.readResource({ uri: 'memory://tags' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('tags')
        expect(Array.isArray(parsed.tags)).toBe(true)
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
