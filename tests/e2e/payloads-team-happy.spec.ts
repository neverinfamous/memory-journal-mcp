/**
 * Payload Contract Tests: Team Tools (Happy Path)
 *
 * Uses a dedicated server on port 3109 with TEAM_DB_PATH configured
 * to validate full team tool CRUD lifecycle:
 * create → get → search → update → link → visualize → export → backup → delete.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { callToolAndParse, expectSuccess } from './helpers.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const TEAM_PORT = 3109
const TEAM_BASE = `http://localhost:${TEAM_PORT}`

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Team Tools (Happy Path)', () => {
    let client: Client
    let serverProcess: ChildProcess
    let entryId1: number
    let entryId2: number

    test.beforeAll(async () => {
        // Ensure test output directory exists
        const testDir = join(process.cwd(), '.test-output', 'e2e')
        mkdirSync(testDir, { recursive: true })

        // Start server with TEAM_DB_PATH configured
        serverProcess = spawn(
            'node',
            [
                'dist/cli.js',
                '--transport',
                'http',
                '--port',
                String(TEAM_PORT),
                '--db',
                './.test-output/e2e/test-e2e-team-happy.db',
            ],
            {
                cwd: process.cwd(),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    MCP_RATE_LIMIT_MAX: '10000',
                    TEAM_DB_PATH: './.test-output/e2e/test-e2e-team-happy-team.db',
                },
            }
        )

        // Wait for server readiness
        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${TEAM_BASE}/health`)
                if (res.ok) break
            } catch {
                // Not ready
            }
            await delay(500)
        }

        const transport = new StreamableHTTPClientTransport(new URL(`${TEAM_BASE}/mcp`))
        client = new McpClient({ name: 'team-happy-test', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
    })

    test.afterAll(async () => {
        await client.close()
        serverProcess.kill('SIGTERM')
    })

    // --- Core ---
    test('team_create_entry returns { success, entry }', async () => {
        const payload = await callToolAndParse(client, 'team_create_entry', {
                project_number: 1,
            content: 'Team happy path test entry 1',
            author: 'e2e-test',
            entry_type: 'test_entry',
            tags: ['team-test', 'happy-path'],
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
        expect(payload.entry).toBeDefined()
        entryId1 = (payload.entry as Record<string, unknown>).id as number
    })

    test('team_create_entry (second entry)', async () => {
        const payload = await callToolAndParse(client, 'team_create_entry', {
                project_number: 1,
            content: 'Team happy path test entry 2',
            author: 'e2e-test',
            entry_type: 'project_decision',
            tags: ['team-test', 'merge-source'],
        })
        expectSuccess(payload)
        entryId2 = (payload.entry as Record<string, unknown>).id as number
    })

    test('team_get_entry_by_id returns entry', async () => {
        const payload = await callToolAndParse(client, 'team_get_entry_by_id', {
                project_number: 1,
            entry_id: entryId1,
        })
        expectSuccess(payload)
        expect(payload.entry).toBeDefined()
    })

    test('team_get_recent returns entries', async () => {
        const payload = await callToolAndParse(client, 'team_get_recent', {
                project_number: 1,
            limit: 5,
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    test('team_list_tags returns tags', async () => {
        const payload = await callToolAndParse(client, 'team_list_tags', {
                project_number: 1,})
        expectSuccess(payload)
        expect(Array.isArray(payload.tags)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    // --- Search ---
    test('team_search returns matches', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
                project_number: 1,
            query: 'happy path',
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    test('team_search_by_date_range returns entries', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
                project_number: 1,
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
    })

    // --- Admin ---
    test('team_update_entry succeeds', async () => {
        const payload = await callToolAndParse(client, 'team_update_entry', {
                project_number: 1,
            entry_id: entryId1,
            content: 'Updated team entry content',
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })

    test('team_merge_tags succeeds', async () => {
        const payload = await callToolAndParse(client, 'team_merge_tags', {
            source_tag: 'merge-source',
            target_tag: 'team-test',
        })
        expectSuccess(payload)
    })

    // --- Analytics ---
    test('team_get_statistics returns stats', async () => {
        const payload = await callToolAndParse(client, 'team_get_statistics', {})
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })

    // --- Relationships ---
    test('team_link_entries creates relationship', async () => {
        const payload = await callToolAndParse(client, 'team_link_entries', {
            project_number: 1,
            from_entry_id: entryId1,
            to_entry_id: entryId2,
            relationship_type: 'references',
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })

    test('team_visualize_relationships returns diagram', async () => {
        const payload = await callToolAndParse(client, 'team_visualize_relationships', {
                project_number: 1,
            entry_id: entryId1,
        })
        expectSuccess(payload)
    })

    // --- Export ---
    test('team_export_entries (json) returns entries', async () => {
        const payload = await callToolAndParse(client, 'team_export_entries', {
                project_number: 1,
            format: 'json',
        })
        expectSuccess(payload)
        expect(payload.format).toBe('json')
    })

    test('team_export_entries (markdown) returns data string', async () => {
        const payload = await callToolAndParse(client, 'team_export_entries', {
                project_number: 1,
            format: 'markdown',
        })
        expectSuccess(payload)
        expect(payload.format).toBe('markdown')
        // Handler returns `data` key (string), not `content`
        expect(typeof payload.data).toBe('string')
        expect((payload.data as string).length).toBeGreaterThan(0)
    })

    // --- Backup ---
    test('team_backup creates backup', async () => {
        const payload = await callToolAndParse(client, 'team_backup', {
                project_number: 1,})
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })

    test('team_list_backups returns list', async () => {
        const payload = await callToolAndParse(client, 'team_list_backups', {
                project_number: 1,})
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })

    // --- Delete (last to avoid breaking other tests) ---
    test('team_delete_entry soft-deletes', async () => {
        const payload = await callToolAndParse(client, 'team_delete_entry', {
                project_number: 1,
            entry_id: entryId2,
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })
})
