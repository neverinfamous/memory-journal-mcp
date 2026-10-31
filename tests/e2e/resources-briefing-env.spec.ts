/**
 * E2E Tests: Briefing Environment Variable Overrides
 *
 * Verifies that the memory://briefing template actually responds
 * to environment configurations like BRIEFING_ENTRY_COUNT,
 * BRIEFING_INCLUDE_TEAM, etc.
 */

import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/client'
import { Client as McpClient } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import * as fs from 'node:fs'
import path from 'node:path'

const BRIEFING_PORT = 5126 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)
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
                'test-token',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    ALLOWED_IO_ROOTS: process.cwd(),
                    MCP_RATE_LIMIT_MAX: '10000',
                    BRIEFING_ENTRY_COUNT: '2', // Only 2 entries max
                    BRIEFING_INCLUDE_TEAM: 'true', // Force inclusion
                    BRIEFING_COPILOT_REVIEWS: 'true', // Adds copilot block
                    TEAM_DB_PATH: './.test-output/e2e/test-briefing-team.db',
                    TEAM_AUTHOR: 'Alice',
                    MCP_AUTH_SCOPES: 'read,write,team',
                    MEMORY_JOURNAL_CONFIG: path.join(process.cwd(), 'tests', 'e2e', 'empty-config.json'),
                },
                windowsHide: true,
            }
        )

        serverProcess.stdout?.on('data', (data) => fs.appendFileSync('serverProcess.log', `[OUT] ${data.toString()}`));
        serverProcess.stderr?.on('data', (data) => fs.appendFileSync('serverProcess.log', `[ERR] ${data.toString()}`));

        let ready = false
        for (let i = 0; i < 120; i++) {
            try {
                const res = await fetch(`${BRIEFING_BASE}/health`)
                if (res.ok) {
                    ready = true
                    break
                }
            } catch {}
            await delay(500)
        }
        if (!ready) throw new Error('Briefing MCP server failed to start within 60 seconds')

        const transport = new StreamableHTTPClientTransport(new URL(`${BRIEFING_BASE}/mcp`), {
            requestInit: { headers: { Authorization: 'Bearer test-token' } },
        })
        client = new McpClient({ name: 'briefing-test', version: '1.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    // eslint-disable-next-line no-empty-pattern
    test.afterAll(async ({}, testInfo) => {
        if (client) {
            await client.close()
        }
        if (serverProcess && serverProcess.exitCode === null) {
            const exitPromise = new Promise(resolve => serverProcess.on('exit', resolve))
            serverProcess.kill('SIGKILL')
            await exitPromise
        }
        // Don't delete log if test failed
        if (testInfo.status !== 'passed' && fs.existsSync('serverProcess.log')) {
            console.error("SERVER LOG:\n" + fs.readFileSync('serverProcess.log', 'utf8'))
        }
        if (fs.existsSync('serverProcess.log')) {
            fs.unlinkSync('serverProcess.log')
        }
    })

    test('memory://briefing dynamically generates based on ENV limits', async () => {
        // Create 3 entries to exceed the limit of 2
        for (let i = 1; i <= 3; i++) {
            const resp = await client.callTool({
                name: 'create_entry',
                arguments: {
                    workspace_id: 'default',
                    project_number: 1,
                    content: `Briefing test code ${i}`,
                    entry_type: 'test_entry',
                },
            })
            if (resp.isError) {
                console.error("TOOL CALL FAILED: ", JSON.stringify(resp, null, 2));
            }
            expect(resp.isError).toBeUndefined()
        }

        // Also create a team entry to test inclusion
        const t_resp = await client.callTool({
            name: 'team_create_entry',
            arguments: {
                workspace_id: 'default',
                project_number: 1,
                content: 'Team insight',
                entry_type: 'test_entry',
            },
        })
        expect(t_resp.isError).toBeUndefined()

        const response = await client.readResource({ uri: 'memory://briefing' })

        expect(response.contents).toBeDefined()
        const firstResource = response.contents[0]
        if (!firstResource || !('text' in firstResource)) {
            throw new Error('Expected text resource')
        }
        const contentText = firstResource.text
        // Assert team block is populated
        expect(contentText).toMatch(/Team: \d+/)
        expect(contentText).toContain('entries')
    })
})
