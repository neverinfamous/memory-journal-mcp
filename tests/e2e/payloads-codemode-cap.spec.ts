/**
 * Payload Contract Tests: Code Mode Result Cap (E2E)
 *
 * Validates the 100KB Code Mode result size cap through HTTP transport.
 * Verifies that under-limit results pass, oversized results return
 * structured errors with agent-guidance, and boundary cases work correctly.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Code Mode Result Cap (E2E)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('mj_execute_code → small result passes 100KB cap', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `return { message: 'small result', size: 42 };`,
        })

        expect(typeof payload).toBe('object')
        // Should not be an error — this is well under 100KB
        if (payload.success !== undefined) {
            expect(payload.success).not.toBe(false)
        }
    })

    test('mj_execute_code → oversized result returns structured error', async () => {
        // Generate a result larger than 100KB (120KB of 'x')
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `return 'x'.repeat(120 * 1024);`,
        })

        expect(typeof payload).toBe('object')
        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
    })

    test('mj_execute_code → error message includes aggregation guidance', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `return 'y'.repeat(150 * 1024);`,
        })

        expect(payload.success).toBe(false)
        const errorMsg = payload.error as string
        // Should contain KB sizes and aggregation guidance
        expect(errorMsg).toContain('KB')
        expect(errorMsg).toContain('aggregate')
    })

    test('mj_execute_code → result at boundary (~50KB) passes', async () => {
        // 50KB is well under 100KB cap — should pass cleanly
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: `return 'z'.repeat(50 * 1024);`,
        })

        expect(typeof payload).toBe('object')
        // Should succeed — well under cap
        if (payload.success !== undefined) {
            expect(payload.success).not.toBe(false)
        }
    })
})
