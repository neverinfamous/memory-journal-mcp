/**
 * E2E Tests: MCP Prompts via SDK Client
 *
 * Validates prompt listing and retrieval via the Streamable HTTP transport.
 */

import { test, expect } from './test-fixture.js'
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
        expect(response.prompts.length).toBeGreaterThanOrEqual(8)

        const promptNames = response.prompts.map((p) => p.name)
        expect(promptNames).toContain('time-period-analysis')
        expect(promptNames).toContain('session-summary')
        expect(promptNames).toContain('project-workflow')
        expect(promptNames).toContain('pr-workflow')
        expect(promptNames).toContain('actions-failure-digest')
        expect(promptNames).toContain('adversarial-plan-review')
    })

    test('should get a specific prompt (time-period-analysis)', async () => {
        const response = await client.getPrompt({ name: 'time-period-analysis', arguments: { period_type: 'daily' } })

        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)

        // Each message should have role and content
        const firstMessage = response.messages[0]!
        expect(firstMessage).toHaveProperty('role')
        expect(firstMessage).toHaveProperty('content')
    })

    test('should get a parameterized prompt (session-summary)', async () => {
        const response = await client.getPrompt({
            name: 'session-summary',
            arguments: { target: 'personal' },
        })

        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)
    })
})
