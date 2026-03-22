/**
 * E2E Tests: Code Mode Abuse & Timeouts
 *
 * Tests the worker sandbox's ability to terminate hung operations
 * (infinite loops, unresolving promises) without affecting the
 * HTTP transport layer or crashing the server.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Code Mode Abuse', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('mj_execute_code with infinite loop aborts via timeout instead of hanging HTTP', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: 'while(true) {}',
                timeout: 50 // Very sharp timeout for the test
            }
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)
        
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('timed out')
    })

    test('mj_execute_code with unresolving promise aborts via timeout', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: 'await new Promise(() => {})', // Never resolves
                timeout: 50
            }
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)
        
        expect(payload.success).toBe(false)
        // Unresolving promise causes worker exit (code 1) rather than the named timeout path
        const isTimeoutError = /timed out|Worker exited/i.test(String(payload.error))
        expect(isTimeoutError).toBe(true)
    })

    test('server handles subsequent valid Code Mode requests normally after worker drop', async () => {
        // This proves the transport stays up and worker pool recovers
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: 'return 1 + 1'  // Must use return; code is wrapped in (async () => { ${code} })()
            }
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)
        
        expect(payload.success).toBe(true)
        expect(payload.result).toBe(2)
    })
})
