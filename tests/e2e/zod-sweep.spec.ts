/**
 * Zod Validation Sweep
 *
 * Calls every tool that has REQUIRED parameters with empty args ({}).
 * Asserts the response is a structured handler error ({ success: false, error: "..." })
 * and NOT a raw MCP error frame (isError: true with -32602 code).
 *
 * Tools with no required params (e.g., get_recent_entries, list_tags) are excluded —
 * they succeed on {}.
 *
 * Ported from db-mcp/tests/e2e/zod-sweep.spec.ts — adapted for memory-journal-mcp tool names.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolRaw } from './helpers.js'

test.describe.configure({ mode: 'serial' })

/**
 * Send {} to a tool and assert we get a structured handler error,
 * not a raw MCP error frame.
 */
async function assertZodHandlerError(toolName: string) {
    const client = await createClient()
    try {
        const response = await callToolRaw(client, toolName, {})

        const text = response.content[0]?.text
        expect(text, `${toolName}: no response content`).toBeDefined()

        // The response must be valid JSON (structured handler error) OR a raw MCP
        // error string (SDK-level Zod validation caught it before the handler).
        // Both are acceptable — the key is the tool DID reject empty args.
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

        // If we got JSON, check for handler error shape
        if ('success' in parsed) {
            expect(
                parsed.success,
                `${toolName}: expected success: false, got: ${JSON.stringify(parsed, null, 2)}`
            ).toBe(false)
            expect(
                typeof parsed.error,
                `${toolName}: missing error string in: ${JSON.stringify(parsed, null, 2)}`
            ).toBe('string')
        } else if ('error' in parsed) {
            // Some tools return { error: "..." } without explicit success field
            expect(typeof parsed.error).toBe('string')
        } else {
            // Tool returned a valid result on {} — it shouldn't be in the sweep
            throw new Error(
                `${toolName}: expected error but got valid result: ${JSON.stringify(parsed, null, 2)}`
            )
        }
    } finally {
        await client.close()
    }
}

// =============================================================================
// Core Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Core', () => {
    const tools = ['create_entry', 'get_entry_by_id', 'create_entry_minimal']

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// Search Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Search', () => {
    const tools = ['search_by_date_range', 'semantic_search']

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// Relationships Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Relationships', () => {
    const tools = ['link_entries']

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// Admin Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Admin', () => {
    const tools = ['update_entry', 'delete_entry', 'merge_tags', 'add_to_vector_index']

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// Backup Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Backup', () => {
    const tools = ['restore_backup']

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// Code Mode
// =============================================================================

test.describe('Zod Sweep: Code Mode', () => {
    test('mj_execute_code({}) → handler error', async () => {
        await assertZodHandlerError('mj_execute_code')
    })
})

// =============================================================================
// Team Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: Team', () => {
    const tools = [
        'team_create_entry',
        'team_get_entry_by_id',
        'team_search_by_date_range',
        'team_update_entry',
        'team_delete_entry',
        'team_merge_tags',
        'team_link_entries',
        'team_semantic_search',
        'team_add_to_vector_index',
    ]

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})

// =============================================================================
// GitHub Group (tools with required params)
// =============================================================================

test.describe('Zod Sweep: GitHub', () => {
    const tools = [
        'get_github_issue',
        'get_github_pr',
        'create_github_issue_with_entry',
        'close_github_issue_with_entry',
        'move_kanban_item',
        'get_github_milestone',
        'create_github_milestone',
        'update_github_milestone',
        'delete_github_milestone',
    ]

    for (const tool of tools) {
        test(`${tool}({}) → handler error`, async () => {
            await assertZodHandlerError(tool)
        })
    }
})
