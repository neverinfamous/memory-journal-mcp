/**
 * E2E Tests: Expanded Prompt Coverage
 *
 * Tests 13 prompts not individually exercised by prompts.spec.ts:
 * session-summary, weekly-digest, prepare-retro, analyze-period,
 * goal-tracker, get-context-bundle, get-recent-entries, confirm-briefing,
 * and 6 GitHub prompts.
 */

import { test, expect } from '@playwright/test'
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

    function expectValidPrompt(response: { messages: Array<{ role: string; content: unknown }> }): void {
        expect(response.messages).toBeDefined()
        expect(Array.isArray(response.messages)).toBe(true)
        expect(response.messages.length).toBeGreaterThan(0)

        const first = response.messages[0]!
        expect(first).toHaveProperty('role')
        expect(first).toHaveProperty('content')
    }

    // --- Workflow prompts ---
    test('session-summary prompt', async () => {
        const response = await client.getPrompt({ name: 'session-summary', arguments: {} })
        expectValidPrompt(response)
    })

    test('weekly-digest prompt', async () => {
        const response = await client.getPrompt({ name: 'weekly-digest', arguments: {} })
        expectValidPrompt(response)
    })

    test('prepare-retro prompt', async () => {
        const response = await client.getPrompt({
            name: 'prepare-retro',
            arguments: {},
        })
        expectValidPrompt(response)
    })

    test('analyze-period prompt', async () => {
        const response = await client.getPrompt({
            name: 'analyze-period',
            arguments: {
                start_date: new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]!,
                end_date: new Date().toISOString().split('T')[0]!,
            },
        })
        expectValidPrompt(response)
    })

    test('goal-tracker prompt', async () => {
        const response = await client.getPrompt({ name: 'goal-tracker', arguments: {} })
        expectValidPrompt(response)
    })

    test('get-context-bundle prompt', async () => {
        const response = await client.getPrompt({
            name: 'get-context-bundle',
            arguments: { query: 'architecture' },
        })
        expectValidPrompt(response)
    })

    test('get-recent-entries prompt', async () => {
        const response = await client.getPrompt({ name: 'get-recent-entries', arguments: {} })
        expectValidPrompt(response)
    })

    test('confirm-briefing prompt', async () => {
        const response = await client.getPrompt({ name: 'confirm-briefing', arguments: {} })
        expectValidPrompt(response)
    })

    // --- GitHub prompts ---
    test('project-status-summary prompt', async () => {
        const response = await client.getPrompt({
            name: 'project-status-summary',
            arguments: { project_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('pr-summary prompt', async () => {
        const response = await client.getPrompt({
            name: 'pr-summary',
            arguments: { pr_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('code-review-prep prompt', async () => {
        const response = await client.getPrompt({
            name: 'code-review-prep',
            arguments: { pr_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('pr-retrospective prompt', async () => {
        const response = await client.getPrompt({
            name: 'pr-retrospective',
            arguments: { pr_number: '1' },
        })
        expectValidPrompt(response)
    })

    test('actions-failure-digest prompt', async () => {
        const response = await client.getPrompt({ name: 'actions-failure-digest', arguments: {} })
        expectValidPrompt(response)
    })

    test('project-milestone-tracker prompt', async () => {
        const response = await client.getPrompt({
            name: 'project-milestone-tracker',
            arguments: { project_number: '1' },
        })
        expectValidPrompt(response)
    })
})
