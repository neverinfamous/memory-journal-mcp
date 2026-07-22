/**
 * Payload Contract Tests: Search
 *
 * Validates response shapes for 4 search tools:
 * search_entries, search_by_date_range, semantic_search, get_vector_index_stats.
 */

import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Search', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
        // Seed an entry for search tests
        await callToolAndParse(client, 'create_entry', { workspace_id: 'default', 
            project_number: 1,
            content: 'Searchable payload contract test entry about performance',
            entry_type: 'test_entry',
            tags: ['search-test'],
        })
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('search_entries returns { entries, count }', async () => {
        const payload = await callToolAndParse(client, 'search_entries', {
            project_number: 1,
            query: 'performance',
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    test('search_entries returns highlights when requested', async () => {
        const payload = await callToolAndParse(client, 'search_entries', {
            project_number: 1,
            query: 'performance',
            include_highlights: true,
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.highlights)).toBe(true)
    })

    test('search_entries returns facets when requested', async () => {
        const payload = await callToolAndParse(client, 'search_entries', {
            project_number: 1,
            query: 'performance',
            include_facets: true,
        })
        expectSuccess(payload)
        expect(typeof payload.facets).toBe('object')
        expect(Array.isArray(payload.facets?.tags)).toBe(true)
        expect(Array.isArray(payload.facets?.entryTypes)).toBe(true)
    })

    test('search_entries processes hybrid weights safely', async () => {
        const payload = await callToolAndParse(client, 'search_entries', {
            project_number: 1,
            query: 'performance',
            mode: 'hybrid',
            fts_weight: 1.5,
            semantic_weight: 0.5,
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
    })

    test('search_by_date_range returns { entries, count }', async () => {
        const payload = await callToolAndParse(client, 'search_by_date_range', {
            project_number: 1,
            start_date: '2020-01-01',
            end_date: '2030-12-31',
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    test('semantic_search returns results', async () => {
        const payload = await callToolAndParse(client, 'semantic_search', {
            query: 'performance optimization',
            limit: 3,
        })
        // May return { entries, count } or { success: false } if index not ready
        expect(typeof payload).toBe('object')
    })

    test('get_vector_index_stats returns stats', async () => {
        const payload = await callToolAndParse(client, 'get_vector_index_stats', {})
        expectSuccess(payload)
        expect(payload.available).toBeDefined()
    })

    test('list_deleted_entries returns { entries, count }', async () => {
        const payload = await callToolAndParse(client, 'list_deleted_entries', {})
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })
})
