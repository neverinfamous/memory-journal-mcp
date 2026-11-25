/**
 * E2E Tests: Tool Filter Presets — essential, codemode-only, -github
 *
 * Validates tool filter presets not covered by tool-filtering.spec.ts:
 * - `essential`: includes core + codemode, excludes github and team
 * - `codemode`: exactly 1 tool (mj_execute_code), which is callable
 * - `-github`: all tools minus github group
 *
 * Also verifies the fix: essential and starter now auto-include codemode.
 *
 * Uses dedicated server ports 3105, 3106, 3107.
 */

import { test, expect } from './test-fixture.js'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { startServer, stopServer } from './helpers.js'
import { getAllToolNames, TOOL_GROUPS } from '../../src/filtering/tool-filter.js'

/** Derived counts — avoids hardcoding tool totals that change when tools are added/removed */
const TOTAL_TOOLS = getAllToolNames().length
const GITHUB_TOOLS = TOOL_GROUPS.github.length

const PRESET_PORT = 5120 + (Number(process.env.TEST_PARALLEL_INDEX || 0) * 100)

test.describe.configure({ mode: 'serial' })

test.describe('Tool Filter Presets', () => {
    let client: Client
    const tempConfigPath = path.join(process.cwd(), '.test-output', 'e2e', `filter-presets-${PRESET_PORT}.json`)

    test.beforeAll(async () => {
        fs.mkdirSync(path.dirname(tempConfigPath), { recursive: true })
        fs.writeFileSync(tempConfigPath, '{}')
        await startServer(
            PRESET_PORT,
            ['--config', tempConfigPath, '--tool-filter', 'essential'],
            'filter-presets'
        )

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${PRESET_PORT}/mcp`),
            { protocolVersion: '2024-11-05' }
        )
        client = new Client(
            { name: 'filter-presets-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(PRESET_PORT)
        if (fs.existsSync(tempConfigPath)) {
            fs.unlinkSync(tempConfigPath)
        }
    })

    // ============================================================================
    // essential preset: core + codemode (no github, no team, no search)
    // ============================================================================

    test.describe('Tool Filter: essential preset', () => {
        test('essential: exposes fewer than 30 tools', async () => {
            const response = await client.listTools(undefined, { cacheMode: 'refresh' })
            expect(response.tools.length).toBeLessThan(30)
            expect(response.tools.length).toBeGreaterThanOrEqual(2) // at least core + codemode
        })

        test('essential: includes create_entry (core group)', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).toContain('create_entry')
            expect(names).toContain('get_recent_entries')
        })

        test('essential: includes mj_execute_code (codemode auto-injected)', async () => {
            // The fix: essential now auto-includes codemode
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).toContain('mj_execute_code')
        })

        test('essential: excludes github tools', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).not.toContain('get_github_issues')
            expect(names).not.toContain('get_github_prs')
        })

        test('essential: excludes team tools', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).not.toContain('team_create_entry')
            expect(names).not.toContain('team_get_recent')
        })
    })

    // ============================================================================
    // codemode-only preset: exactly 2 tools (mj_execute_code + update_configuration), and it works
    // ============================================================================

    test.describe('Tool Filter: codemode-only preset', () => {
        test.beforeAll(async () => {
            await client.callTool({
                name: 'update_configuration',
                arguments: { tool_filter: 'codemode' },
            })
        })

        test('codemode: exposes 2 tools (mj_execute_code and update_configuration)', async () => {
            const response = await client.listTools(undefined, { cacheMode: 'refresh' })
            expect(response.tools.length).toBe(2)
            const toolNames = response.tools.map((t) => t.name)
            expect(toolNames).toContain('mj_execute_code')
            expect(toolNames).toContain('update_configuration')
        })

        test('codemode: mj_execute_code is callable and executes code', async () => {
            const response = await client.callTool({
                name: 'mj_execute_code',
                arguments: {
                    code: `
                        return 'codemode-only-e2e';
                    `,
                },
            })

            expect(Array.isArray(response.content)).toBe(true)
            const content = response.content as unknown as Array<{ type: string; text: string }>
            const text = content[0]?.text ?? ''
            expect(text).toContain('codemode-only-e2e')
        })

        test('codemode: does not expose any direct tool names (no create_entry etc.)', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).not.toContain('create_entry')
            expect(names).not.toContain('search_entries')
            expect(names).not.toContain('get_github_issues')
        })
    })

    // ============================================================================
    // -github subtractive filter: all tools minus github group
    // ============================================================================

    test.describe('Tool Filter: -github subtractive filter', () => {
        test.beforeAll(async () => {
            await client.callTool({
                name: 'update_configuration',
                arguments: { tool_filter: '-github' },
            })
        })

        test(`-github: exposes ${TOTAL_TOOLS - GITHUB_TOOLS} tools (${TOTAL_TOOLS} minus ${GITHUB_TOOLS} github)`, async () => {
            const response = await client.listTools(undefined, { cacheMode: 'refresh' })
            expect(response.tools.length).toBe(TOTAL_TOOLS - GITHUB_TOOLS)
        })

        test('-github: no github tools are present', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).not.toContain('get_github_issues')
            expect(names).not.toContain('get_github_prs')
            expect(names).not.toContain('get_kanban_board')
            expect(names).not.toContain('get_github_milestones')
            expect(names).not.toContain('get_copilot_reviews')
            expect(names).not.toContain('get_repo_insights')
        })

        test('-github: core, admin, team, and codemode tools remain', async () => {
            const response = await client.listTools()
            const names = response.tools.map((t) => t.name)
            expect(names).toContain('create_entry')
            expect(names).toContain('search_entries')
            expect(names).toContain('delete_entry')
            expect(names).toContain('mj_execute_code')
            expect(names).toContain('team_create_entry')
        })
    })
})
