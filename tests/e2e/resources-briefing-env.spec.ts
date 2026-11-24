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

const BRIEFING_PORT = 5126 + (Number(process.env.TEST_WORKER_INDEX || process.env.TEST_PARALLEL_INDEX || 0) * 100)
const BRIEFING_BASE = `http://localhost:${BRIEFING_PORT}`
const E2E_DIR = path.join(process.cwd(), '.test-output', 'e2e')
const DB_PATH = path.join(E2E_DIR, `test-briefing-${BRIEFING_PORT}.db`)
const TEAM_DB = path.join(E2E_DIR, `test-briefing-team-${BRIEFING_PORT}.db`)
const LOG_PATH = path.join(E2E_DIR, `briefing-env-server-${BRIEFING_PORT}.log`)
const MAX_LOG_CHUNKS = 80

function removeFileIfExists(filePath: string): void {
    fs.rmSync(filePath, { force: true })
}

function removeDbArtifacts(dbPath: string): void {
    removeFileIfExists(dbPath)
    removeFileIfExists(`${dbPath}-wal`)
    removeFileIfExists(`${dbPath}-shm`)
}

test.describe.configure({ mode: 'serial' })

test.describe('Resources: Briefing Environment Configurations', () => {
    let client: Client | undefined
    let serverProcess: ChildProcess | undefined
    const serverLogs: string[] = []

    const appendServerLog = (chunk: string): void => {
        if (serverLogs.length >= MAX_LOG_CHUNKS) {
            serverLogs.shift()
        }
        serverLogs.push(chunk)
        fs.appendFileSync(LOG_PATH, chunk)
    }

    test.beforeAll(async () => {
        test.setTimeout(90_000)

        fs.mkdirSync(E2E_DIR, { recursive: true })
        removeDbArtifacts(DB_PATH)
        removeDbArtifacts(TEAM_DB)
        removeFileIfExists(LOG_PATH)
        serverLogs.length = 0

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
                DB_PATH,
                '--auth-token',
                'test-token',
                '--tool-filter',
                'core,team',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    PORT: String(BRIEFING_PORT),
                    DISABLE_ISSUE_LOGGING: 'true',
                    ALLOWED_IO_ROOTS: process.cwd(),
                    GITHUB_TOKEN: '',
                    GITHUB_PERSONAL_ACCESS_TOKEN: '',
                    MCP_RATE_LIMIT_MAX: '10000',
                    BRIEFING_ENTRY_COUNT: '2', // Only 2 entries max
                    BRIEFING_INCLUDE_TEAM: 'true', // Force inclusion
                    BRIEFING_COPILOT_REVIEWS: 'true', // Adds copilot block
                    TEAM_DB_PATH: TEAM_DB,
                    TEAM_AUTHOR: 'Alice',
                    MCP_AUTH_SCOPES: 'read,write,team',
                    MEMORY_JOURNAL_CONFIG: path.join(process.cwd(), 'tests', 'e2e', 'empty-config.json'),
                },
                windowsHide: true,
            }
        )

        let earlyExit: string | null = null
        serverProcess.once('exit', (code, signal) => {
            earlyExit = `code=${String(code)} signal=${String(signal)}`
        })
        serverProcess.once('error', (err) => {
            earlyExit = `spawn-error=${err.message}`
        })

        serverProcess.stdout?.on('data', (data: Buffer) => {
            appendServerLog(`[OUT] ${data.toString()}`)
        })
        serverProcess.stderr?.on('data', (data: Buffer) => {
            appendServerLog(`[ERR] ${data.toString()}`)
        })

        const readyDeadline = Date.now() + 75_000
        let ready = false
        while (Date.now() < readyDeadline) {
            if (earlyExit !== null) {
                throw new Error(
                    `Briefing MCP server exited early (${earlyExit}). Server output:\n${serverLogs.join('')}`
                )
            }
            try {
                const res = await fetch(`${BRIEFING_BASE}/health`, { signal: AbortSignal.timeout(1000) })
                if (res.ok) {
                    ready = true
                    break
                }
            } catch {
                // Server not ready yet
            }
            await delay(200)
        }
        if (!ready) {
            throw new Error(
                `Briefing MCP server failed to start within 75 seconds. Server output:\n${serverLogs.join('')}`
            )
        }

        const transport = new StreamableHTTPClientTransport(new URL(`${BRIEFING_BASE}/mcp`), {
            requestInit: { headers: { Authorization: 'Bearer test-token' } },
        })
        client = new McpClient({ name: 'briefing-test', version: '1.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        const testInfo = test.info()
        if (client !== undefined) {
            try {
                await client.close()
            } catch (err) {
                console.warn('Ignoring briefing client close error during teardown:', err)
            }
        }
        if (serverProcess !== undefined && serverProcess.exitCode === null) {
            const proc = serverProcess
            const exitPromise = new Promise<void>((resolve) => {
                proc.once('exit', () => {
                    resolve()
                })
            })
            proc.kill('SIGKILL')
            await Promise.race([exitPromise, delay(3000)])
        }
        // Preserve log file on failure for diagnostics
        if (testInfo.status !== 'passed') {
            if (serverLogs.length > 0) {
                console.error(`SERVER LOG:\n${serverLogs.join('')}`)
            } else if (fs.existsSync(LOG_PATH)) {
                console.error(`SERVER LOG:\n${fs.readFileSync(LOG_PATH, 'utf8')}`)
            }
        } else {
            removeFileIfExists(LOG_PATH)
            removeDbArtifacts(DB_PATH)
            removeDbArtifacts(TEAM_DB)
        }
    })

    test('memory://briefing dynamically generates based on ENV limits', async () => {
        if (client === undefined) {
            throw new Error('Briefing MCP client not initialized')
        }
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
        // Assert BRIEFING_ENTRY_COUNT=2 caps displayed entries to the 2 most recent
        expect(contentText).toContain('Briefing test code 3')
        expect(contentText).toContain('Briefing test code 2')
        expect(contentText).not.toContain('Briefing test code 1')
    })
})
