/**
 * E2E Tests: Code Mode Abuse & Timeouts
 *
 * Tests the worker sandbox's ability to terminate hung operations
 * (infinite loops, unresolving promises) without affecting the
 * HTTP transport layer or crashing the server.
 */

import { test, expect } from './test-fixture.js'
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
                timeout_ms: 50, // Very sharp timeout for the test
            },
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
                timeout_ms: 50,
            },
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
                code: 'return 1 + 1', // Must use return; code is wrapped in (async () => { ${code} })()
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)

        expect(payload.success).toBe(true)
        expect(payload.result).toBe(2)
    })

    test('mj_execute_code proxy maintains invariants on frozen target', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    const keys = Object.keys(mj);
                    const desc = Object.getOwnPropertyDescriptor(mj, 'core');
                    return { keys, hasCore: !!desc };
                `
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)

        expect(payload.success).toBe(true)
        expect(payload.result.hasCore).toBe(true)
        expect(Array.isArray(payload.result.keys)).toBe(true)
        expect(payload.result.keys.length).toBeGreaterThan(0)
    })

    test('mj_execute_code prevents API mutation and prototype pollution', async () => {
        const response = await client.callTool({
            name: 'mj_execute_code',
            arguments: {
                code: `
                    "use strict";
                    try {
                        mj.core.newMethod = () => "hacked";
                        return "mutation succeeded";
                    } catch(e) {
                        try {
                            Object.defineProperty(mj, "hacked", { value: true });
                            return "defineProperty succeeded";
                        } catch(e2) {
                            return "mutation blocked: " + e2.message;
                        }
                    }
                `
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse((response.content as Array<{ text: string }>)[0]!.text)

        expect(payload.success).toBe(true)
        expect(payload.result).toContain('mutation blocked')
    })
})
