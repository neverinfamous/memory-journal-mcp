/**
 * Payload Contract Tests: Core
 *
 * Validates response shapes for 6 core tools:
 * create_entry, get_recent_entries, get_entry_by_id,
 * create_entry_minimal, test_simple, list_tags.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Core', () => {
    let client: Client
    let createdEntryId: number

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('test_simple returns { message }', async () => {
        const payload = await callToolAndParse(client, 'test_simple', {
            message: 'payload test',
        })
        expect(typeof payload.message).toBe('string')
        expect(payload.message).toContain('payload test')
    })

    test('create_entry returns { success, entry }', async () => {
        const payload = await callToolAndParse(client, 'create_entry', {
            content: 'Payload contract test entry',
            entry_type: 'test_entry',
            tags: ['test', 'payload'],
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
        expect(payload.entry).toBeDefined()
        const entry = payload.entry as Record<string, unknown>
        expect(typeof entry.id).toBe('number')
        createdEntryId = entry.id as number
    })

    test('create_entry_minimal returns { success, entry }', async () => {
        const payload = await callToolAndParse(client, 'create_entry_minimal', {
            content: 'Minimal payload test',
        })
        expectSuccess(payload)
        expect(payload.success).toBe(true)
        expect(payload.entry).toBeDefined()
    })

    test('get_recent_entries returns { entries, count }', async () => {
        const payload = await callToolAndParse(client, 'get_recent_entries', {
            limit: 3,
        })
        expectSuccess(payload)
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })

    test('get_entry_by_id returns { entry, importance }', async () => {
        const payload = await callToolAndParse(client, 'get_entry_by_id', {
            entry_id: createdEntryId,
        })
        expectSuccess(payload)
        expect(payload.entry).toBeDefined()
        expect(payload.importance).toBeDefined()
    })

    test('list_tags returns { tags, count }', async () => {
        const payload = await callToolAndParse(client, 'list_tags', {})
        expectSuccess(payload)
        expect(Array.isArray(payload.tags)).toBe(true)
        expect(typeof payload.count).toBe('number')
    })
})
