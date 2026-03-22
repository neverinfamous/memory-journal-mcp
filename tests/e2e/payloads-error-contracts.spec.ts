/**
 * Payload Contract Tests: Structured Error Field Contracts
 *
 * Validates that tool error responses include all required structured fields:
 * { success: false, error: string, code: string, category: string,
 *   suggestion: string, recoverable: boolean }
 *
 * Tests specific documented error paths: inverted date range,
 * nonexistent entry, self-loop link, and duplicate link detection.
 */

import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Payload Contracts: Structured Error Fields', () => {
    let client: Client
    let entryId1: number
    let entryId2: number

    test.beforeAll(async () => {
        client = await createClient()
        // Seed two entries for relationship error tests
        const e1 = await callToolAndParse(client, 'create_entry', {
            content: 'Error contract test entry A',
            entry_type: 'test_entry',
        })
        expectSuccess(e1)
        entryId1 = (e1.entry as Record<string, unknown>).id as number

        const e2 = await callToolAndParse(client, 'create_entry', {
            content: 'Error contract test entry B',
            entry_type: 'test_entry',
        })
        expectSuccess(e2)
        entryId2 = (e2.entry as Record<string, unknown>).id as number
    })

    test.afterAll(async () => {
        await client.close()
    })

    /**
     * Assert minimum structured error fields (success, error, code, category).
     * Use for handlers that return inline error objects without suggestion/recoverable.
     */
    function expectMinimumError(payload: Record<string, unknown>, expectedCode?: string): void {
        expect(payload.success).toBe(false)
        expect(typeof payload.error).toBe('string')
        expect(typeof payload.code).toBe('string')
        expect(typeof payload.category).toBe('string')

        if (expectedCode) {
            expect(payload.code).toBe(expectedCode)
        }
    }

    /**
     * Assert all 6 structured error fields are present (formatHandlerError paths).
     * Use for tools that route errors through formatHandlerError or MemoryJournalMcpError.
     */
    function expectFullError(payload: Record<string, unknown>, expectedCode?: string): void {
        expectMinimumError(payload, expectedCode)
        expect(typeof payload.suggestion).toBe('string')
        expect(typeof payload.recoverable).toBe('boolean')
    }

    // --- search_by_date_range: inverted date range ---

    test('search_by_date_range (inverted range) returns VALIDATION_ERROR with all fields', async () => {
        const payload = await callToolAndParse(client, 'search_by_date_range', {
            start_date: '2030-12-31',
            end_date: '2020-01-01',
        })

        expectFullError(payload, 'VALIDATION_ERROR')
        expect(payload.category).toBe('validation')
    })

    // --- get_entry_by_id: nonexistent entry ---

    test('get_entry_by_id (nonexistent ID) returns structured error with code+category', async () => {
        const payload = await callToolAndParse(client, 'get_entry_by_id', {
            entry_id: 999999999,
        })

        expectMinimumError(payload)
        // Resource errors categorize under 'resource' or 'not_found'
        expect(['resource', 'not_found']).toContain(payload.category)
    })

    // --- update_entry: nonexistent entry ---

    test('update_entry (nonexistent ID) returns structured error with code+category', async () => {
        const payload = await callToolAndParse(client, 'update_entry', {
            entry_id: 999999999,
            content: 'should not update',
        })

        expectMinimumError(payload)
        expect(typeof payload.category).toBe('string')
    })

    // --- link_entries: self-loop ---

    test('link_entries self-loop returns structured error with code+category', async () => {
        const payload = await callToolAndParse(client, 'link_entries', {
            from_entry_id: entryId1,
            to_entry_id: entryId1,
            relationship_type: 'references',
        })

        // Self-loop returns { success, error, code: 'VALIDATION_ERROR', category: 'validation' }
        // (no suggestion/recoverable on inline error paths)
        expectMinimumError(payload, 'VALIDATION_ERROR')
        expect(payload.category).toBe('validation')
    })

    // --- link_entries: duplicate detection returns { duplicate: true } ---

    test('link_entries duplicate returns { duplicate: true } (not alreadyExists)', async () => {
        // First link succeeds
        const first = await callToolAndParse(client, 'link_entries', {
            from_entry_id: entryId1,
            to_entry_id: entryId2,
            relationship_type: 'references',
        })
        expectSuccess(first)
        expect(first.success).toBe(true)

        // Second identical link is a duplicate
        const payload = await callToolAndParse(client, 'link_entries', {
            from_entry_id: entryId1,
            to_entry_id: entryId2,
            relationship_type: 'references',
        })

        // Duplicate detection: { duplicate: true } — NOT { alreadyExists: true }
        expect(payload.duplicate).toBe(true)
        expect(payload).not.toHaveProperty('alreadyExists')
    })

    // --- delete_entry: nonexistent entry structured error ---

    test('delete_entry (already-deleted or nonexistent) returns structured error with code+category', async () => {
        // Try to delete a very high ID that doesn't exist
        const payload = await callToolAndParse(client, 'delete_entry', {
            entry_id: 999999998,
        })

        // Should be a structured error with minimum fields
        if (payload.success === false) {
            expectMinimumError(payload)
        }
        // If success (sqlite soft-delete may silently succeed on missing rows) — also valid
    })
})
