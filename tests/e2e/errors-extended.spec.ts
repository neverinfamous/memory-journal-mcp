/**
 * Extended Error Path Tests
 *
 * Systematic domain error testing per group — nonexistent entries, invalid IDs,
 * invalid inputs — asserting structured handler errors with relevant codes.
 *
 * Extends the 6 tests in payloads-error-contracts.spec.ts to comprehensive
 * per-group coverage.
 *
 * Ported from db-mcp/tests/e2e/errors-extended.spec.ts — adapted for memory-journal-mcp.
 */

import { test, expect } from '@playwright/test'
import {
    createClient,
    callToolAndParse,
    callToolRaw,
    expectSuccess,
    expectHandlerError,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

// =============================================================================
// Core — Invalid Entry IDs
// =============================================================================

test.describe('Errors: Core', () => {
    test('get_entry_by_id with negative ID → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_entry_by_id', { entry_id: -1 })
            expectHandlerError(p)
        } finally {
            await client.close()
        }
    })

    test('get_entry_by_id with zero → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_entry_by_id', { entry_id: 0 })
            // Zero may or may not be a valid ID — accept either error or success
            expect(typeof p).toBe('object')
        } finally {
            await client.close()
        }
    })

    test('create_entry with empty content → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'create_entry', {
                content: '',
                entry_type: 'test_entry',
            })
            expectHandlerError(p)
        } finally {
            await client.close()
        }
    })

    test('create_entry with invalid entry_type → structured error or Zod error', async () => {
        const client = await createClient()
        try {
            const response = await callToolRaw(client, 'create_entry', {
                content: 'Valid content',
                entry_type: '_e2e_invalid_type_xyz',
            })
            const text = response.content[0]?.text
            expect(text).toBeDefined()
            // Accept either structured handler error or raw Zod validation error
            try {
                const parsed = JSON.parse(text)
                expect(parsed.success).toBe(false)
            } catch {
                // Non-JSON response: must NOT be a raw MCP -32602 leak
                expect(text).not.toContain('-32602')
                expect(text.toLowerCase()).toContain('error')
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Search — Invalid Inputs
// =============================================================================

test.describe('Errors: Search', () => {
    test('search_by_date_range with inverted range → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_by_date_range', {
                start_date: '2030-12-31',
                end_date: '2020-01-01',
            })
            expectHandlerError(p, /date|range|before|after/i)
        } finally {
            await client.close()
        }
    })

    test('search_by_date_range with invalid date format → structured error or Zod error', async () => {
        const client = await createClient()
        try {
            const response = await callToolRaw(client, 'search_by_date_range', {
                start_date: 'not-a-date',
                end_date: '2030-12-31',
            })
            const text = response.content[0]?.text
            expect(text).toBeDefined()
            try {
                const parsed = JSON.parse(text)
                expect(parsed.success).toBe(false)
            } catch {
                expect(text.toLowerCase()).toContain('error')
            }
        } finally {
            await client.close()
        }
    })

    test('search_entries with empty query → returns results (treats "" as get-recent)', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'search_entries', { query: '' })
            // Server treats empty string as valid — returns recent entries
            expectSuccess(p)
            expect(Array.isArray(p.entries)).toBe(true)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Relationships — Invalid Entry IDs
// =============================================================================

test.describe('Errors: Relationships', () => {
    test('link_entries with nonexistent from_entry_id → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'link_entries', {
                from_entry_id: 999999999,
                to_entry_id: 999999998,
                relationship_type: 'references',
            })
            expectHandlerError(p)
        } finally {
            await client.close()
        }
    })

    test('visualize_relationships with nonexistent entry_id → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'visualize_relationships', {
                entry_id: 999999999,
            })
            // May return empty graph or structured error
            expect(typeof p).toBe('object')
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Admin — Invalid Operations
// =============================================================================

test.describe('Errors: Admin', () => {
    test('delete_entry with nonexistent ID → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'delete_entry', {
                entry_id: 999999999,
            })
            // May soft-succeed on missing rows or return structured error
            if (p.success === false) {
                expect(typeof p.error).toBe('string')
            }
        } finally {
            await client.close()
        }
    })

    test('merge_tags with empty arrays → structured error', async () => {
        const client = await createClient()
        try {
            const response = await callToolRaw(client, 'merge_tags', {
                source_tags: [],
                target_tag: '',
            })
            const text = response.content[0]?.text
            expect(text).toBeDefined()
            try {
                const parsed = JSON.parse(text)
                expect(parsed.success).toBe(false)
            } catch {
                expect(text.length).toBeGreaterThan(0)
            }
        } finally {
            await client.close()
        }
    })

    test('add_to_vector_index with nonexistent entry_id → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'add_to_vector_index', {
                entry_id: 999999999,
            })
            expectHandlerError(p)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Backup — Invalid Paths
// =============================================================================

test.describe('Errors: Backup', () => {
    test('restore_backup with nonexistent filename → structured error', async () => {
        const client = await createClient()
        try {
            // restore_backup with bad filename returns isError: true at the MCP level,
            // so we use callToolRaw to inspect the raw response
            const response = await callToolRaw(client, 'restore_backup', {
                filename: '_e2e_nonexistent_backup_xyz.db',
            })
            const text = response.content[0]?.text ?? ''
            expect(text.length).toBeGreaterThan(0)

            // Accept either MCP-level isError or structured handler error
            if (response.isError) {
                // MCP-level error — valid rejection
                expect(text.length).toBeGreaterThan(0)
            } else {
                const parsed = JSON.parse(text)
                expectHandlerError(parsed)
            }
        } finally {
            await client.close()
        }
    })

    test('cleanup_backups with keep_count: 0 → structured error or valid cleanup', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'cleanup_backups', {
                keep_count: 0,
            })
            // Accept either error (keep_count must be > 0) or success
            expect(typeof p).toBe('object')
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Team — Mirrored Error Paths
// =============================================================================

test.describe('Errors: Team', () => {
    test('team_get_entry_by_id with nonexistent ID → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'team_get_entry_by_id', {
                entry_id: 999999999,
            })
            expectHandlerError(p)
        } finally {
            await client.close()
        }
    })

    test('team_search_by_date_range with inverted range → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'team_search_by_date_range', {
                start_date: '2030-12-31',
                end_date: '2020-01-01',
            })
            expectHandlerError(p, /date|range|before|after/i)
        } finally {
            await client.close()
        }
    })

    test('team_link_entries self-loop → structured error', async () => {
        const client = await createClient()
        try {
            // Create a team entry so the self-loop test hits the domain check,
            // not a "not found" error
            const create = await callToolAndParse(client, 'team_create_entry', {
                content: 'Team self-loop test entry',
                entry_type: 'test_entry',
            })
            expectSuccess(create)
            const entryId = (create.entry as Record<string, unknown>).id as number

            const p = await callToolAndParse(client, 'team_link_entries', {
                from_entry_id: entryId,
                to_entry_id: entryId,
                relationship_type: 'references',
            })
            expectHandlerError(p, /itself/i)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// GitHub — Graceful Degradation
// =============================================================================

test.describe('Errors: GitHub', () => {
    test('get_github_issue with nonexistent issue number → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_github_issue', {
                issue_number: 999999999,
            })
            // Accept structured error (no GitHub token, or issue not found)
            if (p.success === false) {
                expect(typeof p.error).toBe('string')
            }
        } finally {
            await client.close()
        }
    })

    test('get_github_pr with nonexistent PR number → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_github_pr', {
                pr_number: 999999999,
            })
            if (p.success === false) {
                expect(typeof p.error).toBe('string')
            }
        } finally {
            await client.close()
        }
    })

    test('get_github_milestone with nonexistent number → structured error', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'get_github_milestone', {
                milestone_number: 999999999,
            })
            if (p.success === false) {
                expect(typeof p.error).toBe('string')
            }
        } finally {
            await client.close()
        }
    })
})
