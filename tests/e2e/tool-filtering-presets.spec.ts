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

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, stopServer } from './helpers.js'
import { getAllToolNames, TOOL_GROUPS } from '../../src/filtering/tool-filter.js'

/** Derived counts — avoids hardcoding tool totals that change when tools are added/removed */
const TOTAL_TOOLS = getAllToolNames().length
const GITHUB_TOOLS = TOOL_GROUPS.github.length

const ESSENTIAL_PORT = 3105
const CODEMODE_PORT = 3106
const MINUS_GITHUB_PORT = 3107

// ============================================================================
// essential preset: core + codemode (no github, no team, no search)
// ============================================================================

test.describe('Tool Filter: essential preset', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(ESSENTIAL_PORT, ['--tool-filter', 'essential'], 'filter-essential')

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${ESSENTIAL_PORT}/mcp`)
        )
        client = new Client(
            { name: 'filter-essential-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(ESSENTIAL_PORT)
    })

    test('essential: exposes fewer than 20 tools', async () => {
        const response = await client.listTools()
        expect(response.tools.length).toBeLessThan(20)
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
// codemode-only preset: exactly 1 tool, and it works
// ============================================================================

test.describe('Tool Filter: codemode-only preset', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(CODEMODE_PORT, ['--tool-filter', 'codemode'], 'filter-codemode')

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${CODEMODE_PORT}/mcp`)
        )
        client = new Client(
            { name: 'filter-codemode-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(CODEMODE_PORT)
    })

    test('codemode: exposes exactly 1 tool', async () => {
        const response = await client.listTools()
        expect(response.tools.length).toBe(1)
        expect(response.tools[0]!.name).toBe('mj_execute_code')
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
        const text = (response.content[0] as { type: string; text: string }).text
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
    let client: Client

    test.beforeAll(async () => {
        await startServer(MINUS_GITHUB_PORT, ['--tool-filter', '-github'], 'filter-minus-github')

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${MINUS_GITHUB_PORT}/mcp`)
        )
        client = new Client(
            { name: 'filter-minus-github-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(MINUS_GITHUB_PORT)
    })

    test(`-github: exposes ${TOTAL_TOOLS - GITHUB_TOOLS} tools (${TOTAL_TOOLS} minus ${GITHUB_TOOLS} github)`, async () => {
        const response = await client.listTools()
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
