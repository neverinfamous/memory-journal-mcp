import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/client'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { startServer, stopServer, createClient } from './helpers.js'

test.describe('Configuration File Parsing', () => {
    test.describe.configure({ mode: 'serial' })

    const port = 5127 + (Number(process.env.TEST_WORKER_INDEX || process.env.TEST_PARALLEL_INDEX || 0) * 100)
    let client: Client
    const testConfigPath = path.join(process.cwd(), '.test-output', 'e2e', `test-config-${port}.json`)

    test.beforeAll(async () => {
        fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })
        const configData = {
            allowedIoRoots: [process.cwd(), path.join(process.cwd(), 'tmp')],
            additionalTeamDbs: {
                'team-alpha': path.join(process.cwd(), '.test-output', 'e2e', `team-alpha-${port}.db`),
            },
            toolFilter: 'codemode',
            briefingEntries: 2,
        }
        fs.writeFileSync(testConfigPath, JSON.stringify(configData, null, 2))
        await startServer(port, ['--config', testConfigPath], 'config-parsing')
        client = await createClient(port)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(port)
        if (fs.existsSync(testConfigPath)) {
            fs.unlinkSync(testConfigPath)
        }
    })

    test('successfully parses nested objects and arrays from a JSON config file', async () => {
        const response = await client.listTools(undefined, { cacheMode: 'refresh' })

        // Since 'update_configuration' and 'mj_execute_code' are globally always enabled, we expect 2
        expect(response.tools.length).toBe(2)
        const toolNames = response.tools.map((t) => t.name)
        expect(toolNames).toContain('mj_execute_code')
        expect(toolNames).toContain('update_configuration')
    })

    test('persists update_configuration changes to disk and hot-reloads external config file edits', async () => {
        await client.callTool({
            name: 'update_configuration',
            arguments: { tool_filter: 'full', briefing_entries: 2 },
        })

        const initial = await client.listTools(undefined, { cacheMode: 'refresh' })
        expect(initial.tools).toHaveLength(108)

        await client.callTool({
            name: 'update_configuration',
            arguments: { tool_filter: 'full,-github', briefing_entries: 5 },
        })

        const afterUpdate = await client.listTools(undefined, { cacheMode: 'refresh' })
        expect(afterUpdate.tools).toHaveLength(90)

        const diskConfig = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8')) as Record<string, unknown>
        expect(diskConfig['briefingEntries']).toBe(5)

        fs.writeFileSync(
            testConfigPath,
            JSON.stringify({ ...diskConfig, toolFilter: 'codemode', briefingEntries: 9 }, null, 2)
        )

        const activeClient = client
        let afterReload = await activeClient.listTools(undefined, { cacheMode: 'refresh' })
        await expect
            .poll(
                async () => {
                    afterReload = await activeClient.listTools(undefined, { cacheMode: 'refresh' })
                    return afterReload.tools.length
                },
                { timeout: 5000, intervals: [100, 200, 250] }
            )
            .toBe(2)

        const reloadedNames = afterReload.tools.map((t) => t.name)
        expect(reloadedNames).toContain('mj_execute_code')
        expect(reloadedNames).toContain('update_configuration')
    })
})
