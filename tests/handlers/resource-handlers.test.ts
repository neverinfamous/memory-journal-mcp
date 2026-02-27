/**
 * Resource Handler Tests
 *
 * Tests getResources listing and readResource for non-GitHub resources.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getResources, readResource } from '../../src/handlers/resources/index.js'
import { SqliteAdapter } from '../../src/database/SqliteAdapter.js'

describe('Resource Handlers', () => {
    let db: SqliteAdapter
    const testDbPath = './test-resources.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()

        // Seed test data
        const e1 = db.createEntry({
            content: 'Resource test entry alpha',
            tags: ['res-tag'],
            significanceType: 'milestone',
        })
        const e2 = db.createEntry({
            content: 'Resource test entry beta',
            isPersonal: false,
            projectNumber: 42,
            issueNumber: 7,
        })
        const e3 = db.createEntry({
            content: 'Resource test entry gamma',
            prNumber: 15,
        })
        db.linkEntries(e1.id, e2.id, 'references', 'Related work')
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // getResources
    // ========================================================================

    describe('getResources', () => {
        it('should return non-empty array of resource definitions', () => {
            const resources = getResources()
            expect(Array.isArray(resources)).toBe(true)
            expect(resources.length).toBeGreaterThan(10)
        })

        it('should have uri, name, and description on each resource', () => {
            const resources = getResources()
            for (const r of resources) {
                const res = r as { uri: string; name: string; description: string }
                expect(typeof res.uri).toBe('string')
                expect(res.uri).toMatch(/^memory:\/\//)
                expect(typeof res.name).toBe('string')
                expect(typeof res.description).toBe('string')
            }
        })

        it('should include known resource URIs', () => {
            const resources = getResources()
            const uris = resources.map((r) => (r as { uri: string }).uri)

            expect(uris).toContain('memory://briefing')
            expect(uris).toContain('memory://health')
            expect(uris).toContain('memory://recent')
            expect(uris).toContain('memory://significant')
            expect(uris).toContain('memory://tags')
            expect(uris).toContain('memory://team/recent')
        })

        it('should include template resources', () => {
            const resources = getResources()
            const uris = resources.map((r) => (r as { uri: string }).uri)

            expect(uris).toContain('memory://projects/{number}/timeline')
            expect(uris).toContain('memory://issues/{issue_number}/entries')
            expect(uris).toContain('memory://prs/{pr_number}/entries')
        })
    })

    // ========================================================================
    // readResource - static resources
    // ========================================================================

    describe('readResource - static resources', () => {
        it('should read memory://briefing', async () => {
            const result = await readResource('memory://briefing', db)

            expect(result.data).toBeDefined()
            const data = result.data as {
                version: string
                journal: { totalEntries: number }
                userMessage: string
            }
            expect(data.version).toBeDefined()
            expect(data.journal.totalEntries).toBeGreaterThan(0)
            expect(data.userMessage).toContain('Session Context')
        })

        it('should read memory://instructions', async () => {
            const result = await readResource('memory://instructions', db)

            expect(result.data).toBeDefined()
            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('Session Start')
        })

        it('should show all tools in memory://instructions when no filter is set', async () => {
            // Bug fix: when filterConfig is null (all tools enabled), memory://instructions
            // must show Active Tools (39), not Active Tools (3) from the old hardcoded fallback
            const result = await readResource('memory://instructions', db, undefined, null)

            const text = result.data as string
            expect(text).toContain('Active Tools (39)')
        })

        it('should read memory://recent', async () => {
            const result = await readResource('memory://recent', db)

            const data = result.data as { entries: unknown[]; count: number }
            expect(data.entries).toBeDefined()
            expect(data.count).toBeGreaterThan(0)
            expect(result.annotations?.lastModified).toBeDefined()
        })

        it('should read memory://significant', async () => {
            const result = await readResource('memory://significant', db)

            const data = result.data as { entries: unknown[]; count: number }
            expect(data.entries).toBeDefined()
            // We created an entry with significanceType='milestone'
            expect(data.count).toBeGreaterThan(0)
        })

        it('should read memory://tags', async () => {
            const result = await readResource('memory://tags', db)

            const data = result.data as { tags: unknown[]; count: number }
            expect(data.tags).toBeDefined()
            expect(data.count).toBeGreaterThan(0)
        })

        it('should read memory://health', async () => {
            const result = await readResource('memory://health', db)

            const data = result.data as {
                database: { entryCount: number }
                toolFilter: { totalCount: number }
                timestamp: string
            }
            expect(data.database.entryCount).toBeGreaterThan(0)
            expect(data.toolFilter.totalCount).toBeGreaterThan(0)
            expect(data.timestamp).toBeDefined()
        })

        it('should read memory://team/recent', async () => {
            const result = await readResource('memory://team/recent', db)

            const data = result.data as { entries: unknown[]; count: number }
            expect(data.entries).toBeDefined()
        })

        it('should read memory://graph/recent', async () => {
            const result = await readResource('memory://graph/recent', db)

            const data = result.data as {
                format: string
                diagram: string
                relationshipCount?: number
            }
            expect(data.format).toBe('mermaid')
            expect(data.diagram).toContain('graph TD')
        })

        it('should read memory://statistics', async () => {
            const result = await readResource('memory://statistics', db)

            const data = result.data as { totalEntries: number; entriesByType: object }
            expect(data.totalEntries).toBeGreaterThan(0)
            expect(data.entriesByType).toBeDefined()
        })
    })

    // ========================================================================
    // readResource - template resources
    // ========================================================================

    describe('readResource - template resources', () => {
        it('should read memory://projects/{number}/timeline', async () => {
            const result = await readResource('memory://projects/42/timeline', db)

            const data = result.data as { projectNumber: number; entries: unknown[]; count: number }
            expect(data.projectNumber).toBe(42)
            expect(data.count).toBeGreaterThan(0)
        })

        it('should read memory://issues/{issue_number}/entries', async () => {
            const result = await readResource('memory://issues/7/entries', db)

            const data = result.data as { issueNumber: number; entries: unknown[]; count: number }
            expect(data.issueNumber).toBe(7)
            expect(data.count).toBeGreaterThan(0)
        })

        it('should read memory://prs/{pr_number}/entries', async () => {
            const result = await readResource('memory://prs/15/entries', db)

            const data = result.data as { prNumber: number; entries: unknown[]; count: number }
            expect(data.prNumber).toBe(15)
            expect(data.count).toBeGreaterThan(0)
        })

        it('should return empty for non-matching project', async () => {
            const result = await readResource('memory://projects/99999/timeline', db)

            const data = result.data as { count: number }
            expect(data.count).toBe(0)
        })

        it('should handle empty PR entries with hint', async () => {
            const result = await readResource('memory://prs/99999/entries', db)

            const data = result.data as { count: number; hint?: string }
            expect(data.count).toBe(0)
            expect(data.hint).toContain('No journal entries')
        })
    })

    // ========================================================================
    // readResource - error cases
    // ========================================================================

    describe('readResource - error cases', () => {
        it('should throw for unknown resource', async () => {
            await expect(readResource('memory://nonexistent', db)).rejects.toThrow(
                'Unknown resource'
            )
        })
    })

    // ========================================================================
    // readResource - branch coverage for query params & variants
    // ========================================================================

    describe('readResource - additional branch coverage', () => {
        it('should read memory://graph/actions', async () => {
            const result = await readResource('memory://graph/actions', db)

            const data = result.data as { format: string; diagram: string }
            expect(data.format).toBe('mermaid')
        })

        it('should read memory://actions/recent', async () => {
            const result = await readResource('memory://actions/recent', db)

            const data = result.data as { entries: unknown[]; count: number }
            expect(data.entries).toBeDefined()
        })

        it('should return briefing with expected structure', async () => {
            const result = await readResource('memory://briefing', db)
            const data = result.data as {
                version: string
                journal: { totalEntries: number }
                behaviors: { create: string }
                userMessage: string
                templateResources: string[]
            }

            expect(data.behaviors.create).toContain('implementations')
            expect(data.templateResources).toContain('memory://projects/{number}/timeline')
        })

        it('should return annotations on recent entries', async () => {
            const result = await readResource('memory://recent', db)

            expect(result.annotations).toBeDefined()
            expect(result.annotations?.lastModified).toBeDefined()
        })

        it('should handle PR timeline template', async () => {
            // PR 15 was seeded with an entry
            const result = await readResource('memory://prs/15/timeline', db)

            const data = result.data as { prNumber: number }
            expect(data.prNumber).toBe(15)
        })
    })
})
