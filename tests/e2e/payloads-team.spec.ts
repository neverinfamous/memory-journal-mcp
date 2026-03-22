/**
 * Payload Contract Tests: Team Tools (Error Path)
 *
 * Validates that all 20 team tools return well-formed structured errors
 * when TEAM_DB_PATH is not configured. Every response must include
 * { success: false, code: 'CONFIGURATION_ERROR' } — never raw MCP exceptions.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Team Tools (no TEAM_DB_PATH)', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
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
            content: 'test',
            author: 'e2e',
        })
        expectConfigError(payload)
    })

    test('team_get_entry_by_id → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_entry_by_id', {
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    test('team_get_recent → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_get_recent', {})
        expectConfigError(payload)
    })

    test('team_list_tags → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_list_tags', {})
        expectConfigError(payload)
    })

    // --- Search ---
    test('team_search → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
        })
        expectConfigError(payload)
    })

    test('team_search_by_date_range → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })
        expectConfigError(payload)
    })

    // --- Admin ---
    test('team_update_entry → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_update_entry', {
            entry_id: 1,
            content: 'updated',
        })
        expectConfigError(payload)
    })

    test('team_delete_entry → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_delete_entry', {
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
            entry_id: 1,
        })
        expectConfigError(payload)
    })

    // --- Export ---
    test('team_export_entries → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_export_entries', {
            format: 'json',
        })
        expectConfigError(payload)
    })

    // --- Backup ---
    test('team_backup → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_backup', {})
        expectConfigError(payload)
    })

    test('team_list_backups → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_list_backups', {})
        expectConfigError(payload)
    })

    // --- Vector ---
    test('team_semantic_search → CONFIGURATION_ERROR', async () => {
        const payload = await callToolAndParse(client, 'team_semantic_search', {
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
            entry_id: 1,
        })
        expectConfigError(payload)
    })
})
