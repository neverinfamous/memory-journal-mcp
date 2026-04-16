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
        // BUG-S1 seed: entry with pr_status for filter regression test
        db.createEntry({
            content: 'Merged PR entry for filter test',
            entryType: 'code_review',
            prNumber: 10,
            prStatus: 'merged',
        })
        // BUG-S2 seed: entry with workflowRunId for filter regression test
        db.createEntry({
            content: 'CI run entry for filter test',
            entryType: 'technical_note',
            workflowRunId: 9999,
            workflowName: 'ci',
            workflowStatus: 'completed',
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

        it('should not deduplicate entries with same content from different databases', async () => {
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

            // 'Personal alpha entry' exists in both DBs — should NOT be deduped since sources differ
            const alphaEntries = result.entries.filter((e) =>
                e.content.includes('Personal alpha entry')
            )
            expect(alphaEntries.length).toBe(2)
        })

        it('should return validation error for empty search (no query, no filters)', async () => {
            const result = (await callTool(
                'search_entries',
                { limit: 10 },
                db,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { success: boolean; code: string }

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
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

        it('[BUG-S1] should filter by pr_status alone (regression)', async () => {
            const result = (await callTool(
                'search_entries',
                { pr_status: 'merged', limit: 50 },
                db
            )) as { entries: { prStatus: string }[]; count: number }

            expect(result.count).toBeGreaterThan(0)
            // Every returned entry must have pr_status = 'merged'
            for (const entry of result.entries) {
                expect(entry.prStatus).toBe('merged')
            }
        })

        it('[BUG-S2] should filter by workflow_run_id alone (regression)', async () => {
            const result = (await callTool(
                'search_entries',
                { workflow_run_id: 9999, limit: 50 },
                db
            )) as { entries: { workflowRunId: number }[]; count: number }

            expect(result.count).toBeGreaterThan(0)
            // Every returned entry must have workflowRunId = 9999
            for (const entry of result.entries) {
                expect(entry.workflowRunId).toBe(9999)
            }
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

    // ========================================================================
    // search_entries — Importance-Sorted Search
    // ========================================================================

    describe('Importance-sorted search', () => {
        let impDb: DatabaseAdapter
        const impDbPath = './test-importance-sort.db'
        let lowId: number
        let highId: number
        let medId: number

        beforeAll(async () => {
            impDb = new DatabaseAdapter(impDbPath)
            await impDb.initialize()

            // Entry with NO significance, NO relationships → lowest importance
            const low = impDb.createEntry({
                content: 'ImpSort low — no signals',
                entryType: 'personal_reflection',
                tags: ['imp-test'],
            })
            lowId = low.id

            // Entry WITH significance (milestone) + relationships → highest importance
            const high = impDb.createEntry({
                content: 'ImpSort high — milestone with relationships',
                entryType: 'project_decision',
                tags: ['imp-test'],
                significanceType: 'milestone',
            })
            highId = high.id

            // Entry WITH significance (decision) + 1 causal relationship → medium importance
            const med = impDb.createEntry({
                content: 'ImpSort med — decision',
                entryType: 'project_decision',
                tags: ['imp-test'],
                significanceType: 'decision',
            })
            medId = med.id

            // Add relationships to boost high entry
            impDb.linkEntries(highId, lowId, 'references')
            impDb.linkEntries(highId, medId, 'caused')
            impDb.linkEntries(highId, lowId, 'resolved') // 3 rels, 2 causal
            // Add one causal relationship to med
            impDb.linkEntries(medId, lowId, 'references') // med has 2 rels (1 from high), 1 causal (from high)
        })

        afterAll(() => {
            impDb.close()
            try {
                const fs = require('node:fs')
                if (fs.existsSync(impDbPath)) fs.unlinkSync(impDbPath)
            } catch {
                // Ignore cleanup errors
            }
        })

        it('should sort search_entries by importance with importanceScore field', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'ImpSort', sort_by: 'importance', limit: 10 },
                impDb
            )) as { entries: { id: number; importanceScore: number }[]; count: number }

            expect(result.count).toBe(3)
            // Every entry should have importanceScore
            for (const entry of result.entries) {
                expect(typeof entry.importanceScore).toBe('number')
                expect(entry.importanceScore).toBeGreaterThanOrEqual(0)
                expect(entry.importanceScore).toBeLessThanOrEqual(1)
            }
            // Should be sorted descending
            for (let i = 1; i < result.entries.length; i++) {
                expect(result.entries[i - 1]!.importanceScore).toBeGreaterThanOrEqual(
                    result.entries[i]!.importanceScore
                )
            }
            // High entry should be first (has significance + 2 relationships including causal)
            expect(result.entries[0]!.id).toBe(highId)
            // Low entry should be last (no signals)
            expect(result.entries[result.entries.length - 1]!.id).toBe(lowId)
        })

        it('should NOT include importanceScore when sort_by is default (timestamp)', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'ImpSort', limit: 10 },
                impDb
            )) as { entries: Record<string, unknown>[]; count: number }

            expect(result.count).toBe(3)
            for (const entry of result.entries) {
                expect(entry['importanceScore']).toBeUndefined()
            }
        })

        it('should sort get_recent_entries by importance', async () => {
            const result = (await callTool(
                'get_recent_entries',
                { limit: 10, sort_by: 'importance' },
                impDb
            )) as { entries: { id: number; importanceScore: number }[]; count: number }

            expect(result.entries.length).toBeGreaterThan(0)
            for (const entry of result.entries) {
                expect(typeof entry.importanceScore).toBe('number')
            }
            // Sorted descending
            for (let i = 1; i < result.entries.length; i++) {
                expect(result.entries[i - 1]!.importanceScore).toBeGreaterThanOrEqual(
                    result.entries[i]!.importanceScore
                )
            }
        })

        it('should NOT include importanceScore when get_recent_entries uses default sort', async () => {
            const result = (await callTool('get_recent_entries', { limit: 10 }, impDb)) as {
                entries: Record<string, unknown>[]
            }

            for (const entry of result.entries) {
                expect(entry['importanceScore']).toBeUndefined()
            }
        })

        it('should sort search_by_date_range by importance', async () => {
            const today = new Date().toISOString().split('T')[0]!
            const result = (await callTool(
                'search_by_date_range',
                { start_date: today, end_date: today, sort_by: 'importance', limit: 10 },
                impDb
            )) as { entries: { id: number; importanceScore: number }[]; count: number }

            expect(result.count).toBeGreaterThan(0)
            for (const entry of result.entries) {
                expect(typeof entry.importanceScore).toBe('number')
            }
            // Sorted descending
            for (let i = 1; i < result.entries.length; i++) {
                expect(result.entries[i - 1]!.importanceScore).toBeGreaterThanOrEqual(
                    result.entries[i]!.importanceScore
                )
            }
        })

        it('should reject invalid sort_by value with Zod error', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'ImpSort', sort_by: 'invalid', limit: 10 },
                impDb
            )) as { error: string }

            expect(result.error).toBeDefined()
        })

        it('should accept sort_by: "timestamp" explicitly', async () => {
            const result = (await callTool(
                'search_entries',
                { query: 'ImpSort', sort_by: 'timestamp', limit: 10 },
                impDb
            )) as { entries: Record<string, unknown>[]; count: number }

            expect(result.count).toBe(3)
            for (const entry of result.entries) {
                expect(entry['importanceScore']).toBeUndefined()
            }
        })
    })
})
