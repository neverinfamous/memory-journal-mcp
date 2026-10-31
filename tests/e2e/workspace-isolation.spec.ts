import { test, expect } from './test-fixture.js'
import { startServer, stopServer, callToolAndParse, createClient } from './helpers.js'
import { Client } from '@modelcontextprotocol/client'

const WS_PORT = 6300 + Number(process.env.TEST_PARALLEL_INDEX || 0)

test.describe('Workspace Isolation', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(WS_PORT, [], undefined, { env: { DEFAULT_WORKSPACE_ID: 'alpha' } })
        client = await createClient(WS_PORT)
    })

    test.afterAll(() => {
        stopServer(WS_PORT)
    })

    test('should isolate entries by workspace', async () => {
        const createAlpha = await callToolAndParse(client, 'create_entry', { workspace_id: 'alpha', content: 'Entry in default server workspace alpha', project_number: 1 })
        expect(createAlpha.success).toBe(true)

        // 2. Read recent entries - should see the alpha entry
        const recentAlpha = await callToolAndParse(client, 'get_recent_entries', { limit: 10, workspace_id: 'alpha' })
        console.log('DEBUG recentAlpha:', recentAlpha)
        expect(recentAlpha.success).toBe(true)
        expect(recentAlpha.entries.some((e: any) => e.content === 'Entry in default server workspace alpha')).toBe(true)

        // 3. Create entry with explicit workspace_id 'beta'
        const createBeta = await callToolAndParse(client, 'create_entry', { content: 'Entry in explicit workspace beta', workspace_id: 'beta', project_number: 1 })
        if (!createBeta.success) console.error('createBeta error:', createBeta)
        expect(createBeta.success).toBe(true)

        // 4. Read recent again (implicit alpha) - beta entry should be excluded
        const recentAlphaAgain = await callToolAndParse(client, 'get_recent_entries', { limit: 10, workspace_id: 'alpha' })
        expect(recentAlphaAgain.success).toBe(true)
        expect(recentAlphaAgain.entries.some((e: any) => e.content === 'Entry in explicit workspace beta')).toBe(false)

        // 5. Read recent with explicit workspace_id 'beta'
        const recentBeta = await callToolAndParse(client, 'get_recent_entries', { limit: 10, workspace_id: 'beta' })
        expect(recentBeta.success).toBe(true)
        console.log('recentBeta entries:', recentBeta.entries)
        expect(recentBeta.entries.some((e: any) => e.content === 'Entry in explicit workspace beta')).toBe(true)
    })
})
