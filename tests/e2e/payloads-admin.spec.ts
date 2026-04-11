/**
 * Payload Contract Tests: Admin
 *
 * Validates response shapes for 5 admin tools:
 * update_entry, delete_entry, merge_tags, rebuild_vector_index, add_to_vector_index.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Admin', () => {
    let client: Client
    let entryId: number

    test.beforeAll(async () => {
        client = await createClient()
        // Create an entry for admin operations
        const e = await callToolAndParse(client, 'create_entry', {
            content: 'Admin test entry',
            entry_type: 'test_entry',
            tags: ['admin-test', 'merge-source'],
        })
        entryId = (e.entry as Record<string, unknown>).id as number
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('update_entry returns { success, entry }', async () => {
        const payload = await callToolAndParse(client, 'update_entry', {
            entry_id: entryId,
            content: 'Updated admin test entry',
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
        expect(payload.entry).toBeDefined()
    })

    test('add_to_vector_index returns { success, entryId }', async () => {
        const payload = await callToolAndParse(client, 'add_to_vector_index', {
            entry_id: entryId,
        })
        // Vector search may not be available in test environments
        expect(typeof payload.success).toBe('boolean')
        expect(payload.entryId).toBe(entryId)
    })

    test('merge_tags returns merge result', async () => {
        const payload = await callToolAndParse(client, 'merge_tags', {
            source_tag: 'merge-source',
            target_tag: 'admin-test',
        })
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })

    test('rebuild_vector_index returns { success, entriesIndexed }', async () => {
        test.setTimeout(90000)
        const payload = await callToolAndParse(client, 'rebuild_vector_index', {})
        // Embedding model may not be available in test environments
        expect(typeof payload.success).toBe('boolean')
        expect(typeof payload.entriesIndexed).toBe('number')
    })

    test('delete_entry returns { success, entryId }', async () => {
        const payload = await callToolAndParse(client, 'delete_entry', {
            entry_id: entryId,
        })
        expectSuccess(payload)
        expect(payload.success).toBeDefined()
        expect(payload.entryId).toBe(entryId)
    })
})
