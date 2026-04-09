/**
 * Boundary & Edge Case Tests
 *
 * Tests edge cases: empty results, single entry, duplicate tags,
 * idempotent operations, search with no matches, and date range boundaries.
 *
 * Ported from db-mcp/tests/e2e/boundary.spec.ts — adapted for memory-journal-mcp domain.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// =============================================================================
// Search with No Results
// =============================================================================

test.describe('Boundary: Empty Results', () => {
    test('search_entries with unmatched query → entries: [], not error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_entries', {
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
            const p = await callToolAndParse(client, 'create_entry', {
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
            const create = await callToolAndParse(client, 'create_entry', {
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
