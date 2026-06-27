/**
 * E2E Tests: Template Resource Reads via SDK Client
 *
 * Validates that all 8 template resources can be fetched by URI
 * without throwing a raw MCP protocol exception. Since the E2E test
 * environment has no GitHub token, GitHub-backed templates will return
 * structured error JSON rather than real data — both outcomes are valid.
 *
 * Also verifies memory://help/{group} returns per-group tool details.
 */

import { test, expect } from './test-fixture.js'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

test.describe.configure({ mode: 'serial' })

test.describe('E2E Resource Reads: Template Resources', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    /**
     * Read a template resource URI and assert we get a non-empty text response.
     * MCP protocol exceptions (thrown, not returned) are re-thrown so the test fails.
     * Structured JSON errors (returned as content) count as valid responses.
     */
    async function readTemplateResource(uri: string): Promise<string> {
        const response = await client.readResource({ uri })
        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)
        const text = (response.contents[0] as { text: string }).text
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
        return text
    }

    // --- memory://help/{group} — dynamic per-group tool reference ---

    test('memory://help/core returns per-group tool list', async () => {
        const text = await readTemplateResource('memory://help/core')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'core')
        expect(parsed).toHaveProperty('tools')
        expect(Array.isArray(parsed.tools)).toBe(true)
        expect(parsed.tools.length).toBeGreaterThanOrEqual(5)
    })

    test('memory://help/search returns search group tools', async () => {
        const text = await readTemplateResource('memory://help/search')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'search')
        expect(Array.isArray(parsed.tools)).toBe(true)
    })

    test('memory://help/github returns github group tools', async () => {
        const text = await readTemplateResource('memory://help/github')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'github')
        expect(Array.isArray(parsed.tools)).toBe(true)
        expect(parsed.tools.length).toBeGreaterThanOrEqual(16)
    })

    test('memory://help/team returns team group tools', async () => {
        const text = await readTemplateResource('memory://help/team')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'team')
        expect(Array.isArray(parsed.tools)).toBe(true)
        expect(parsed.tools.length).toBeGreaterThanOrEqual(20)
    })

    test('memory://help/codemode returns codemode group tools', async () => {
        const text = await readTemplateResource('memory://help/codemode')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('group', 'codemode')
        expect(Array.isArray(parsed.tools)).toBe(true)
        expect(parsed.tools.length).toBeGreaterThanOrEqual(1)
    })

    // --- GitHub-backed template resources (no token — structured error or data) ---

    test('memory://projects/1/timeline returns valid response', async () => {
        const text = await readTemplateResource('memory://projects/1/timeline')
        // Either a structured JSON error or a timeline object
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://issues/1/entries returns valid response', async () => {
        const text = await readTemplateResource('memory://issues/1/entries')
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://prs/1/entries returns valid response', async () => {
        const text = await readTemplateResource('memory://prs/1/entries')
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://prs/1/timeline returns valid response', async () => {
        const text = await readTemplateResource('memory://prs/1/timeline')
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://commits/1/by-issue returns valid response', async () => {
        const text = await readTemplateResource('memory://commits/1/by-issue')
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://commits/1/by-pr returns valid response', async () => {
        const text = await readTemplateResource('memory://commits/1/by-pr')
        expect(text.length).toBeGreaterThan(0)
    })

    test('memory://kanban/1 returns valid response', async () => {
        try {
            const result = await readTemplateResource('memory://kanban/1')
            // It might gracefully degrade and return a stringified JSON error
            expect(result).toMatch(/(error|Project #1 not found)/)
        } catch (error: any) {
            // Or it might throw an MCP error depending on the handler layer
            expect(error.message).toMatch(/(GitHub API not available|Bad credentials|Not Found)/)
        }
    })

    test('memory://kanban/1/diagram returns valid response', async () => {
        try {
            const result = await readTemplateResource('memory://kanban/1/diagram')
            expect(result).toMatch(/(error|Project #1 not found)/)
        } catch (error: any) {
            expect(error.message).toMatch(/(Invalid project number|GitHub API not available|Bad credentials|Not Found)/)
        }
    })

    test('memory://milestones/1 returns valid response', async () => {
        try {
            const result = await readTemplateResource('memory://milestones/1')
            expect(result).toMatch(/(error|Project #1 not found|Milestone #1 not found)/)
        } catch (error: any) {
            expect(error.message).toMatch(/(GitHub API not available|Bad credentials|Not Found)/)
        }
    })
})
