/**
 * Payload Contract Tests: Team Tools (Error Path)
 *
 * Validates that all 20 team tools return well-formed structured errors
 * when TEAM_DB_PATH is not configured. Every response must include
 * { success: false, code: 'CONFIGURATION_ERROR' } — never raw MCP exceptions.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, startServer, stopServer } from './helpers.js'

test.describe.configure({ mode: 'serial' })

/** Port for the isolated server WITHOUT TEAM_DB_PATH */
const NO_TEAM_PORT = 3116

test.describe('Payload Contracts: Team Tools (no TEAM_DB_PATH)', () => {
    let client: Client

    test.beforeAll(async () => {
        // Start a dedicated server WITHOUT TEAM_DB_PATH to test config error path
        await startServer(NO_TEAM_PORT, ['--auth-token', 'test-token'], 'payloads-team', {
            env: {
                TEAM_DB_PATH: undefined,
                TEAM_AUTHOR: 'Alice',
                MCP_AUTH_SCOPES: 'read,write,team',
            },
        })
        client = await createClient(NO_TEAM_PORT, 'test-token')
    })

    test.afterAll(async () => {
        await client.close()
        await stopServer(NO_TEAM_PORT)
    })

    function expectConfigError(payload: Record<string, unknown>): void {
        expect(payload.success).toBe(false)
        expect(payload.code).toBe('CONFIGURATION_ERROR')
        expect(typeof payload.error).toBe('string')
        expect(payload.category).toBe('configuration')
        expect(typeof payload.suggestion).toBe('string')
        expect(typeof payload.recoverable).toBe('boolean')
    }

    // --- Core ---
    test('team_create_entry → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_create_entry', {
            project_number: 1,
            content: 'test',
            author: 'e2e',
        })
        expectConfigError(payload)
    })

    test('team_get_entry_by_id → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_entry_by_id', {
            project_number: 1,
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    test('team_get_recent → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_recent', {
            project_number: 1,
        })
        expectConfigError(payload)
    })

    test('team_list_tags → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_list_tags', {
            project_number: 1,
        })
        expectConfigError(payload)
    })

    // --- Search ---
    test('team_search → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            project_number: 1,
            query: 'test',
        })
        expectConfigError(payload)
    })

    test('team_search_by_date_range → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
            project_number: 1,
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })
        expectConfigError(payload)
    })

    // --- Admin ---
    test('team_update_entry → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_update_entry', {
            project_number: 1,
            entry_id: 1,
            content: 'updated',
        })
        expectConfigError(payload)
    })

    test('team_delete_entry → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_delete_entry', {
            project_number: 1,
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    test('team_merge_tags → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_merge_tags', {
            source_tag: 'old',
            target_tag: 'new',
        })
        expectConfigError(payload)
    })

    // --- Analytics ---
    test('team_get_statistics → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_statistics', {})
        expectConfigError(payload)
    })

    test('team_get_cross_project_insights → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_cross_project_insights', {})
        expectConfigError(payload)
    })

    // --- Relationships ---
    test('team_link_entries → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_link_entries', {
            from_entry_id: 1,
            to_entry_id: 2,
        })
        expectConfigError(payload)
    })

    test('team_visualize_relationships → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_visualize_relationships', {
            project_number: 1,
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    // --- Export ---
    test('team_export_entries → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_export_entries', {
            project_number: 1,
            format: 'json',
        })
        expectConfigError(payload)
    })

    // --- Backup ---
    test('team_backup → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_backup', {
            project_number: 1,
        })
        expectConfigError(payload)
    })

    test('team_list_backups → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_list_backups', {
            project_number: 1,
        })
        expectConfigError(payload)
    })

    // --- Vector ---
    test('team_semantic_search → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_semantic_search', {
            project_number: 1,
            query: 'test',
        })
        expectConfigError(payload)
    })

    test('team_get_vector_index_stats → { available: false } when unconfigured', async () => {
        // This tool uses a different response shape when teamDb is null:
        // { available: false, error: string } instead of TEAM_DB_ERROR_RESPONSE
        const payload = await callToolAndParse(client, 'team_get_vector_index_stats', {})
        expect(payload.available).toBe(false)
        expect(typeof payload.error).toBe('string')
    })

    test('team_rebuild_vector_index → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_rebuild_vector_index', {})
        expectConfigError(payload)
    })

    test('team_add_to_vector_index → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_add_to_vector_index', {
            project_number: 1,
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    // --- Team resources (no TEAM_DB_PATH in test env) ---
    test('should read memory://team/recent', async () => {
        const response = await client.readResource({ uri: 'memory://team/recent' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = (response.contents[0] as { text: string }).text
        const parsed = JSON.parse(text)
        // Without team DB, should return a not-configured indicator
        expect(typeof parsed).toBe('object')
    })

    test('should read memory://team/statistics', async () => {
        const response = await client.readResource({ uri: 'memory://team/statistics' })

        expect(response.contents).toBeDefined()
        expect(response.contents.length).toBeGreaterThan(0)

        const text = (response.contents[0] as { text: string }).text
        const parsed = JSON.parse(text)
        // Without team DB, should return a not-configured indicator
        expect(typeof parsed).toBe('object')
    })
})
