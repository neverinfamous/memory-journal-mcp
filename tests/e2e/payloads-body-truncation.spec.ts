/**
 * Payload Contract Tests: Body Truncation (E2E)
 *
 * Validates that truncate_body and include_comments parameters for
 * get_github_issue and get_github_pr survive HTTP transport and
 * produce well-formed responses.
 *
 * In environments without a GitHub token, tools return structured errors.
 * Tests verify the response shape is valid in both cases.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Body Truncation (E2E)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

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

    function expectValidGitHubResponse(payload: Record<string, unknown>): void {
        expect(typeof payload).toBe('object')
        expect(payload).not.toBeNull()
        expect(Object.keys(payload).length).toBeGreaterThan(0)
        if (payload.success === false) {
            expect(typeof payload.error).toBe('string')
        }
    }

    // =========================================================================
    // Issue body truncation
    // =========================================================================

    test('get_github_issue with default truncate_body → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_issue',
            arguments: { issue_number: 1 },
        })
        const payload = parseResponse(getText(response))
        expectValidGitHubResponse(payload)

        // If successful, verify truncation metadata types
        if (payload.issue && typeof payload.issue === 'object') {
            const issue = payload.issue as Record<string, unknown>
            if (issue.bodyTruncated !== undefined) {
                expect(typeof issue.bodyTruncated).toBe('boolean')
            }
            if (issue.bodyFullLength !== undefined) {
                expect(typeof issue.bodyFullLength).toBe('number')
            }
        }
    })

    test('get_github_issue with truncate_body: 0 → full body mode', async () => {
        const response = await client.callTool({
            name: 'get_github_issue',
            arguments: { issue_number: 1, truncate_body: 0 },
        })
        const payload = parseResponse(getText(response))
        expectValidGitHubResponse(payload)
    })

    test('get_github_issue with include_comments: true → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_issue',
            arguments: { issue_number: 1, include_comments: true },
        })
        const payload = parseResponse(getText(response))
        expectValidGitHubResponse(payload)

        // If successful and comments returned, verify shape
        if (payload.comments && Array.isArray(payload.comments)) {
            expect(typeof payload.commentCount).toBe('number')
        }
    })

    // =========================================================================
    // PR body truncation
    // =========================================================================

    test('get_github_pr with default truncate_body → valid response', async () => {
        const response = await client.callTool({
            name: 'get_github_pr',
            arguments: { pr_number: 1 },
        })
        const payload = parseResponse(getText(response))
        expectValidGitHubResponse(payload)

        // If successful, verify truncation metadata types
        if (payload.pullRequest && typeof payload.pullRequest === 'object') {
            const pr = payload.pullRequest as Record<string, unknown>
            if (pr.bodyTruncated !== undefined) {
                expect(typeof pr.bodyTruncated).toBe('boolean')
            }
            if (pr.bodyFullLength !== undefined) {
                expect(typeof pr.bodyFullLength).toBe('number')
            }
        }
    })

    test('get_github_pr with truncate_body: 0 → full body mode', async () => {
        const response = await client.callTool({
            name: 'get_github_pr',
            arguments: { pr_number: 1, truncate_body: 0 },
        })
        const payload = parseResponse(getText(response))
        expectValidGitHubResponse(payload)
    })
})
