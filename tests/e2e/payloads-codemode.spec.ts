/**
 * Payload Contract Tests: Code Mode
 *
 * Validates mj_execute_code (Code Mode) execution, multi-step workflows,
 * security rejection, and timeout enforcement via E2E.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Code Mode', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('should execute basic code via mj_execute_code', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                const result = await mj.core.testSimple({ message: 'code-mode-e2e' });
                return result;
            `,
        })

        expect(typeof payload).toBe('object')
        // The result should contain the test_simple response
        expect(JSON.stringify(payload)).toContain('code-mode-e2e')
    })

    test('should execute multi-step workflow in single execution', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `
                // Step 1: Create an entry
                const created = await mj.core.createEntry({
                    content: 'Code mode multi-step test',
                    entry_type: 'test_entry',
                    tags: ['codemode-test'],
                });

                // Step 2: Retrieve recent entries
                const recent = await mj.core.getRecentEntries({ limit: 1 });

                return {
                    created: created.success,
                    recentCount: recent.count,
                };
            `,
        })

        expect(typeof payload).toBe('object')
    })

    test('should reject code with blocked patterns (require)', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `const fs = require('fs'); return fs.readFileSync('/etc/passwd');`,
            },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)

        const text = (response.content[0] as { type: string; text: string }).text
        const parsed = JSON.parse(text)

        // Should return a structured error with security failure
        expect(parsed.success).toBe(false)
        expect(parsed.error).toBeDefined()
    })

    test('should reject code with blocked patterns (process)', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `return process.env;`,
            },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)

        const text = (response.content[0] as { type: string; text: string }).text
        const parsed = JSON.parse(text)

        expect(parsed.success).toBe(false)
        expect(parsed.error).toBeDefined()
    })

    test('should enforce execution timeout', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `while (true) {}`,
                timeout: 1,
            },
        })

        expect(response.isError).toBeUndefined()
        expect(Array.isArray(response.content)).toBe(true)

        const text = (response.content[0] as { type: string; text: string }).text
        const parsed = JSON.parse(text)

        // Should report timeout or execution failure
        expect(parsed.success).toBe(false)
    })
})
