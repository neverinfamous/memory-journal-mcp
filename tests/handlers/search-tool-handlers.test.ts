/**
 * Search Tool Handler Coverage Tests
 *
 * Tests for search tool uncovered code paths:
 * - search_entries with teamDb (cross-database merge)
 * - search_by_date_range with teamDb
 * - search_entries with GitHub filters
 * - search_entries with no query and no filters (recent entries path)
 * - search_by_date_range with entry_type filter
 * - mergeAndDedup helper (dedup, sort, limit)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Search Tool Handlers - Coverage', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const testDbPath = './test-search-cov.db'
    const teamDbPath = './test-search-team-cov.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()

        // Seed personal entries
        db.createEntry({
            content: 'Personal alpha entry',
            entryType: 'personal_reflection',
            tags: ['alpha'],
            projectNumber: 42,
            issueNumber: 7,
            prNumber: 10,
        })
        db.createEntry({
            content: 'Personal beta entry',
            entryType: 'project_decision',
            tags: ['beta'],
            isPersonal: true,
        })

        // Seed team entries
        teamDb.createEntry({
            content: 'Team gamma entry',
            entryType: 'personal_reflection',
            tags: ['gamma'],
            projectNumber: 42,
        })
        teamDb.createEntry({
            content: 'Team delta entry',
            entryType: 'project_decision',
            tags: ['delta'],
        })
        // Duplicate content to test dedup
        teamDb.createEntry({
            content: 'Personal alpha entry',
            entryType: 'personal_reflection',
            tags: ['dup'],
        })
    })

    afterAll(() => {
        db.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            for (const p of [testDbPath, teamDbPath]) {
                if (fs.existsSync(p)) fs.unlinkSync(p)
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // search_entries — cross-database merge
    // ========================================================================

    describe('search_entries with teamDb', () => {
        it('should merge personal and team results', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'entry', limit: 10 },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            // Should have entries from both DBs (deduped)
            expect(result.count).toBeGreaterThan(0)
            expect(result.entries.length).toBe(result.count)
        })

        it('should deduplicate entries with same content', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'alpha', limit: 50 },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: { content: string }[]; count: number }

            // "Personal alpha entry" exists in both DBs — should be deduped
            const alphaEntries = result.entries.filter((e) =>
                e.content.includes('Personal alpha entry')
            )
            expect(alphaEntries.length).toBe(1)
        })

        it('should merge recent entries (no query, no filters)', async () => {
            const result = (await callTool(
                'search_entries',
                { limit: 10 },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // search_entries — GitHub filters
    // ========================================================================

    describe('search_entries with filters', () => {
        it('should filter by project_number', async () => {
            const result = (await callTool(
                'search_entries',
                { project_number: 42, limit: 10 },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should filter by issue_number', async () => {
            const result = (await callTool(
                'search_entries',
                { issue_number: 7, limit: 10 },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should filter by pr_number', async () => {
            const result = (await callTool('search_entries', { pr_number: 10, limit: 10 }, db)) as {
                entries: unknown[]
                count: number
            }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should filter by is_personal', async () => {
            const result = (await callTool(
                'search_entries',
                { is_personal: true, limit: 10 },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should handle combined filters with teamDb', async () => {
            const result = (await callTool(
                'search_entries',
                { project_number: 42, limit: 10 },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // search_by_date_range — cross-database merge
    // ========================================================================

    describe('search_by_date_range with teamDb', () => {
        it('should merge personal and team results by date', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                { start_date: today, end_date: today },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should apply entry_type filter', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                {
                    start_date: today,
                    end_date: today,
                    entry_type: 'project_decision',
                },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should apply tags filter', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                {
                    start_date: today,
                    end_date: today,
                    tags: ['alpha'],
                },
                db
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should return Zod error for invalid date format', async () => {
            const result = (await callTool(
                'search_by_date_range',
                { start_date: 'not-a-date', end_date: 'invalid' },
                db
            )) as { error: string }

            expect(result.error).toBeDefined()
        })
    })

    // ========================================================================
    // search_entries — Zod error handling
    // ========================================================================

    describe('search_entries error handling', () => {
        it('should return error for invalid pr_status enum', async () => {
            const result = (await callTool(
                'search_entries',
                { pr_status: 'invalid_status', limit: 5 },
                db
            )) as { error: string }

            expect(result.error).toBeDefined()
        })
    })

    // ========================================================================
    // search_entries — FTS5 phrase query (porter-stemmer sanitization)
    // ========================================================================

    describe('search_entries FTS5 phrase query', () => {
        it('should match entries when using a quoted phrase query', async () => {
            // Seed an entry with the phrase "error handling"
            db.createEntry({
                content: 'Improved error handling without breaking the API',
                entryType: 'bug_fix',
                tags: ['fts5-phrase-test'],
            })

            // Unquoted — should match
            const unquoted = (await callTool(
                'search_entries',
                { query: 'error handling', limit: 10 },
                db
            )) as { entries: { content: string }[]; count: number }
            expect(unquoted.count).toBeGreaterThan(0)

            // Quoted phrase — should also match after sanitizeFtsQuery rewrites it
            const quoted = (await callTool(
                'search_entries',
                { query: '"error handling"', limit: 10 },
                db
            )) as { entries: { content: string }[]; count: number }
            expect(quoted.count).toBeGreaterThan(0)

            // Both should find the same entry
            const unquotedContents = unquoted.entries.map((e) => e.content)
            const quotedContents = quoted.entries.map((e) => e.content)
            const phraseEntry = 'Improved error handling without breaking the API'
            expect(unquotedContents).toContain(phraseEntry)
            expect(quotedContents).toContain(phraseEntry)
        })

        it('should pass through non-phrase queries unchanged', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'deploy OR release', limit: 10 },
                db
            )) as { entries: unknown[]; count: number }
            // Should not throw and may return results
            expect(result).toBeDefined()
            expect(typeof result.count).toBe('number')
        })

        it('should handle single-word quoted phrase', async () => {
            db.createEntry({
                content: 'Architecture decision for the backend',
                entryType: 'project_decision',
                tags: ['fts5-single-word-test'],
            })

            const result = (await callTool(
                'search_entries',
                { query: '"architecture"', limit: 10 },
                db
            )) as { entries: { content: string }[]; count: number }
            expect(result.count).toBeGreaterThan(0)
        })
    })
})
