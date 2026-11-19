import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/client'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { startServer, stopServer, createClient } from './helpers.js'

test.describe('Configuration File Parsing', () => {
    const port = 5127 + (Number(process.env.TEST_WORKER_INDEX || process.env.TEST_PARALLEL_INDEX || 0) * 100)
    const hotReloadPort = port + 1
    let client: Client | undefined
    const testConfigPath = path.join(process.cwd(), '.test-output', 'e2e', `test-config-${port}.json`)
    const hotReloadConfigPath = path.join(
        process.cwd(),
        '.test-output',
        'e2e',
        `test-hot-reload-${hotReloadPort}.json`
    )

    test.afterEach(async () => {
        if (client !== undefined) {
            await client.close()
            client = undefined
        }
        stopServer(port)
        stopServer(hotReloadPort)
        for (const cfg of [testConfigPath, hotReloadConfigPath]) {
            if (fs.existsSync(cfg)) {
                fs.unlinkSync(cfg)
            }
        }
    })

    test('successfully parses nested objects and arrays from a JSON config file', async () => {
        // Create a temporary configuration file with complex nested objects and arrays
        const configData = {
            allowedIoRoots: [process.cwd(), path.join(process.cwd(), 'tmp')],
            additionalTeamDbs: {
                "team-alpha": path.join(process.cwd(), '.test-output', 'e2e', `team-alpha-${port}.db`)
            },
            toolFilter: "codemode"
        }
        
        fs.writeFileSync(testConfigPath, JSON.stringify(configData, null, 2))

        // Start the server using the configuration file. 
        // startServer automatically passes --allowed-io-roots via CLI, but our test will override
        // the config file logic via the config resolver precedence.
        await startServer(port, ['--config', testConfigPath])

        // Connect the client
        client = await createClient(port)
        
        // Call the server to ensure it is alive and the config loaded properly
        const response = await client.listTools()
        
        // Since 'update_configuration' and 'mj_execute_code' are globally always enabled, we expect 2
        expect(response.tools.length).toBe(2)
        const toolNames = response.tools.map(t => t.name)
        expect(toolNames).toContain('mj_execute_code')
        expect(toolNames).toContain('update_configuration')
    })

    test('persists update_configuration changes to disk and hot-reloads external config file edits', async () => {
        fs.mkdirSync(path.dirname(hotReloadConfigPath), { recursive: true })
        fs.writeFileSync(
            hotReloadConfigPath,
            JSON.stringify({ toolFilter: 'full', briefingEntries: 2 }, null, 2)
        )

        await startServer(hotReloadPort, ['--config', hotReloadConfigPath], 'config-hot-reload')
        client = await createClient(hotReloadPort)

        const initial = await client.listTools(undefined, { cacheMode: 'refresh' })
        expect(initial.tools).toHaveLength(108)

        await client.callTool({
            name: 'update_configuration',
            arguments: { tool_filter: 'full,-github', briefing_entries: 5 },
        })

        const afterUpdate = await client.listTools(undefined, { cacheMode: 'refresh' })
        expect(afterUpdate.tools).toHaveLength(90)

        const diskConfig = JSON.parse(fs.readFileSync(hotReloadConfigPath, 'utf-8')) as Record<string, unknown>
        expect(diskConfig['briefingEntries']).toBe(5)

        fs.writeFileSync(
            hotReloadConfigPath,
            JSON.stringify({ ...diskConfig, toolFilter: 'codemode', briefingEntries: 9 }, null, 2)
        )
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const afterReload = await client.listTools(undefined, { cacheMode: 'refresh' })
        expect(afterReload.tools).toHaveLength(2)
        const reloadedNames = afterReload.tools.map((t) => t.name)
        expect(reloadedNames).toContain('mj_execute_code')
        expect(reloadedNames).toContain('update_configuration')
    })
})
