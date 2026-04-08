/**
 * Payload Contract Tests: IO
 *
 * Validates response shapes for IO tools:
 * export_entries, export_markdown, import_markdown
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'
import { rm } from 'node:fs/promises'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: IO', () => {
    let client: Client
    const testExportDir = './test-exports'

    test.beforeAll(async () => {
        client = await createClient()
        // Ensure a predictable state before we begin testing IO directories
        try { await rm(testExportDir, { recursive: true, force: true }) } catch {}
    })

    test.afterAll(async () => {
        await client.close()
        try { await rm(testExportDir, { recursive: true, force: true }) } catch {}
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
        expect(payload.count).toBe((payload.entries as unknown[]).length)
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
    
    test('export_markdown returns success payload and outputs files', async () => {
        // First ensure we have an entry to export
        const createPayload = await callToolAndParse(client, 'create_entry', { content: 'Test IO Export' })
        expectSuccess(createPayload)

        const payload = await callToolAndParse(client, 'export_markdown', {
            output_dir: testExportDir,
            limit: 3
        })
        expectSuccess(payload)
        expect(payload.output_dir).toBe(testExportDir)
        expect(typeof payload.exported_count).toBe('number')
        expect(payload.exported_count).toBeGreaterThan(0)
        expect(Array.isArray(payload.files)).toBe(true)
    })
    
    test('import_markdown reads directory and validates payload', async () => {
        // Run import on the directory we just exported to (round-trip)
        const payload = await callToolAndParse(client, 'import_markdown', {
            source_dir: testExportDir,
            dry_run: true // Test the read without breaking database counts
        })
        
        expectSuccess(payload)
        expect(payload.dry_run).toBe(true)
        expect(typeof payload.created).toBe('number')
        expect(typeof payload.updated).toBe('number')
        expect(payload.updated).toBeGreaterThan(0) // since we just exported DB items
        expect(Array.isArray(payload.errors)).toBe(true)
    })
})
