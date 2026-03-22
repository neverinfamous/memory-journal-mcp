/**
 * Payload Contract Tests: Code Mode Readonly Enforcement
 *
 * Tests that mj_execute_code with readonly=true correctly
 * returns structured errors for mutation attempts instead of
 * TypeError or undefined behavior.
 *
 * Uses the standard E2E server (port 3100) with the built-in
 * readonly parameter on mj_execute_code (not --tool-filter readonly
 * which would exclude mj_execute_code entirely).
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient } from './helpers.js'

test.describe('Code Mode Readonly Enforcement', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('read operations succeed with readonly=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const recent = await mj.core.getRecentEntries({ limit: 1 });
                    return recent;
                `,
                readonly: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        expect(content.length).toBeGreaterThan(0)
        expect(content[0]!.type).toBe('text')
        // Read should succeed — no error
        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>
        // Should have entries/count fields, not a structured error
        expect(payload.success).not.toBe(false)
    })

    test('mj.core.createEntry raises structured error via readonly=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const result = await mj.core.createEntry({
                        content: 'Should not be created',
                        entry_type: 'test_entry',
                    });
                    return result;
                `,
                readonly: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>

        // Should be a structured error, not a TypeError
        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
        // Error message mentions either "not available", "not found in group", or "read-only"
        expect((payload.error as string).toLowerCase()).toMatch(
            /not available|not found in group|readonly|read.only/i
        )
    })

    test('mj.admin.deleteEntry raises structured error via readonly=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const result = await mj.admin.deleteEntry({ entry_id: 1 });
                    return result;
                `,
                readonly: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>

        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
    })

    test('mj.help() works correctly via readonly=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const help = mj.help();
                    return help;
                `,
                readonly: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        expect(content.length).toBeGreaterThan(0)
        // help() should return a string description or object
        expect(content[0]!.text).toBeDefined()
    })
})
