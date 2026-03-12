/**
 * Resource Handler Coverage Tests — Targeted Gap Closure
 *
 * Tests for remaining uncovered lines in:
 * - handlers/resources/index.ts: getBaseUri non-memory URL, template match + ResourceResult
 * - handlers/resources/templates.ts: invalid params for template resources
 * - handlers/resources/core.ts: CI status branches, scheduler section
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readResource } from '../../src/handlers/resources/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Resource Handler Coverage', () => {
    let db: DatabaseAdapter
    const testDbPath = './test-resource-coverage.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        // Create entries with project/issue/PR links for template tests
        db.createEntry({
            content: 'Resource coverage test entry',
            tags: ['resource-test'],
            projectNumber: 42,
            issueNumber: 7,
            prNumber: 3,
        })
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
        } catch {
            // cleanup
        }
    })

    // ========================================================================
    // handlers/resources/index.ts — getBaseUri, template matching
    // ========================================================================

    describe('readResource - base URI parsing', () => {
        it('should handle memory:// URIs with query parameters', async () => {
            const result = await readResource('memory://recent?limit=5&format=brief', db)
            expect(result.data).toBeDefined()
        })

        it('should throw for unknown resource URI', async () => {
            await expect(readResource('memory://nonexistent-resource-xyz', db)).rejects.toThrow(
                'Resource not found: memory://nonexistent-resource-xyz'
            )
        })

        it('should throw for non-memory URI schemes', async () => {
            await expect(readResource('https://example.com/unknown', db)).rejects.toThrow(
                'Resource not found: https://example.com/unknown'
            )
        })
    })

    // ========================================================================
    // handlers/resources/templates.ts — invalid template params (lines 33, 67, 100)
    // ========================================================================

    describe('template resources — invalid params', () => {
        it('should return error for invalid project timeline number', async () => {
            const result = await readResource('memory://projects/abc/timeline', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return entries for valid project timeline', async () => {
            const result = await readResource('memory://projects/42/timeline', db)
            const data = result.data as { projectNumber: number; entries: unknown[] }
            expect(data.projectNumber).toBe(42)
            expect(data.entries).toBeDefined()
        })

        it('should return error for invalid issue entries number', async () => {
            const result = await readResource('memory://issues/abc/entries', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return entries for valid issue entries', async () => {
            const result = await readResource('memory://issues/7/entries', db)
            const data = result.data as { issueNumber: number; entries: unknown[] }
            expect(data.issueNumber).toBe(7)
        })

        it('should return error for invalid PR entries number', async () => {
            const result = await readResource('memory://prs/abc/entries', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return entries for valid PR entries', async () => {
            const result = await readResource('memory://prs/3/entries', db)
            const data = result.data as { prNumber: number; entries: unknown[] }
            expect(data.prNumber).toBe(3)
        })

        it('should return error for invalid PR timeline number', async () => {
            const result = await readResource('memory://prs/abc/timeline', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return timeline without GitHub for valid PR', async () => {
            const result = await readResource('memory://prs/3/timeline', db)
            const data = result.data as {
                prNumber: number
                prMetadata: null
                timelineNote: string
            }
            expect(data.prNumber).toBe(3)
            expect(data.prMetadata).toBeNull()
            expect(data.timelineNote).toContain('unavailable')
        })

        it('should return error for invalid kanban project number', async () => {
            const result = await readResource('memory://kanban/abc', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return error for kanban without github', async () => {
            const result = await readResource('memory://kanban/1', db)
            const data = result.data as { error: string }
            expect(data.error).toContain('not available')
        })

        it('should return error for invalid kanban diagram number', async () => {
            const result = await readResource('memory://kanban/abc/diagram', db)
            expect(result.data).toHaveProperty('error')
        })

        it('should return mermaid fallback for diagram without github', async () => {
            const result = await readResource('memory://kanban/1/diagram', db)
            const data = result.data as { format: string; diagram: string }
            expect(data.format).toBe('mermaid')
            expect(data.diagram).toContain('not available')
        })
    })

    // Note: health endpoint is served by HttpTransport, not as a memory:// resource.

    // ========================================================================
    // handlers/resources/core.ts — instructions resource
    // ========================================================================

    describe('core resources — instructions', () => {
        it('should return instructions text', async () => {
            const result = await readResource('memory://instructions', db)
            expect(result.data).toBeDefined()
            expect(typeof result.data).toBe('string')
        })
    })

    // ========================================================================
    // handlers/resources/core.ts — briefing resource
    // ========================================================================

    describe('core resources — briefing', () => {
        it('should return briefing data', async () => {
            const result = await readResource('memory://briefing', db)
            expect(result.data).toBeDefined()
        })
    })

    // ========================================================================
    // handlers/resources/core.ts — recent with entry_type filter
    // ========================================================================

    describe('core resources — recent with filters', () => {
        it('should return recent entries with query params', async () => {
            const result = await readResource('memory://recent?limit=3', db)
            const data = result.data as { entries: unknown[] }
            expect(data.entries).toBeDefined()
        })
    })
})
