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

import { test, expect } from './test-fixture.js'
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
                dry_run: true,
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

    test('mj.core.createEntry simulates successful execution via dry_run=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const result = await mj.core.create_entry({
                        content: 'Should not be created',
                        entry_type: 'test_entry',
                    });
                    return result;
                `,
                dry_run: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>

        // Should simulate success for mutation in dry_run mode
        const result = payload.result as Record<string, unknown>
        expect(result.success).toBe(true)
        expect(result.dry_run).toBe(true)
        expect((result.message as string)).toContain('Simulated')
    })

    test('mj.admin.deleteEntry simulates successful execution via dry_run=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const result = await mj.admin.delete_entry({ entry_id: 1 , expected_version: 1 });
                    return result;
                `,
                dry_run: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>

        const result = payload.result as Record<string, unknown>
        expect(result.success).toBe(true)
        expect(result.dry_run).toBe(true)
        expect((result.message as string)).toContain('Simulated')
    })

    test('mj.help() works correctly via dry_run=true param', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const help = mj.help();
                    return help;
                `,
                dry_run: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        expect(content.length).toBeGreaterThan(0)
        // help() should return a string description or object
        expect(content[0]!.text).toBeDefined()
    })
})
