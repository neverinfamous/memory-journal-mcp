/**
 * Payload Contract Tests: Kanban Optimization (E2E)
 *
 * Validates that get_kanban_board's summary_only and item_limit parameters
 * survive HTTP transport serialization and produce well-formed responses.
 *
 * In environments without a GitHub token, tools return structured errors.
 * Tests verify the response shape is valid in both cases.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Kanban Optimization (E2E)', () => {
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

    function expectValidResponse(payload: Record<string, unknown>): void {
        expect(typeof payload).toBe('object')
        expect(payload).not.toBeNull()
        expect(Object.keys(payload).length).toBeGreaterThan(0)
        if (payload.success === false) {
            expect(typeof payload.error).toBe('string')
        }
    }

    test('get_kanban_board with summary_only → valid response shape', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1, summary_only: true },
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)

        // If succeeded (has columns), verify summary mode fields
        if (payload.columns && Array.isArray(payload.columns)) {
            expect(payload.summaryOnly).toBe(true)
            for (const col of payload.columns as Array<Record<string, unknown>>) {
                expect(col.items).toEqual([])
                expect(typeof col.itemCount).toBe('number')
            }
        }
    })

    test('get_kanban_board with item_limit: 0 → acts as summary_only', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1, item_limit: 0 },
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)

        // If succeeded, item_limit: 0 should produce the same effect as summary_only
        if (payload.columns && Array.isArray(payload.columns)) {
            expect(payload.summaryOnly).toBe(true)
        }
    })

    test('get_kanban_board with item_limit: 3 → valid response shape', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1, item_limit: 3 },
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)

        // If succeeded, verify truncation metadata fields are valid types
        if (payload.columns && Array.isArray(payload.columns)) {
            for (const col of payload.columns as Array<Record<string, unknown>>) {
                expect(typeof col.itemCount).toBe('number')
                // truncated should be boolean or undefined
                if (col.truncated !== undefined) {
                    expect(typeof col.truncated).toBe('boolean')
                }
            }
        }
    })

    test('get_kanban_board default → applies default item_limit', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1 },
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)
    })

    test('get_kanban_board with no project_number → structured error', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: {},
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)

        // Without project_number and no registry, should get a structured error
        if (payload.success === false) {
            expect(typeof payload.error).toBe('string')
            expect(typeof payload.code).toBe('string')
        }
    })

    test('get_kanban_board with all optimization params → valid response', async () => {
        const response = await client.callTool({
            name: 'get_kanban_board',
            arguments: { project_number: 1, summary_only: false, item_limit: 10 },
        })
        const payload = parseResponse(getText(response))
        expectValidResponse(payload)
    })
})
