/**
 * Payload Contract Tests: Team Isolation
 *
 * Validates that Team DB mutation tools strictly enforce project_number
 * parameter to prevent cross-tenant data leakage, while read/search tools remain permissive.
 */

import { test, expect } from './test-fixture.js'
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

    test('team_search MUST return validation error without project_number for global search', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('VALIDATION_ERROR')
    })

    test('team_search_by_date_range MUST return validation error without project_number for global search', async () => {
        const payload = await callToolAndParse(client, 'team_search_by_date_range', {
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('VALIDATION_ERROR')
    })

    test('team_search MUST bypass project_number constraint for pure flag searches', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
            tags: ['flag:blocker'],
        })

        expect(payload.success).toBe(true)
    })

    test('team_search MUST return validation error without project_number when tags contain non-flags', async () => {
        const payload = await callToolAndParse(client, 'team_search', {
            query: 'test',
            tags: ['flag:blocker', 'frontend'],
        })

        expect(payload.success).toBe(false)
        expect(payload.code).toBe('VALIDATION_ERROR')
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
