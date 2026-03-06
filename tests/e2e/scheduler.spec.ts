/**
 * E2E Tests: Scheduler Activation
 *
 * Verifies that the automated scheduler is active and visible
 * in the memory://health resource when the server is started
 * with scheduler flags (--backup-interval, --vacuum-interval, etc.)
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

test.describe('Scheduler Activation (HTTP Only)', () => {
    let client: Client

    test.beforeAll(async () => {
        const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3100/mcp'))
        client = new Client(
            { name: 'playwright-scheduler-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('memory://health should show scheduler.active as true', async () => {
        const response = await client.readResource({ uri: 'memory://health' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = response.contents[0]!.text as string
        const health = JSON.parse(text)

        expect(health).toHaveProperty('scheduler')
        expect(health.scheduler).toHaveProperty('active', true)
    })

    test('memory://health should show 3 scheduler jobs', async () => {
        const response = await client.readResource({ uri: 'memory://health' })
        const health = JSON.parse(response.contents[0]!.text as string)

        expect(health.scheduler).toHaveProperty('jobs')
        expect(Array.isArray(health.scheduler.jobs)).toBe(true)
        expect(health.scheduler.jobs.length).toBe(3)

        const jobNames = health.scheduler.jobs.map((j: { name: string }) => j.name)
        expect(jobNames).toContain('backup')
        expect(jobNames).toContain('vacuum')
        expect(jobNames).toContain('rebuild-index')
    })

    test('scheduler jobs should have nextRun timestamps', async () => {
        const response = await client.readResource({ uri: 'memory://health' })
        const health = JSON.parse(response.contents[0]!.text as string)

        for (const job of health.scheduler.jobs) {
            expect(job).toHaveProperty('nextRun')
            // nextRun should be a valid ISO 8601 timestamp
            const nextRun = new Date(job.nextRun)
            expect(nextRun.toISOString()).toBe(job.nextRun)
            // nextRun should be in the future (or very close to now)
            expect(nextRun.getTime()).toBeGreaterThan(Date.now() - 60000)
        }
    })

    test('scheduler jobs should have run count fields', async () => {
        const response = await client.readResource({ uri: 'memory://health' })
        const health = JSON.parse(response.contents[0]!.text as string)

        for (const job of health.scheduler.jobs) {
            expect(job).toHaveProperty('runCount')
            expect(typeof job.runCount).toBe('number')
        }
    })
})
