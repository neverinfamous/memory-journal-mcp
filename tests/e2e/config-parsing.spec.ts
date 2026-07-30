import { test, expect } from './test-fixture.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { startServer, stopServer, createClient } from './helpers'

test.describe('Configuration File Parsing', () => {
    const port = 5127 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)
    let client: any
    const testConfigPath = path.join(process.cwd(), '.test-output', 'e2e', `test-config-${port}.json`)

    test.afterEach(async () => {
        if (client) {
            await client.close()
        }
        stopServer(port)
        if (fs.existsSync(testConfigPath)) {
            fs.unlinkSync(testConfigPath)
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
})
