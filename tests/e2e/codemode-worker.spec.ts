import { test, expect } from './test-fixture.js'
import {
    startServer,
    stopServer,
    createClient,
    callToolAndParse,
} from './helpers.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

const WORKER_PORT = 5128 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)

test.describe.configure({ mode: 'serial' })

test.describe('Code Mode Worker-Thread Execution', () => {
    let client: Client

    test.beforeAll(async () => {
        process.env.CODEMODE_WORKER = 'true'
        await startServer(
            WORKER_PORT,
            ['--tool-filter', 'codemode,core'],
            'worker-mode'
        )
        client = await createClient(WORKER_PORT)
    })

    test.afterAll(async () => {
        if (client) await client.close()
        stopServer(WORKER_PORT)
        delete process.env.CODEMODE_WORKER
    })

    test('should successfully execute simple expressions in worker sandbox', async () => {
        const response = await callToolAndParse(client, 'mj_execute_code', {
            code: 'return 10 + 20',
        })

        // Expected format: { success: true, result: 30, metrics: {...} }
        const payload = response as unknown as { success: boolean; result: unknown; metrics: unknown }
        expect(payload.success).toBe(true)
        expect(payload.result).toBe(30)
        expect(payload.metrics).toBeDefined()
        expect((payload.metrics as any).wallTimeMs).toBeGreaterThanOrEqual(0)
    })

    test('should execute mj.* API tools in worker sandbox', async () => {
        const code = `
            const p = await mj.core.getRecentEntries({ limit: 1 });
            return p.entries ? true : false;
        `

        const response = await callToolAndParse(client, 'mj_execute_code', {
            code,
        })

        const payload = response as unknown as { success: boolean; result: unknown }
        expect(payload.success).toBe(true)
        expect(payload.result).toBe(true)
    })

    test('should enforce timeouts via ResourceLimits in worker sandbox', async () => {
        // A tight infinite loop that will trigger the hard timeout in worker_threads
        const code = `
            let x = 0;
            while (true) { x++; }
            return x;
        `

        const response = await callToolAndParse(client, 'mj_execute_code', {
            code,
            timeout_ms: 500, // Small timeout to ensure it hits fast
        })

        const payload = response as unknown as { success: boolean; error: string }
        expect(payload.success).toBe(false)
        expect(payload.error).toMatch(/timed out|Worker exited with code/i)
    })
})
