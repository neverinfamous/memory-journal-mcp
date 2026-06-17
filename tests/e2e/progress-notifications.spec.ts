import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
    CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createClient } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Progress Notifications (Transport Layer)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('trigger_progress emits progress events', async () => {
        const notifications: Array<{ progress: number; total?: number }> = []

        const response = await client.callTool(
            {
                name: 'trigger_progress',
                arguments: {},
            },
            CallToolResultSchema,
            {
                onprogress: (progress) => {
                    notifications.push({
                        progress: progress.progress,
                        total: progress.total,
                    })
                },
            }
        )

        // Wait a brief moment to allow SSE stream to flush any trailing notifications
        await new Promise((resolve) => setTimeout(resolve, 500))

        const result = response as { content: unknown[]; isError?: boolean }
        expect(result.content.length).toBeGreaterThan(0)
        expect(result.isError).toBeFalsy()

        // Verify progress notifications were emitted and received over the transport
        expect(notifications.length).toBeGreaterThanOrEqual(3)
        
        // Check the first one
        expect(notifications[0]!.progress).toBe(0)
        expect(notifications[0]!.total).toBe(3)
        
        // The last notification should be completion
        const last = notifications[notifications.length - 1]!
        expect(last.progress).toBeGreaterThanOrEqual(2)
        expect(last.total).toBe(3)
    })
})
