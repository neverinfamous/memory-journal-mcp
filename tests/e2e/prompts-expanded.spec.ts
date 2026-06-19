/**
 * E2E Tests: Expanded Prompt Coverage
 *
 * Tests the remaining prompts not individually exercised by prompts.spec.ts:
 * goal-tracker, project-workflow, pr-workflow, actions-failure-digest,
 * adversarial-plan-review, and flag-dashboard.
 */

import { test, expect } from './test-fixture.js'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Prompts: Expanded Coverage', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    function expectValidPrompt(response: {
        messages: Array<{ role: string; content: unknown }>
    }): void {
        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)

        const first = response.messages[0]!
        expect(first).toHaveProperty('role')
        expect(first).toHaveProperty('content')
    }

    // --- Workflow prompts ---
    test('goal-tracker prompt', async () => {
        const response = await client.getPrompt({ name: 'goal-tracker', arguments: {} })
        expectValidPrompt(response)
    })

    // --- GitHub prompts ---
    test('issue-commander prompt', async () => {
        const response = await client.getPrompt({
            name: 'issue-commander',
            arguments: { project_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('pr-commander prompt', async () => {
        const response = await client.getPrompt({
            name: 'pr-commander',
            arguments: { pr_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('actions-failure-digest prompt', async () => {
        const response = await client.getPrompt({ name: 'actions-failure-digest', arguments: {} })
        expectValidPrompt(response)
    })

    // --- Adversarial & Team prompts ---
    test('adversarial-plan-review prompt', async () => {
        const response = await client.getPrompt({
            name: 'adversarial-plan-review',
            arguments: { topic: 'testing' },
        })
        expectValidPrompt(response)
    })

    test('flag-dashboard prompt', async () => {
        const response = await client.getPrompt({ name: 'flag-dashboard', arguments: {} })
        expectValidPrompt(response)
    })
})
