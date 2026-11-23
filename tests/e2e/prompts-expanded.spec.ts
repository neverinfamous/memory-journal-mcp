/**
 * E2E Tests: Expanded Prompt Coverage
 *
 * Tests the remaining prompts not individually exercised by prompts.spec.ts:
 * goal-tracker, project-workflow, pr-workflow, actions-failure-digest,
 * adversarial-plan-review, and flag-dashboard.
 */

import { test, expect } from './test-fixture.js'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/client'

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

    // --- CMS & Optimizer prompts ---
    test('optimize-journal prompt in full unattended mode', async () => {
        const response = await client.getPrompt({
            name: 'optimize-journal',
            arguments: { mode: 'full', autoRun: 'true', limit: '0' },
        })
        expectValidPrompt(response)
    })

    test('cms-rem-supervisor prompt', async () => {
        const response = await client.getPrompt({
            name: 'cms-rem-supervisor',
            arguments: { lookbackHours: '24' },
        })
        expectValidPrompt(response)
    })

    test('listPrompts returns all 32 registered prompts', async () => {
        const { prompts } = await client.listPrompts()
        expect(prompts).toHaveLength(32)
    })

    test('every registered prompt resolves non-empty user text messages', async () => {
        const sampleValues: Record<string, string> = {
            pr_number: '1',
            project_number: '1',
            workspace_id: 'default',
            topic: 'testing',
            target: 'src/index.ts',
        }
        const { prompts } = await client.listPrompts()

        for (const prompt of prompts) {
            const args: Record<string, string> = {}
            for (const arg of prompt.arguments ?? []) {
                const sample = sampleValues[arg.name]
                if (sample !== undefined) {
                    args[arg.name] = sample
                }
            }
            const response = await client.getPrompt({ name: prompt.name, arguments: args })
            expectValidPrompt(response)
            const first = response.messages[0]
            expect(first?.role, `${prompt.name} role`).toBe('user')
            const content = first?.content as { type?: unknown; text?: unknown } | undefined
            expect(content?.type, `${prompt.name} content type`).toBe('text')
            expect(typeof content?.text === 'string' && content.text.length > 0, `${prompt.name} empty text`).toBe(true)
        }
    })

    test('load-briefing reports unknown project gracefully and nonexistent-prompt rejects', async () => {
        const unknownProject = await client.getPrompt({
            name: 'load-briefing',
            arguments: { projects: 'nonexistent-project-xyz' },
        })
        expectValidPrompt(unknownProject)
        const text = (unknownProject.messages[0]?.content as { text?: string } | undefined)?.text ?? ''
        expect(text).toMatch(/not found/i)

        await expect(
            client.getPrompt({ name: 'nonexistent-prompt', arguments: {} })
        ).rejects.toThrow()
    })
})
