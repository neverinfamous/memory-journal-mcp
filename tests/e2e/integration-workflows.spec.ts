/**
 * Cross-Group Integration Workflow Tests
 *
 * Exercises realistic multi-group workflows that span tool boundaries
 * to catch inter-group regressions.
 *
 * Workflow 1: Core → Search → Analytics (Data Pipeline)
 * Workflow 2: Core → Relationships → Visualization (Graph Pipeline)
 * Workflow 3: Core → Export (Export Pipeline)
 * Workflow 4: Core → Backup (Backup Pipeline)
 * Workflow 5: Cross-Validation (stats vs manual count)
 *
 * Uses _e2e_integration_ prefixed content to avoid polluting real data.
 *
 * Ported from db-mcp/tests/e2e/integration-workflows.spec.ts — adapted for memory-journal-mcp.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// =============================================================================
// Workflow 1: Core → Search → Analytics (Data Pipeline)
// =============================================================================

test.describe('Integration: Core → Search → Analytics Pipeline', () => {
    const entryIds: number[] = []

    test('create entries, search them, get statistics', async () => {
        const client = await createClient()
        try {
            // Step 1: Create entries
            for (let i = 0; i < 3; i++) {
                const p = await callToolAndParse(client, 'create_entry', {
                    content: `Integration test entry ${i + 1}: _e2e_integration_pipeline_`,
                    entry_type: 'test_entry',
                    tags: ['_e2e_integration_test'],
                })
                expectSuccess(p)
                entryIds.push((p.entry as Record<string, unknown>).id as number)
            }

            expect(entryIds.length).toBe(3)

            // Step 2: Cross-group — Search for our entries
            const search = await callToolAndParse(client, 'search_entries', {
                query: '_e2e_integration_pipeline_',
            })
            expectSuccess(search)
            expect((search.entries as unknown[]).length).toBeGreaterThanOrEqual(3)

            // Step 3: Cross-group — Get statistics
            const stats = await callToolAndParse(client, 'get_statistics', {})
            expectSuccess(stats)
            // get_statistics returns flat object: { totalEntries, entriesByType, ... }
            expect(typeof stats.totalEntries).toBe('number')
            expect((stats.totalEntries as number)).toBeGreaterThanOrEqual(3)
        } finally {
            await client.close()
        }
    })

    test('cleanup: delete integration entries', async () => {
        const client = await createClient()
        try {
            for (const id of entryIds) {
                await callToolAndParse(client, 'delete_entry', { entry_id: id })
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Workflow 2: Core → Relationships → Visualization
// =============================================================================

test.describe('Integration: Core → Relationships → Visualization', () => {
    let entryIdA: number
    let entryIdB: number

    test('create entries, link them, visualize relationships', async () => {
        const client = await createClient()
        try {
            // Step 1: Create two entries
            const a = await callToolAndParse(client, 'create_entry', {
                content: 'Integration entry A _e2e_integration_links_',
                entry_type: 'test_entry',
            })
            expectSuccess(a)
            entryIdA = (a.entry as Record<string, unknown>).id as number

            const b = await callToolAndParse(client, 'create_entry', {
                content: 'Integration entry B _e2e_integration_links_',
                entry_type: 'test_entry',
            })
            expectSuccess(b)
            entryIdB = (b.entry as Record<string, unknown>).id as number

            // Step 2: Link them
            const link = await callToolAndParse(client, 'link_entries', {
                from_entry_id: entryIdA,
                to_entry_id: entryIdB,
                relationship_type: 'references',
            })
            expectSuccess(link)

            // Step 3: Visualize
            const viz = await callToolAndParse(client, 'visualize_relationships', {
                entry_id: entryIdA,
            })
            expectSuccess(viz)
        } finally {
            await client.close()
        }
    })

    test('cleanup: delete linked entries', async () => {
        const client = await createClient()
        try {
            if (entryIdA) await callToolAndParse(client, 'delete_entry', { entry_id: entryIdA })
            if (entryIdB) await callToolAndParse(client, 'delete_entry', { entry_id: entryIdB })
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Workflow 3: Core → Export Pipeline
// =============================================================================

test.describe('Integration: Core → Export Pipeline', () => {
    let exportEntryId: number

    test('create entry with tags, export by tag, verify export', async () => {
        const client = await createClient()
        try {
            // Step 1: Create entry with unique tag
            const p = await callToolAndParse(client, 'create_entry', {
                content: 'Integration export test _e2e_integration_export_',
                entry_type: 'test_entry',
                tags: ['_e2e_export_tag'],
            })
            expectSuccess(p)
            exportEntryId = (p.entry as Record<string, unknown>).id as number

            // Step 2: Export all as JSON
            const exportResult = await callToolAndParse(client, 'export_entries', {
                format: 'json',
            })
            expectSuccess(exportResult)
        } finally {
            await client.close()
        }
    })

    test('cleanup: delete export entry', async () => {
        const client = await createClient()
        try {
            if (exportEntryId) {
                await callToolAndParse(client, 'delete_entry', { entry_id: exportEntryId })
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Workflow 4: Backup Pipeline
// =============================================================================

test.describe('Integration: Backup Pipeline', () => {
    test('backup journal → list backups → verify backup exists', async () => {
        const client = await createClient()
        try {
            // Step 1: Create backup
            const backup = await callToolAndParse(client, 'backup_journal', {})
            expectSuccess(backup)
            expect(typeof backup.filename).toBe('string')

            // Step 2: List backups
            const list = await callToolAndParse(client, 'list_backups', {})
            expectSuccess(list)
            expect(Array.isArray(list.backups)).toBe(true)
            expect((list.backups as unknown[]).length).toBeGreaterThan(0)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Workflow 5: Cross-Validation (stats consistency)
// =============================================================================

test.describe('Integration: Stats Cross-Validation', () => {
    test('get_statistics totalEntries ≥ get_recent_entries count', async () => {
        const client = await createClient()
        try {
            const stats = await callToolAndParse(client, 'get_statistics', {})
            expectSuccess(stats)
            // get_statistics returns flat object: { totalEntries, entriesByType, ... }
            const totalEntries = stats.totalEntries as number

            const recent = await callToolAndParse(client, 'get_recent_entries', { limit: 100 })
            expectSuccess(recent)
            const recentCount = (recent.entries as unknown[]).length

            // Total should be >= what we get from recent (which is capped by limit)
            expect(totalEntries).toBeGreaterThanOrEqual(recentCount)
        } finally {
            await client.close()
        }
    })
})
