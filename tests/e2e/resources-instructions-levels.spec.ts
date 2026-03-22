/**
 * E2E Tests: memory://instructions Resource — Tool-Filter Gating
 *
 * The memory://instructions resource always serves full-level instructions
 * but conditions sections on which tool groups are enabled via --tool-filter.
 *
 * Validated section gates (from server-instructions.ts):
 *   Code Mode section  — present only when `codemode` group enabled
 *   GitHub Integration — present only when `github` group enabled
 *   Copilot Review     — present only when `github` group enabled
 *   Semantic search row in Quick Access — `search` group only
 *
 * This exercises the HTTP-transport path for instructions, which is
 * distinct from the stdio path tested in test-filter-instructions.mjs.
 *
 * Uses dedicated server ports 3110, 3111.
 */

import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, stopServer } from './helpers.js'

const CORE_ONLY_PORT = 3110   // --tool-filter core  (no codemode, no github, no search)
const NO_GITHUB_PORT = 3111   // --tool-filter -github (all except github)

/** Read memory://instructions text from a client */
async function readInstructions(client: Client): Promise<string> {
    const response = await client.readResource({ uri: 'memory://instructions' })
    expect(response.contents).toBeDefined()
    expect(response.contents.length).toBeGreaterThan(0)
    return response.contents[0]!.text as string
}

// ============================================================================
// core-only filter: no codemode, no github, no search
// ============================================================================

test.describe('memory://instructions: core-only filter gating', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(CORE_ONLY_PORT, ['--tool-filter', 'core'], 'instr-core-only')
        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${CORE_ONLY_PORT}/mcp`)
        )
        client = new Client({ name: 'instr-core-only-test', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(CORE_ONLY_PORT)
    })

    test('core-only: core section (Rule & Skill Suggestions) is always present', async () => {
        const text = await readInstructions(client)
        expect(text).toContain('Rule & Skill Suggestions')
    })

    test('core-only: Active Tools section lists only core group', async () => {
        const text = await readInstructions(client)
        // Active Tools section should mention core tools
        expect(text).toContain('## Active Tools')
        expect(text).toContain('core')
    })

    test('core-only: Code Mode section is absent (codemode group disabled)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('Code Mode (Token-Efficient')
    })

    test('core-only: GitHub Integration section is absent (github group disabled)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('## GitHub Integration')
    })

    test('core-only: Copilot Review Patterns section is absent (github group disabled)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('Copilot Review Patterns')
    })

    test('core-only: semantic_search Quick Access row is absent (search group disabled)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('| Semantic search |')
    })
})

// ============================================================================
// -github filter: all groups except github
// ============================================================================

test.describe('memory://instructions: -github filter gating', () => {
    let client: Client

    test.beforeAll(async () => {
        await startServer(NO_GITHUB_PORT, ['--tool-filter', '-github'], 'instr-no-github')
        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${NO_GITHUB_PORT}/mcp`)
        )
        client = new Client({ name: 'instr-no-github-test', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        stopServer(NO_GITHUB_PORT)
    })

    test('-github: core section is present', async () => {
        const text = await readInstructions(client)
        expect(text).toContain('Rule & Skill Suggestions')
    })

    test('-github: Code Mode section is present (codemode group enabled)', async () => {
        const text = await readInstructions(client)
        expect(text).toContain('Code Mode (Token-Efficient')
    })

    test('-github: GitHub Integration section is absent (github group removed)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('## GitHub Integration')
    })

    test('-github: Copilot Review Patterns section is absent (github group removed)', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('Copilot Review Patterns')
    })

    test('-github: semantic_search Quick Access row is present (search group enabled)', async () => {
        const text = await readInstructions(client)
        expect(text).toContain('| Semantic search |')
    })

    test('-github: Active Tools section does not list github tools', async () => {
        const text = await readInstructions(client)
        expect(text).not.toContain('get_github_issues')
    })
})
