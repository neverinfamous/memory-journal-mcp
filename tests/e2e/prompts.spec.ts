/**
 * E2E Tests: MCP Prompts via SDK Client
 *
 * Validates prompt listing and retrieval via the Streamable HTTP transport.
 */

import { test, expect } from '@playwright/test'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Prompts (via MCP SDK Client)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('should list all available prompts', async () => {
        const response = await client.listPrompts()

        expect(response.prompts).toBeDefined()
        expect(Array.isArray(response.prompts)).toBe(true)
        expect(response.prompts.length).toBeGreaterThanOrEqual(16)

        const promptNames = response.prompts.map((p) => p.name)
        expect(promptNames).toContain('prepare-standup')
        expect(promptNames).toContain('session-summary')
        expect(promptNames).toContain('weekly-digest')
        expect(promptNames).toContain('find-related')
        expect(promptNames).toContain('confirm-briefing')
    })

    test('should get a specific prompt (prepare-standup)', async () => {
        const response = await client.getPrompt({ name: 'prepare-standup' })

        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)

        // Each message should have role and content
        const firstMessage = response.messages[0]!
        expect(firstMessage).toHaveProperty('role')
        expect(firstMessage).toHaveProperty('content')
    })

    test('should get a parameterized prompt (find-related)', async () => {
        const response = await client.getPrompt({
            name: 'find-related',
            arguments: { query: 'performance optimization' },
        })

        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)
    })
})
