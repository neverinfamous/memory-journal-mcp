/**
 * Payload Contract Tests: Export
 *
 * Validates response shapes for 1 export tool:
 * export_entries.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Export', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('export_entries (json) returns { format, entries, count }', async () => {
        const payload = await callToolAndParse(client, 'export_entries', {
            format: 'json',
            limit: 5,
        })
        expectSuccess(payload)
        expect(payload.format).toBe('json')
        expect(Array.isArray(payload.entries)).toBe(true)
        expect(typeof payload.count).toBe('number')
        expect(payload.count).toBe(payload.entries.length)
    })

    test('export_entries (markdown) returns { format, content }', async () => {
        const payload = await callToolAndParse(client, 'export_entries', {
            format: 'markdown',
            limit: 5,
        })
        expectSuccess(payload)
        expect(payload.format).toBe('markdown')
        expect(typeof payload.content).toBe('string')
    })
})
