/**
 * Payload Contract Tests: Sandbox Limits
 *
 * Validates that mj_execute_code cleanly terminates operations
 * exceeding the execution timeout.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Sandbox Limits', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('Code Mode MUST cleanly terminate infinite loops', async () => {
        const start = Date.now()
        // Provide a timeout of 1000ms
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: 'while(true){}',
            timeout: 1000,
        })
        const duration = Date.now() - start

        expect(payload.success).toBe(false)
        expect(duration).toBeLessThan(3000)
    })

    test('Code Mode MUST terminate long-running synchronous code', async () => {
        const payload = await callToolAndParse(client, 'mj_execute_code', {
            code: 'const end = Date.now() + 5000; while(Date.now() < end) {}',
            timeout: 1000,
        })

        expect(payload.success).toBe(false)
    })
})
