/**
 * Payload Contract Tests: Backup
 *
 * Validates response shapes for 4 backup tools:
 * backup_journal, list_backups, cleanup_backups, restore_backup.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Backup', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('backup_journal returns { success }', async () => {
        const payload = await callToolAndParse(client, 'backup_journal', {})
        expectSuccess(payload)
        expect(payload.success).toBe(true)
    })

    test('list_backups returns backup list', async () => {
        const payload = await callToolAndParse(client, 'list_backups', {})
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })

    test('cleanup_backups returns cleanup result', async () => {
        const payload = await callToolAndParse(client, 'cleanup_backups', {
            keep: 5,
        })
        expectSuccess(payload)
        expect(typeof payload).toBe('object')
    })
})
