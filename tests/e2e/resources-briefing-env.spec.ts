/**
 * E2E Tests: Briefing Environment Variable Overrides
 *
 * Verifies that the memory://briefing template actually responds
 * to environment configurations like BRIEFING_ENTRY_COUNT,
 * BRIEFING_INCLUDE_TEAM, etc.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const BRIEFING_PORT = 3112
const BRIEFING_BASE = `http://localhost:${BRIEFING_PORT}`

test.describe.configure({ mode: 'serial' })

test.describe('Resources: Briefing Environment Configurations', () => {
    let client: Client
    let serverProcess: ChildProcess

    test.beforeAll(async () => {
        // Start server with specific config and team db
        serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--allowed-io-roots',
                process.cwd(),
                '--transport',
                'http',
                '--port',
                String(BRIEFING_PORT),
                '--db',
                './.test-output/e2e/test-briefing.db',
                '--auth-token',
                'test-token'
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env, ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '10000',
                    BRIEFING_ENTRY_COUNT: '2', // Only 2 entries max
                    BRIEFING_INCLUDE_TEAM: 'true', // Force inclusion
                    BRIEFING_COPILOT_REVIEWS: 'true', // Adds copilot block
                    TEAM_DB_PATH: './.test-output/e2e/test-briefing-team.db',
                    TEAM_AUTHOR: 'Alice',
                },
            }
        )

        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${BRIEFING_BASE}/health`)
                if (res.ok) break
            } catch {}
            await delay(500)
        }

        const transport = new StreamableHTTPClientTransport(new URL(`${BRIEFING_BASE}/mcp`), { requestInit: { headers: { Authorization: 'Bearer test-token' } } })
        client = new McpClient({ name: 'briefing-test', version: '1.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        if (client) {
            await client.close()
        }
        if (serverProcess) {
            serverProcess.kill('SIGTERM')
        }
    })

    test('memory://briefing dynamically generates based on ENV limits', async () => {
        // Create 3 entries to exceed the limit of 2
        for (let i = 1; i <= 3; i++) {
            const resp = await client.callTool({
                name: 'create_entry',
                arguments: { content: `Briefing test code ${i}`, entry_type: 'test_entry' },
            })
            expect(resp.isError).toBeUndefined()
        }

        // Also create a team entry to test inclusion
        const t_resp = await client.callTool({
            name: 'team_create_entry',
            arguments: { content: 'Team insight', entry_type: 'test_entry', project_number: 1 },
        })
        expect(t_resp.isError).toBeUndefined()

        const response = await client.readResource({ uri: 'memory://briefing' })

        expect(response.contents).toBeDefined()
        const firstResource = response.contents[0]
        if (!firstResource || !('text' in firstResource)) {
            throw new Error('Expected text resource')
        }
        const contentText = firstResource.text
        // The briefing resource yields JSON format
        const briefingObj = JSON.parse(contentText)

        // Assert entry limit of 2 is respected
        expect(briefingObj.journal.latestEntries.length).toBe(2)
        // Assert team block is populated
        expect(briefingObj.teamContext).toBeDefined()
        expect(briefingObj.teamLatestEntries.length).toBeGreaterThan(0)
        expect(briefingObj.teamLatestEntries[0].preview).toContain('insight')
    })
})
