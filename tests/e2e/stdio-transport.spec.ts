/**
 * E2E Tests: Stdio Pipe Transport, Progress Parity & SDK/Zod Boundaries
 *
 * Replaces standalone `test-long-mcp.mjs`, `test-sdk-boundaries.mjs`, and
 * `test-progress.mjs` with a single shared `StdioClientTransport` subprocess
 * covering stdio pipe framing, `50,000`/`50,001`/`100,001`-char boundaries,
 * FIFO progress notifications, and structured `VALIDATION_ERROR` handling.
 */

import { test, expect } from './test-fixture.js'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callToolAndParse, callToolRaw, expectHandlerError, expectSuccess } from './helpers.js'

interface StdioProgressItem {
    progress: number
    total?: number
}

function extractBatchIds(response: unknown): number[] {
    if (typeof response !== 'object' || response === null) return []
    let payload: Record<string, unknown> = {}
    if (
        'structuredContent' in response &&
        typeof response.structuredContent === 'object' &&
        response.structuredContent !== null
    ) {
        payload = response.structuredContent as Record<string, unknown>
    } else if ('content' in response && Array.isArray(response.content) && response.content.length > 0) {
        const first = response.content[0] as { text?: unknown }
        if (typeof first.text === 'string' && first.text.startsWith('{')) {
            payload = JSON.parse(first.text) as Record<string, unknown>
        }
    }
    expectSuccess(payload)
    const entries = payload['entries']
    if (!Array.isArray(entries)) return []
    return entries
        .map((e) => (typeof e === 'object' && e !== null && 'id' in e ? e.id : undefined))
        .filter((id): id is number => typeof id === 'number')
}

async function callStdioWithProgress(
    client: Client,
    name: string,
    args: Record<string, unknown>,
    events: StdioProgressItem[]
): Promise<unknown> {
    return client.callTool(
        { name, arguments: args },
        {
            onprogress: (p) => {
                events.push({ progress: p.progress, total: p.total })
            },
        }
    )
}

function parseRawToolPayload(response: {
    content: Array<{ type: string; text: string }>
}): { rawText: string; payload: Record<string, unknown> } {
    const rawText = response.content[0]?.text ?? ''
    const structured =
        'structuredContent' in response &&
        typeof response.structuredContent === 'object' &&
        response.structuredContent !== null
            ? (response.structuredContent as Record<string, unknown>)
            : undefined
    if (structured !== undefined) {
        return { rawText, payload: structured }
    }
    if (rawText.includes('{')) {
        return {
            rawText,
            payload: JSON.parse(rawText.slice(rawText.indexOf('{'))) as Record<string, unknown>,
        }
    }
    return { rawText, payload: {} }
}

test.describe.configure({ mode: 'serial' })

test.describe('Stdio Transport & SDK Boundary Parity', () => {
    let client: Client
    let transport: StdioClientTransport
    let tempDir: string

    test.beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'mj-e2e-stdio-'))
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(process.env)) {
            if (typeof v === 'string') env[k] = v
        }
        env['AUTO_REBUILD_INDEX'] = 'false'
        env['LOG_LEVEL'] = 'error'
        env['DB_ENCRYPTION_KEY'] = ''
        env['MJ_DB_ENCRYPTION_KEY'] = ''
        env['DISABLE_ISSUE_LOGGING'] = 'true'
        env['TEAM_AUTHOR'] = 'test_author'
        env['TEAM_DEFAULT_ROLE'] = 'member'
        env['MEMORY_JOURNAL_CONFIG'] = join(process.cwd(), 'tests', 'e2e', 'empty-config.json')
        env['PROJECT_REGISTRY'] = JSON.stringify({
            'memory-journal-mcp': { path: process.cwd(), project_number: 5 },
        })

        transport = new StdioClientTransport({
            command: process.execPath,
            args: [
                'dist/cli.js',
                'serve',
                '--db',
                join(tempDir, 'stdio.db'),
                '--team-db',
                join(tempDir, 'stdio-team.db'),
                '--tool-filter',
                'full',
                '--log-level',
                'error',
                '--team-default-role',
                'member',
                '--archive-older-than-days',
                '0',
                '--prune-older-than-days',
                '0',
                '--hard-delete-older-than-days',
                '0',
            ],
            cwd: process.cwd(),
            env,
            stderr: 'pipe',
        })
        client = new Client({ name: 'e2e-stdio-transport', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await transport.close()
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    test('stdio initialize instructions expose canonical Active Tools (108)', () => {
        const instructions = client.getInstructions() ?? ''
        expect(instructions).toContain('Essential Behaviors')
        expect(instructions).toContain('## Active Tools (108)')
    })

    test('stdio pipe framing accepts 50,000-char create_entry and rejects 50,001 / 100,001 chars cleanly', async () => {
        const created = await callToolAndParse(client, 'create_entry', {
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            content: 'A'.repeat(50_000),
            entry_type: 'technical_note',
            impact_score: 0.2,
            trust_score: 0.8,
            validation_status: 'passed',
        })
        expectSuccess(created)

        for (const length of [50_001, 100_001]) {
            const raw = await callToolRaw(client, 'create_entry', {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                content: 'A'.repeat(length),
                entry_type: 'technical_note',
            })
            const { rawText, payload } = parseRawToolPayload(raw)
            expect(rawText).not.toContain('-32602')
            expectHandlerError(payload, /50000/)
            expect(payload['code']).toBe('VALIDATION_ERROR')
        }
    })

    test('stdio SDK and team Zod boundaries return structured results without -32602 leakage', async () => {
        const healedRes = await callToolRaw(client, 'team_create_entry', {
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            entry_type: 'invalid',
            content: 'stdio boundary healed entry',
        })
        const healed = parseRawToolPayload(healedRes)
        expect(healed.rawText).not.toContain('-32602')
        expectSuccess(healed.payload)

        const missingRes = await callToolRaw(client, 'team_update_entry', {
            workspace_id: 'memory-journal-mcp',
            project_number: 5,
            entry_id: 999999,
        })
        const missing = parseRawToolPayload(missingRes)
        expect(missing.rawText).not.toContain('-32602')
        expectHandlerError(missing.payload)

        const invalidCases: Array<[string, Record<string, unknown>]> = [
            ['create_entry', { workspace_id: 'memory-journal-mcp', project_number: 5, content: true }],
            ['create_entry', { workspace_id: 'memory-journal-mcp', project_number: 5, content: ['array'] }],
            ['team_create_entry', { workspace_id: 'memory-journal-mcp', project_number: 5, content: 123 }],
            ['team_search', { workspace_id: 'memory-journal-mcp', project_number: 5, query: 123 }],
        ]
        for (const [toolName, args] of invalidCases) {
            const res = await callToolRaw(client, toolName, args)
            const parsed = parseRawToolPayload(res)
            expect(parsed.rawText, `${toolName} leaked -32602`).not.toContain('-32602')
            expectHandlerError(parsed.payload)
            expect(parsed.payload['code'], `${toolName} code`).toBe('VALIDATION_ERROR')
        }
    })

    test('stdio progress notifications fire for export_entries and Code Mode mj.reportProgress()', async () => {
        const exportEvents: StdioProgressItem[] = []
        const exportRes = (await callStdioWithProgress(
            client,
            'export_entries',
            {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                format: 'json',
                limit: 5,
            },
            exportEvents
        )) as { isError?: boolean }
        expect(exportRes.isError).toBeFalsy()
        expect(exportEvents.length).toBeGreaterThanOrEqual(2)

        const codeEvents: StdioProgressItem[] = []
        const code = [
            'await mj.reportProgress(0, 3, "Starting workflow...");',
            'await mj.reportProgress(1, 3, "Processing data...");',
            'await mj.reportProgress(2, 3, "Finalizing...");',
            'await mj.reportProgress(3, 3, "Workflow complete");',
            'return { success: true, stepsReported: 4 };',
        ].join('\n')
        const codeRes = (await callStdioWithProgress(
            client,
            'mj_execute_code',
            { code },
            codeEvents
        )) as { isError?: boolean }
        expect(codeRes.isError).toBeFalsy()
        expect(codeEvents.length).toBeGreaterThanOrEqual(3)
    })

    test('stdio batch and team_batch entry pipelines emit progress notifications', async () => {
        const personalEvents: StdioProgressItem[] = []
        const seedPersonal = await callStdioWithProgress(
            client,
            'batch_create_entries',
            {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                entries: [
                    { content: 'Stdio batch 1', entry_type: 'technical_note', project_number: 5 },
                    { content: 'Stdio batch 2', entry_type: 'technical_note', project_number: 5 },
                ],
                auto_index: false,
            },
            personalEvents
        )
        const ids = extractBatchIds(seedPersonal)
        expect(ids).toHaveLength(2)

        await callStdioWithProgress(
            client,
            'batch_update_entries',
            {
                workspace_id: 'memory-journal-mcp',
                updates: ids.map((id) => ({ entry_id: id, content: 'Stdio batch updated' })),
                auto_index: false,
            },
            personalEvents
        )
        await callStdioWithProgress(
            client,
            'batch_delete_entries',
            { workspace_id: 'memory-journal-mcp', entry_ids: ids },
            personalEvents
        )
        expect(personalEvents.length).toBeGreaterThanOrEqual(6)

        const teamEvents: StdioProgressItem[] = []
        const seedTeam = await callStdioWithProgress(
            client,
            'team_batch_create_entries',
            {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                entries: [
                    { content: 'Stdio team batch 1', entry_type: 'technical_note', project_number: 5 },
                    { content: 'Stdio team batch 2', entry_type: 'technical_note', project_number: 5 },
                ],
                auto_index: false,
            },
            teamEvents
        )
        const teamIds = extractBatchIds(seedTeam)
        expect(teamIds).toHaveLength(2)

        await callStdioWithProgress(
            client,
            'team_batch_update_entries',
            {
                workspace_id: 'memory-journal-mcp',
                updates: teamIds.map((id) => ({ entry_id: id, content: 'Stdio team batch updated' })),
                auto_index: false,
            },
            teamEvents
        )
        await callStdioWithProgress(
            client,
            'team_batch_delete_entries',
            { workspace_id: 'memory-journal-mcp', project_number: 5, entry_ids: teamIds },
            teamEvents
        )
        expect(teamEvents.length).toBeGreaterThanOrEqual(6)
    })
})
