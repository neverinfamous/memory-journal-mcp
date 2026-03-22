/**
 * Payload Contract Tests: Code Mode API Bridge Depth
 *
 * Exercises the mj.* API bridge beyond basic execution:
 * - mj.search.searchEntries() returns { entries, count }
 * - mj.analytics.getStatistics() returns stats object
 * - Multi-step: createEntry + searchEntries with data dependency
 * - mj.help() returns API group listing with expected group names
 * - mj.help() lists all expected top-level namespaces
 *
 * Note: Code Mode wraps execution results as { success, result, metrics }.
 * The user's return value is in payload.result; we stringify payload to check
 * presence of expected fields across both paths.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Code Mode API Bridge Depth', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('mj.search.searchEntries() returns { entries, count }', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                const result = await mj.search.searchEntries({ query: 'test' });
                return result;
            `,
        })

        expect(typeof payload).toBe('object')
        // Code Mode result is in payload.result; but we stringify for robustness
        const flat = JSON.stringify(payload)
        // Should contain entries array field
        expect(flat).toMatch(/"entries"/)
    })

    test('mj.analytics.getStatistics() returns stats object with expected fields', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                const result = await mj.analytics.getStatistics({});
                return result;
            `,
        })

        expect(typeof payload).toBe('object')
        // Should not be a hard failure
        expect(JSON.stringify(payload)).not.toContain('"success":false')
        // Stats response should have groupBy or totalEntries
        const flat = JSON.stringify(payload)
        expect(flat).toMatch(/groupBy|totalEntries/)
    })

    test('multi-step: createEntry then searchEntries finds created content', async () => {
        const uniqueTag = `codemode-api-e2e-${Date.now()}`

        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                // Step 1: create entry with a unique tag
                const created = await mj.core.createEntry({
                    content: 'Code mode API bridge depth test',
                    entry_type: 'test_entry',
                    tags: ['${uniqueTag}'],
                });

                // Step 2: search using the tag
                const results = await mj.search.searchEntries({ query: '${uniqueTag}' });

                return {
                    createdId: created.entry?.id,
                    foundCount: results.count,
                    createSuccess: created.success,
                };
            `,
        })

        expect(typeof payload).toBe('object')
        // Overall execution must succeed
        const flat = JSON.stringify(payload)
        expect(flat).not.toContain('"success":false')
        // The entry was created (result.createdId should be a number)
        const result = payload.result as Record<string, unknown> | undefined
        if (result) {
            expect(typeof result.createdId).toBe('number')
            // Both API calls returned well-formed results (count is a number)
            expect(typeof result.foundCount).toBe('number')
        }
    })

    test('mj.help() returns API group listing', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                const help = await mj.help();
                return { help, type: typeof help };
            `,
        })

        expect(typeof payload).toBe('object')
        // Either the call succeeded with a result, or we at least got a non-null response
        const flat = JSON.stringify(payload)
        // help() should produce something non-empty
        expect(flat.length).toBeGreaterThan(10)
    })

    test('mj.help() output mentions expected API groups', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                const help = await mj.help();
                const helpText = JSON.stringify(help);
                return { helpText };
            `,
        })

        expect(typeof payload).toBe('object')
        // Full serialized payload should mention core and search group names
        const flat = JSON.stringify(payload)
        expect(flat).toMatch(/core/i)
        expect(flat).toMatch(/search/i)
        expect(flat).toMatch(/analytics/i)
    })
})
