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
            expect(typeof result.data).toBe('string')
            expect(result.data as string).toContain('not available')
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

    // ========================================================================
    // New optional resources — rules, workflows, skills
    // ========================================================================

    describe('core resources — memory://rules', () => {
        it('should return configured:false when RULES_FILE_PATH is not set', async () => {
            const originalEnv = process.env['RULES_FILE_PATH']
            delete process.env['RULES_FILE_PATH']

            const result = await readResource('memory://rules', db)
            const data = result.data as { configured: boolean; message: string }
            expect(data.configured).toBe(false)
            expect(data.message).toContain('RULES_FILE_PATH')

            // Restore
            if (originalEnv !== undefined) process.env['RULES_FILE_PATH'] = originalEnv
        })

        it('should return error when RULES_FILE_PATH points to nonexistent file', async () => {
            process.env['RULES_FILE_PATH'] = '/nonexistent/path/RULES.md'

            const result = await readResource('memory://rules', db)
            const data = result.data as { configured: boolean; error: string }
            expect(data.configured).toBe(true)
            expect(data.error).toBeDefined()

            delete process.env['RULES_FILE_PATH']
        })
    })

    describe('core resources — memory://workflows', () => {
        it('should return configured:false when MEMORY_JOURNAL_WORKFLOW_SUMMARY is not set', async () => {
            const originalEnv = process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
            delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']

            const result = await readResource('memory://workflows', db)
            const data = result.data as { configured: boolean; message: string }
            expect(data.configured).toBe(false)
            expect(data.message).toContain('MEMORY_JOURNAL_WORKFLOW_SUMMARY')

            if (originalEnv !== undefined)
                process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = originalEnv
        })

        it('should return workflow summary when MEMORY_JOURNAL_WORKFLOW_SUMMARY is set', async () => {
            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = 'deploy, release, audit'

            const result = await readResource('memory://workflows', db)
            const data = result.data as { configured: boolean; summary: string }
            expect(data.configured).toBe(true)
            expect(data.summary).toBe('deploy, release, audit')

            delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        })
    })

    describe('core resources — memory://skills', () => {
        it('should return shipped skills even when SKILLS_DIR_PATH is not set', async () => {
            const originalEnv = process.env['SKILLS_DIR_PATH']
            delete process.env['SKILLS_DIR_PATH']

            const result = await readResource('memory://skills', db)
            const data = result.data as {
                configured: boolean
                skills: { name: string; source: string }[]
                count: number
            }
            // Shipped skills are always discovered
            expect(data.configured).toBe(true)
            expect(data.skills.length).toBeGreaterThanOrEqual(1)
            expect(
                data.skills.some((s) => s.name === 'github-commander' && s.source === 'shipped')
            ).toBe(true)

            // Restore
            if (originalEnv !== undefined) process.env['SKILLS_DIR_PATH'] = originalEnv
        })

        it('should return shipped skills when SKILLS_DIR_PATH points to nonexistent directory', async () => {
            process.env['SKILLS_DIR_PATH'] = '/nonexistent/skills/dir'

            const result = await readResource('memory://skills', db)
            const data = result.data as {
                configured: boolean
                skills: { name: string; source: string }[]
                count: number
            }
            expect(data.configured).toBe(true)
            // User dir is invalid but shipped skills still appear
            expect(data.skills.length).toBeGreaterThanOrEqual(1)
            expect(data.skills.some((s) => s.source === 'shipped')).toBe(true)

            delete process.env['SKILLS_DIR_PATH']
        })

        it('should scan existing directory and return skill list', async () => {
            // Point at the test server directory which has markdown files (no SKILL.md, so count=0)
            process.env['SKILLS_DIR_PATH'] = './tests'

            const result = await readResource('memory://skills', db)
            const data = result.data as {
                configured: boolean
                skillsDir: string
                skills: { name: string; path: string; excerpt: string }[]
                count: number
            }
            expect(data.configured).toBe(true)
            expect(data.skills).toBeDefined()
            expect(typeof data.count).toBe('number')

            delete process.env['SKILLS_DIR_PATH']
        })
    })
})
