/**
 * Payload Contract Tests: Team Isolation
 *
 * Validates that Team DB search tools strictly enforce project_number
 * parameter to prevent cross-tenant data leakage.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Team Isolation', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('team_search MUST reject queries without project_number', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('PERMISSION_DENIED')
        expect(payload.error).toContain('MUST specify a project_number')
    })

    test('team_search_by_date_range MUST reject queries without project_number', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('PERMISSION_DENIED')
        expect(payload.error).toContain('MUST specify a project_number')
    })

    test('team_search MUST bypass project_number constraint for pure flag searches', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
            tags: ['flag:blocker'],
        })

        expect(payload.success).toBe(true)
        // ensure it filtered correctly under the hood
        if (payload.entries.length > 0) {
            expect(payload.entries[0].entryType).toBe('flag')
        }
    })

    test('team_search MUST reject queries without project_number if tags contain non-flags', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
            tags: ['flag:blocker', 'frontend'],
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('PERMISSION_DENIED')
    })

    test('team_search_by_date_range MUST bypass project_number constraint for flag entry_type', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
            start_date: '2020-01-01',
            end_date: '2030-12-31',
            entry_type: 'flag',
        })

        expect(payload.success).toBe(true)
    })
})
