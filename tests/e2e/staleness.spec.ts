import { test, expect } from './test-fixture.js'
import { createClient } from './helpers.js'
import type { Client } from '@modelcontextprotocol/client'

test.describe('E2E Resource Reads: Staleness', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    async function readResource(uri: string): Promise<string> {
        const response = await client.readResource({ uri })
        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)
        const text = (response.contents[0] as { text: string }).text
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
        return text
    }

    test('memory://staleness returns valid response', async () => {
        const text = await readResource('memory://staleness')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('thresholds')
        expect(parsed).toHaveProperty('projects')
        expect(parsed.projects).toHaveProperty('active')
        expect(parsed.projects).toHaveProperty('recent')
        expect(parsed.projects).toHaveProperty('stale')
        expect(parsed.projects).toHaveProperty('inactive')
    })

    test('memory://staleness/1 returns valid response', async () => {
        const text = await readResource('memory://staleness/1')
        const parsed = JSON.parse(text)
        expect(parsed).toHaveProperty('project_number', 1)
        expect(parsed).toHaveProperty('status')
        expect(parsed).toHaveProperty('last_5_entries')
        expect(parsed).toHaveProperty('weekly_trend')
    })
})
