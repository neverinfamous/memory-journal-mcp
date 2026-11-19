import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/client'
import { createClient } from './helpers.js'

interface ProgressEventItem {
    progress: number
    total?: number
}

async function callToolWithProgress(
    client: Client,
    name: string,
    args: Record<string, unknown>,
    events: ProgressEventItem[]
): Promise<unknown> {
    const response = await client.callTool(
        { name, arguments: args },
        {
            onprogress: (progress) => {
                events.push({ progress: progress.progress, total: progress.total })
            },
        }
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    return response
}

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
        const notifications: ProgressEventItem[] = []
        const response = (await callToolWithProgress(
            client,
            'trigger_progress',
            {},
            notifications
        )) as { content: unknown[]; isError?: boolean }

        expect(response.content.length).toBeGreaterThan(0)
        expect(response.isError).toBeFalsy()
        expect(notifications.length).toBeGreaterThanOrEqual(3)

        expect(notifications[0]?.progress).toBe(0)
        expect(notifications[0]?.total).toBe(3)
        const last = notifications[notifications.length - 1]
        expect(last?.progress).toBeGreaterThanOrEqual(2)
        expect(last?.total).toBe(3)
    })

    test('mj_execute_code mj.reportProgress() sandbox binding emits progress notifications', async () => {
        const notifications: ProgressEventItem[] = []
        const code = [
            'const pause = () => new Promise((r) => setTimeout(r, 100));',
            'await mj.reportProgress(0, 3, "Starting workflow..."); await pause();',
            'await mj.reportProgress(1, 3, "Processing data..."); await pause();',
            'await mj.reportProgress(2, 3, "Finalizing..."); await pause();',
            'await mj.reportProgress(3, 3, "Workflow complete"); await pause();',
            'return { success: true, stepsReported: 4 };',
        ].join('\n')

        const res = (await callToolWithProgress(
            client,
            'mj_execute_code',
            { code },
            notifications
        )) as { isError?: boolean }
        expect(res.isError).toBeFalsy()
        expect(notifications.length).toBeGreaterThanOrEqual(3)
    })
})
