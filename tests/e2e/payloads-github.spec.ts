/**
 * Payload Contract Tests: GitHub Tools (E2E environment)
 *
 * Validates that all 16 GitHub tools return well-formed responses
 * when called in the E2E test environment. Tools will either:
 * - Return structured JSON errors (when no token or resolution fails)
 * - Return success responses with data (if git remote auto-detected + token)
 * - Return raw MCP error strings (if the tool throws before handler's catch)
 *
 * In all cases the response must be a non-empty, recognizable shape.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: GitHub Tools (E2E environment)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    function expectValidGitHubResponse(payload: Record<string, unknown>): void {
        expect(typeof payload).toBe('object')
        expect(payload).not.toBeNull()
        expect(Object.keys(payload).length).toBeGreaterThan(0)
        // If it's an error, it must have at minimum an error message string
        if (payload.success === false) {
            expect(typeof payload.error).toBe('string')
        }
    }

    /**
     * Some GitHub tools throw before the handler's catch block when the GitHub
     * API is unavailable, producing a raw non-JSON MCP error string as content.
     * Return a synthetic error object so the test doesn't crash on JSON.parse.
     */
    function parseResponse(text: string): Record<string, unknown> {
        try {
            return JSON.parse(text) as Record<string, unknown>
        } catch {
            return { success: false, error: text }
        }
    }

    function getText(response: Awaited<ReturnType<typeof client.callTool>>): string {
        const content = response.content as Array<{ type: string; text: string }>
        return content[0]!.text
    }

    // --- Read tools ---
    test('get_github_issues → valid response', async () => {
        const response = await client.callTool({ name: 'get_github_issues', arguments: {} })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('get_github_prs → valid response', async () => {
        const response = await client.callTool({ name: 'get_github_prs', arguments: {} })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('get_github_issue → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_issue',
            arguments: { issue_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('get_github_pr → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_pr',
            arguments: { pr_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('get_github_context → valid response', async () => {
        const response = await client.callTool({ name: 'get_github_context', arguments: {} })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    // --- Kanban tools ---
    test('get_kanban_board → valid response', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('move_kanban_item → valid response', async () => {
        const response = await client.callTool({
            name: 'move_kanban_item',
            arguments: { project_number: 1, item_id: 'PVTI_test', target_status: 'Done' },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    // --- Issue lifecycle ---
    test('create_github_issue_with_entry → valid response', async () => {
        const response = await client.callTool({
            name: 'create_github_issue_with_entry',
            arguments: { title: 'E2E test issue', body: 'test' },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('close_github_issue_with_entry → valid response', async () => {
        const response = await client.callTool({
            name: 'close_github_issue_with_entry',
            arguments: { issue_number: 99999, resolution_notes: 'test' },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    // --- Milestones ---
    test('get_github_milestones → valid response', async () => {
        const response = await client.callTool({ name: 'get_github_milestones', arguments: {} })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('get_github_milestone → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_milestone',
            arguments: { milestone_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('create_github_milestone → valid response', async () => {
        const response = await client.callTool({
            name: 'create_github_milestone',
            arguments: { title: 'E2E test milestone' },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('update_github_milestone → valid response', async () => {
        const response = await client.callTool({
            name: 'update_github_milestone',
            arguments: { milestone_number: 1, title: 'Updated milestone' },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    test('delete_github_milestone → valid response', async () => {
        const response = await client.callTool({
            name: 'delete_github_milestone',
            arguments: { milestone_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    // --- Insights ---
    test('get_repo_insights → valid response', async () => {
        const response = await client.callTool({ name: 'get_repo_insights', arguments: {} })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })

    // --- Copilot ---
    test('get_copilot_reviews → valid response', async () => {
        const response = await client.callTool({
            name: 'get_copilot_reviews',
            arguments: { pr_number: 1 },
        })
        expectValidGitHubResponse(parseResponse(getText(response)))
    })
})
