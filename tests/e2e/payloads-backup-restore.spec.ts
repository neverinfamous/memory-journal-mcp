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
        // The MCP SDK marks tool responses containing { success: false } as isError when
        // the outputSchema is validated — use raw callTool here instead of callToolAndParse.
        const response = await client.callTool({
            name: 'restore_backup',
            arguments: {
                filename: 'nonexistent.db',
                confirm: false,
            },
        })

        // isError may be true because the SDK detected a structured error response
        // The key assertion is that the content is a well-formed error, not an exception
        expect(Array.isArray(response.content)).toBe(true)
        const content = response.content as Array<{ type: string; text?: string }>
        expect(content.length).toBeGreaterThan(0)
        expect(content[0]!.type).toBe('text')

        const payload = JSON.parse(content[0]!.text!) as Record<string, unknown>
        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
        expect((payload.error as string).toLowerCase()).toContain('confirm')
        expect(payload.code).toBe('VALIDATION_ERROR')
        expect(payload.category).toBe('validation')
    })

    test('restore_backup with nonexistent file returns structured error', async () => {
        const response = await client.callTool({
            name: 'restore_backup',
            arguments: {
                filename: 'nonexistent-backup-file-that-does-not-exist.db',
                confirm: true,
            },
        })

        expect(Array.isArray(response.content)).toBe(true)
        const payload = JSON.parse(
            (response.content as Array<{ type: string; text: string }>)[0]!.text
        ) as Record<string, unknown>
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
        const restore = await client.callTool({
            name: 'restore_backup',
            arguments: {
                filename: backupFilename,
                confirm: true,
            },
        })

        expect(Array.isArray(restore.content)).toBe(true)
        const restorePayload = JSON.parse(
            (restore.content as Array<{ type: string; text: string }>)[0]!.text
        ) as Record<string, unknown>
        expect(restorePayload.success).toBe(true)
    })
})
