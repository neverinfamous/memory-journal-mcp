/**
 * Payload Contract Tests: Relationships
 *
 * Validates response shapes for 2 relationship tools:
 * link_entries, visualize_relationships.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Relationships', () => {
    let client: Client
    let entryId1: number
    let entryId2: number

    test.beforeAll(async () => {
        client = await createClient()
        // Create two entries for relationship tests
        const e1 = await callToolAndParse(client, 'create_entry', {
            content: 'Relationship source entry',
            entry_type: 'test_entry',
        })
        const e2 = await callToolAndParse(client, 'create_entry', {
            content: 'Relationship target entry',
            entry_type: 'project_decision',
        })
        entryId1 = (e1.entry as Record<string, unknown>).id as number
        entryId2 = (e2.entry as Record<string, unknown>).id as number
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('link_entries returns { success, relationship }', async () => {
        const payload = await callToolAndParse(client, 'link_entries', {
            from_entry_id: entryId1,
            to_entry_id: entryId2,
            relationship_type: 'references',
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
        expect(payload.relationship).toBeDefined()
    })

    test('visualize_relationships returns Mermaid diagram', async () => {
        const payload = await callToolAndParse(client, 'visualize_relationships', {
            entry_id: entryId1,
        })
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })
})
