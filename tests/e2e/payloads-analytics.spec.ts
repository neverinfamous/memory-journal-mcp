/**
 * Payload Contract Tests: Analytics
 *
 * Validates response shapes for 2 analytics tools:
 * get_statistics, get_cross_project_insights.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Analytics', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('get_statistics returns stats object', async () => {
        const payload = await callToolAndParse(client, 'get_statistics', {})
        expectSuccess(payload)
        expect(typeof payload.groupBy).toBe('string')
        expect(typeof payload).toBe('object')
    })

    test('get_cross_project_insights returns insights', async () => {
        const payload = await callToolAndParse(client, 'get_cross_project_insights', {})
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })
})
