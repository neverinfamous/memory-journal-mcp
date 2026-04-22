/**
 * Payload Contract Tests: Backup Restore
 *
 * Tests the restore_backup workflow that was missing from
 * payloads-backup.spec.ts: confirm=false rejection, nonexistent
 * backup error, and full backup→restore cycle.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Backup Restore', () => {
    let client: Client

    test.beforeAll(async () => {
        client = await createClient()
    })

    test.afterAll(async () => {
        await client.close()
    })

    test('restore_backup(confirm: false) returns structured validation error', async () => {
        // When confirm is false, the handler returns a structured error response.
        const payload = (await callToolAndParse(client, 'restore_backup', {
            filename: 'nonexistent.db',
            confirm: false,
        })) as Record<string, unknown>

        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
        expect((payload.error as string).toLowerCase()).toContain('confirm')
        expect(payload.code).toBe('VALIDATION_ERROR')
        expect(payload.category).toBe('validation')
    })

    test('restore_backup with nonexistent file returns structured error', async () => {
        const payload = (await callToolAndParse(client, 'restore_backup', {
            filename: 'nonexistent-backup-file-that-does-not-exist.db',
            confirm: true,
        })) as Record<string, unknown>

        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
    })

    test('full backup → restore cycle succeeds', async () => {
        // Step 1: Create an entry so the DB is non-empty
        const entry = await callToolAndParse(client, 'create_entry', {
            content: 'Backup restore cycle test entry',
            entry_type: 'test_entry',
            tags: ['backup-restore-test'],
        })
        expectSuccess(entry)

        // Step 2: Create a backup
        const backup = await callToolAndParse(client, 'backup_journal', {})
        expectSuccess(backup)
        expect(backup.success).toBe(true)
        expect(typeof backup.filename).toBe('string')

        const backupFilename = backup.filename as string

        // Step 3: Restore from the backup (use filename directly from backup result)
        const restorePayload = (await callToolAndParse(client, 'restore_backup', {
            filename: backupFilename,
            confirm: true,
        })) as Record<string, unknown>

        expect(restorePayload.success).toBe(true)
    })
})
