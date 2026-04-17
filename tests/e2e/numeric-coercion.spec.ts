/**
 * Numeric Coercion Tests
 *
 * For tools with numeric params, pass string values like "abc".
 * Assert the response is a structured handler error, NOT a raw MCP -32602 error.
 *
 * Ported from db-mcp/tests/e2e/numeric-coercion.spec.ts — adapted for memory-journal-mcp.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolRaw } from './helpers.js'

test.describe.configure({ mode: 'serial' })

/**
 * Call a tool with a string value for a numeric parameter.
 * Assert the response is structured JSON (not a raw MCP error frame).
 * Server may either: (1) coerce "abc" to a default and succeed, or (2) return a handler error.
 * Both are acceptable — the key assertion is that we DON'T get a raw MCP -32602 error.
 */
async function assertNumericCoercion(toolName: string, args: Record<string, unknown>) {
    const client = await createClient()
    try {
        const response = await callToolRaw(client, toolName, args)
        const text = response.content[0]?.text
        expect(text, `${toolName}: no response content`).toBeDefined()

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(text)
        } catch {
            // Non-JSON response: verify it's not a raw MCP -32602 error frame.
            expect(text, `${toolName}: raw MCP -32602 error leaked through: ${text}`).not.toContain(
                '-32602'
            )
            return
        }

        // Must be a structured JSON response
        expect(
            typeof parsed,
            `${toolName}: expected JSON object. Got: ${JSON.stringify(parsed, null, 2)}`
        ).toBe('object')
    } finally {
        await client.close()
    }
}

// =============================================================================
// Core Group — numeric entry_id and limit parameters
// =============================================================================

test.describe('Numeric Coercion: Core', () => {
    test('get_entry_by_id with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('get_entry_by_id', { entry_id: 'abc' })
    })

    test('get_recent_entries with limit: "abc" → handler error or coerced default', async () => {
        await assertNumericCoercion('get_recent_entries', { limit: 'abc' })
    })
})

// =============================================================================
// Search Group — numeric limit parameter
// =============================================================================

test.describe('Numeric Coercion: Search', () => {
    test('search_entries with limit: "abc" → handler error', async () => {
        await assertNumericCoercion('search_entries', { query: 'test', limit: 'abc' })
    })

    test('search_by_date_range with limit: "abc" → handler error', async () => {
        await assertNumericCoercion('search_by_date_range', {
            start_date: '2020-01-01',
            end_date: '2030-12-31',
            limit: 'abc',
        })
    })
})

// =============================================================================
// Admin Group — numeric entry_id parameter
// =============================================================================

test.describe('Numeric Coercion: Admin', () => {
    test('update_entry with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('update_entry', {
            entry_id: 'abc',
            content: 'updated content',
        })
    })

    test('delete_entry with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('delete_entry', { entry_id: 'abc' })
    })

    test('add_to_vector_index with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('add_to_vector_index', { entry_id: 'abc' })
    })
})

// =============================================================================
// Relationships — numeric entry_id parameters
// =============================================================================

test.describe('Numeric Coercion: Relationships', () => {
    test('link_entries with from_entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('link_entries', {
            from_entry_id: 'abc',
            to_entry_id: 1,
            relationship_type: 'references',
        })
    })

    test('visualize_relationships with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('visualize_relationships', { entry_id: 'abc' })
    })
})

// =============================================================================
// Code Mode — numeric timeout parameter
// =============================================================================

test.describe('Numeric Coercion: Code Mode', () => {
    test('mj_execute_code with timeout: "abc" → handler error', async () => {
        await assertNumericCoercion('mj_execute_code', {
            code: 'return 1;',
            timeout: 'abc',
        })
    })
})

// =============================================================================
// Team Group — mirrored numeric params
// =============================================================================

test.describe('Numeric Coercion: Team', () => {
    test('team_get_entry_by_id with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('team_get_entry_by_id', {
                project_number: 1, entry_id: 'abc' })
    })

    test('team_update_entry with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('team_update_entry', {
                project_number: 1,
            entry_id: 'abc',
            content: 'updated',
        })
    })

    test('team_delete_entry with entry_id: "abc" → handler error', async () => {
        await assertNumericCoercion('team_delete_entry', {
                project_number: 1, entry_id: 'abc' })
    })

    test('team_search with limit: "abc" → handler error', async () => {
        await assertNumericCoercion('team_search', {
                project_number: 1, query: 'test', limit: 'abc' })
    })
})
