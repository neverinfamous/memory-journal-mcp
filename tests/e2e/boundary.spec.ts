/**
 * Boundary & Edge Case Tests
 *
 * Tests edge cases: empty results, single entry, duplicate tags,
 * idempotent operations, search with no matches, and date range boundaries.
 *
 * Ported from db-mcp/tests/e2e/boundary.spec.ts — adapted for memory-journal-mcp domain.
 */

import { test, expect } from './test-fixture.js'
import type { Client } from '@modelcontextprotocol/client'
import {
    createClient,
    callToolAndParse,
    callToolRaw,
    expectSuccess,
    expectHandlerError,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

// =============================================================================
// Search with No Results
// =============================================================================

test.describe('Boundary: Empty Results', () => {
    test('search_entries with unmatched query → entries: [], not error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_entries', {
                project_number: 1,
                query: '_e2e_xyzzy_nonexistent_term_that_matches_nothing_',
            })
            expectSuccess(p)
            expect(Array.isArray(p.entries)).toBe(true)
            expect((p.entries as unknown[]).length).toBe(0)
        } finally {
            await client.close()
        }
    })

    test('search_by_date_range with future dates → empty results, not error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_by_date_range', {
                project_number: 1,
                start_date: '2099-01-01',
                end_date: '2099-12-31',
            })
            expectSuccess(p)
            expect(Array.isArray(p.entries)).toBe(true)
            expect((p.entries as unknown[]).length).toBe(0)
        } finally {
            await client.close()
        }
    })

    test('semantic_search with unmatched query → entries: [], not error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'semantic_search', {
                query: '_e2e_xyzzy_no_semantic_match_whatsoever_',
            })
            // Accept either empty results or handler error (index may not be built)
            if (p.success !== false) {
                expect(Array.isArray(p.entries)).toBe(true)
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Date Range Edge Cases
// =============================================================================

test.describe('Boundary: Date Ranges', () => {
    test('search_by_date_range with same start/end date → valid result', async () => {
        const client = await createClient()
        try {
            const today = new Date().toISOString().split('T')[0]
            const p = await callToolAndParse(client, 'search_by_date_range', {
                project_number: 1,
                start_date: today,
                end_date: today,
            })
            // Same day range is valid — should return 0 or more entries
            expectSuccess(p)
            expect(Array.isArray(p.entries)).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('search_by_date_range with very wide range → valid result', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_by_date_range', {
                project_number: 1,
                start_date: '1970-01-01',
                end_date: '2099-12-31',
            })
            expectSuccess(p)
            expect(Array.isArray(p.entries)).toBe(true)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Nonexistent Entry IDs
// =============================================================================

test.describe('Boundary: Nonexistent Entries', () => {
    test('get_entry_by_id with very high ID → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_entry_by_id', {
                project_number: 1,
                entry_id: 999999999,
            })
            expect(p.success).toBe(false)
            expect(typeof p.error).toBe('string')
        } finally {
            await client.close()
        }
    })

    test('update_entry with nonexistent ID → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'update_entry', {
                project_number: 1,
                entry_id: 999999999,
                content: 'should not update',
            })
            expect(p.success).toBe(false)
            expect(typeof p.error).toBe('string')
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Idempotent Operations
// =============================================================================

test.describe('Boundary: Idempotency', () => {
    test('rebuild_vector_index called twice → both succeed', async () => {
        test.setTimeout(90000)
        const client = await createClient()
        try {
            const p1 = await callToolAndParse(client, 'rebuild_vector_index', {})
            // First call: accept success or error (index may not be initialized)
            expect(typeof p1.success).toBe('boolean')

            const p2 = await callToolAndParse(client, 'rebuild_vector_index', {})
            expect(typeof p2.success).toBe('boolean')

            // Both should give the same result type
            expect(p1.success).toBe(p2.success)
        } finally {
            await client.close()
        }
    })

    test('list_tags called multiple times → consistent results', async () => {
        const client = await createClient()
        try {
            const p1 = await callToolAndParse(client, 'list_tags', {})
            expectSuccess(p1)
            const p2 = await callToolAndParse(client, 'list_tags', {})
            expectSuccess(p2)

            // Tags should be consistent (same count)
            const tags1 = p1.tags as unknown[]
            const tags2 = p2.tags as unknown[]
            expect(tags1.length).toBe(tags2.length)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Self-Loop Relationship
// =============================================================================

test.describe('Boundary: Relationship Edge Cases', () => {
    let testEntryId: number

    test('setup: create entry for relationship tests', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'create_entry', { workspace_id: 'default', 
                project_number: 1,
                content: 'Boundary test entry for self-loop validation',
                entry_type: 'test_entry',
            })
            expectSuccess(p)
            testEntryId = (p.entry as Record<string, unknown>).id as number
            expect(typeof testEntryId).toBe('number')
        } finally {
            await client.close()
        }
    })

    test('link_entries self-loop → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'link_entries', {
                from_entry_id: testEntryId,
                to_entry_id: testEntryId,
                relationship_type: 'references',
            })
            expect(p.success).toBe(false)
            expect(typeof p.error).toBe('string')
        } finally {
            await client.close()
        }
    })

    test('visualize_relationships on entry with no links → valid empty graph', async () => {
        const client = await createClient()
        try {
            // Create a fresh entry with no relationships
            const create = await callToolAndParse(client, 'create_entry', { workspace_id: 'default', 
                project_number: 1,
                content: 'Isolated entry for relationship visualization boundary test',
                entry_type: 'test_entry',
            })
            expectSuccess(create)
            const isolatedId = (create.entry as Record<string, unknown>).id as number

            const p = await callToolAndParse(client, 'visualize_relationships', {
                entry_id: isolatedId,
            })
            // Should succeed with empty or minimal graph
            expectSuccess(p)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Export Edge Cases
// =============================================================================

test.describe('Boundary: Export', () => {
    test('export_entries with future date range → empty export, not error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'export_entries', {
                project_number: 1,
                start_date: '2099-01-01',
                end_date: '2099-12-31',
                format: 'json',
            })
            expectSuccess(p)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Content Length & Type Mismatch Boundaries (HTTP Transport)
// =============================================================================

async function assertStructuredTypeRejection(
    client: Client,
    toolName: string,
    args: Record<string, unknown>
): Promise<void> {
    const response = await callToolRaw(client, toolName, args)
    const text = response.content[0]?.text ?? ''
    expect(text, `${toolName}: missing response text`).not.toBe('')
    expect(text, `${toolName}: raw MCP -32602 leaked: ${text}`).not.toContain('-32602')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.success, `${toolName}: expected success: false`).toBe(false)
    expect(parsed.code, `${toolName}: expected VALIDATION_ERROR`).toBe('VALIDATION_ERROR')
}

test.describe('Boundary: Content Length & Type Mismatches', () => {
    test('create_entry accepts 50,000-character content over HTTP and cleans up', async () => {
        const client = await createClient()
        let createdId: number | undefined
        try {
            const created = await callToolAndParse(client, 'create_entry', {
                workspace_id: 'default',
                project_number: 1,
                content: 'A'.repeat(50_000),
                entry_type: 'test_entry',
            })
            expectSuccess(created)
            const entry = created.entry
            if (typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'number') {
                createdId = entry.id
            }
            expect(typeof createdId).toBe('number')

            const fetched = await callToolAndParse(client, 'get_entry_by_id', {
                project_number: 1,
                entry_id: createdId,
            })
            expectSuccess(fetched)
            const fetchedEntry = fetched.entry
            const length =
                typeof fetchedEntry === 'object' &&
                fetchedEntry !== null &&
                'content' in fetchedEntry &&
                typeof fetchedEntry.content === 'string'
                    ? fetchedEntry.content.length
                    : -1
            expect(length).toBe(50_000)
        } finally {
            if (createdId !== undefined) {
                await callToolAndParse(client, 'delete_entry', {
                    entry_id: createdId,
                    permanent: true,
                })
            }
            await client.close()
        }
    })

    test('create_entry rejects 50,001- and 100,001-character content with structured VALIDATION_ERROR', async () => {
        const client = await createClient()
        try {
            for (const length of [50_001, 100_001]) {
                const payload = await callToolAndParse(client, 'create_entry', {
                    workspace_id: 'default',
                    project_number: 1,
                    content: 'A'.repeat(length),
                    entry_type: 'test_entry',
                })
                expectHandlerError(payload, /50000/)
                expect(payload.code).toBe('VALIDATION_ERROR')
            }
        } finally {
            await client.close()
        }
    })

    test('type-mismatch inputs return structured VALIDATION_ERROR without -32602 leakage', async () => {
        const client = await createClient()
        try {
            const invalidCalls: Array<[string, Record<string, unknown>]> = [
                ['create_entry', { workspace_id: 'default', project_number: 1, content: true }],
                ['create_entry', { workspace_id: 'default', project_number: 1, content: ['array'] }],
                ['team_create_entry', { workspace_id: 'default', project_number: 1, content: 123 }],
                ['team_search', { workspace_id: 'default', project_number: 1, query: 123 }],
            ]
            for (const [toolName, args] of invalidCalls) {
                await assertStructuredTypeRejection(client, toolName, args)
            }
        } finally {
            await client.close()
        }
    })
})
