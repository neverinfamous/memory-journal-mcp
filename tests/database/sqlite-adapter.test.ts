/**
 * SqliteAdapter Tests
 *
 * Functional tests for database adapter methods not covered by
 * tests/security/sql-injection.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SqliteAdapter } from '../../src/database/sqlite-adapter/index.js'
import type { RelationshipType } from '../../src/types/index.js'

describe('SqliteAdapter', () => {
    let db: SqliteAdapter
    const testDbPath = './test-adapter.db'

    beforeAll(async () => {
        db = new SqliteAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath)
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // Initialize
    // ========================================================================

    describe('initialize', () => {
        it('should be idempotent on re-init', async () => {
            // Second init should not throw
            await db.initialize()
        })

        it('should throw when accessing uninitalized db', async () => {
            const uninit = new SqliteAdapter('./uninit-test.db')
            expect(() => uninit.getActiveEntryCount()).toThrow('Database not initialized')
        })
    })

    // ========================================================================
    // Entry CRUD
    // ========================================================================

    describe('createEntry', () => {
        it('should create an entry with defaults', () => {
            const entry = db.createEntry({ content: 'Test entry' })

            expect(entry.id).toBeGreaterThan(0)
            expect(entry.content).toBe('Test entry')
            expect(entry.entryType).toBe('personal_reflection')
            expect(entry.isPersonal).toBe(true)
            expect(entry.tags).toEqual([])
        })

        it('should create an entry with all fields', () => {
            const entry = db.createEntry({
                content: 'Full entry',
                entryType: 'project_decision',
                tags: ['tag-a', 'tag-b'],
                isPersonal: false,
                significanceType: 'milestone',
                autoContext: 'test-context',
                projectNumber: 42,
                issueNumber: 7,
            })

            expect(entry.entryType).toBe('project_decision')
            expect(entry.isPersonal).toBe(false)
            expect(entry.tags).toContain('tag-a')
            expect(entry.tags).toContain('tag-b')
        })
    })

    describe('getEntryById', () => {
        it('should return entry by ID', () => {
            const created = db.createEntry({ content: 'Find me' })
            const found = db.getEntryById(created.id)

            expect(found).not.toBeNull()
            expect(found?.content).toBe('Find me')
        })

        it('should return null for nonexistent ID', () => {
            expect(db.getEntryById(99999)).toBeNull()
        })

        it('should exclude soft-deleted entries', () => {
            const entry = db.createEntry({ content: 'Will be deleted' })
            db.deleteEntry(entry.id)

            expect(db.getEntryById(entry.id)).toBeNull()
        })
    })

    describe('getEntryByIdIncludeDeleted', () => {
        it('should return soft-deleted entries', () => {
            const entry = db.createEntry({ content: 'Soft deleted' })
            db.deleteEntry(entry.id)

            const found = db.getEntryByIdIncludeDeleted(entry.id)
            expect(found).not.toBeNull()
            expect(found?.content).toBe('Soft deleted')
        })

        it('should return null for nonexistent ID', () => {
            expect(db.getEntryByIdIncludeDeleted(99999)).toBeNull()
        })
    })

    // ========================================================================
    // calculateImportance
    // ========================================================================

    describe('calculateImportance', () => {
        it('should return 0 for nonexistent entry', () => {
            const result = db.calculateImportance(99999)
            expect(result.score).toBe(0)
            expect(result.breakdown.significance).toBe(0)
        })

        it('should include recency component for fresh entries', () => {
            const entry = db.createEntry({ content: 'Fresh entry' })
            const result = db.calculateImportance(entry.id)

            // Fresh entry should have non-zero recency
            expect(result.breakdown.recency).toBeGreaterThan(0)
        })

        it('should include significance component when set', () => {
            const entry = db.createEntry({
                content: 'Important entry',
                significanceType: 'milestone',
            })
            const result = db.calculateImportance(entry.id)

            expect(result.breakdown.significance).toBe(0.3)
        })

        it('should include relationship component', () => {
            const entry1 = db.createEntry({ content: 'Entry A' })
            const entry2 = db.createEntry({ content: 'Entry B' })
            db.linkEntries(entry1.id, entry2.id, 'references')

            const result = db.calculateImportance(entry1.id)
            expect(result.breakdown.relationships).toBeGreaterThan(0)
        })

        it('should include causal component for causal relationships', () => {
            const entry1 = db.createEntry({ content: 'Blocker' })
            const entry2 = db.createEntry({ content: 'Resolution' })
            db.linkEntries(entry1.id, entry2.id, 'blocked_by')

            const result = db.calculateImportance(entry1.id)
            expect(result.breakdown.causal).toBeGreaterThan(0)
        })

        it('should have score between 0 and 1', () => {
            const entry = db.createEntry({
                content: 'Scored entry',
                significanceType: 'milestone',
            })
            const result = db.calculateImportance(entry.id)

            expect(result.score).toBeGreaterThanOrEqual(0)
            expect(result.score).toBeLessThanOrEqual(1)
        })
    })

    // ========================================================================
    // getRecentEntries / pagination
    // ========================================================================

    describe('getRecentEntries', () => {
        it('should respect limit', () => {
            const entries = db.getRecentEntries(2)
            expect(entries.length).toBeLessThanOrEqual(2)
        })

        it('should filter by isPersonal', () => {
            db.createEntry({ content: 'Personal entry', isPersonal: true })
            db.createEntry({ content: 'Non-personal entry', isPersonal: false })

            const personal = db.getRecentEntries(100, true)
            const nonPersonal = db.getRecentEntries(100, false)

            expect(personal.every((e) => e.isPersonal)).toBe(true)
            expect(nonPersonal.every((e) => !e.isPersonal)).toBe(true)
        })
    })

    describe('getEntriesPage / getActiveEntryCount', () => {
        it('should return correct active count', () => {
            const count = db.getActiveEntryCount()
            expect(count).toBeGreaterThan(0)
        })

        it('should paginate through entries', () => {
            const page1 = db.getEntriesPage(0, 2)
            const page2 = db.getEntriesPage(2, 2)

            expect(page1.length).toBeLessThanOrEqual(2)
            // Pages should not overlap (different IDs)
            if (page2.length > 0) {
                expect(page1[0]?.id).not.toBe(page2[0]?.id)
            }
        })
    })

    // ========================================================================
    // deleteEntry
    // ========================================================================

    describe('deleteEntry', () => {
        it('should soft delete an entry', () => {
            const entry = db.createEntry({ content: 'To soft delete' })
            const result = db.deleteEntry(entry.id)

            expect(result).toBe(true)
            expect(db.getEntryById(entry.id)).toBeNull()
            expect(db.getEntryByIdIncludeDeleted(entry.id)).not.toBeNull()
        })

        it('should permanently delete an entry', () => {
            const entry = db.createEntry({ content: 'To permanently delete' })
            const result = db.deleteEntry(entry.id, true)

            expect(result).toBe(true)
            expect(db.getEntryByIdIncludeDeleted(entry.id)).toBeNull()
        })

        it('should return false for nonexistent entry', () => {
            expect(db.deleteEntry(99999)).toBe(false)
        })

        it('should permanently delete a soft-deleted entry', () => {
            const entry = db.createEntry({ content: 'Soft then hard' })
            db.deleteEntry(entry.id) // soft delete
            const result = db.deleteEntry(entry.id, true) // permanent delete

            expect(result).toBe(true)
            expect(db.getEntryByIdIncludeDeleted(entry.id)).toBeNull()
        })
    })

    // ========================================================================
    // Search
    // ========================================================================

    describe('searchEntries', () => {
        it('should find entries by content', () => {
            db.createEntry({ content: 'Unique search term xyz123' })
            const results = db.searchEntries('xyz123')

            expect(results.length).toBeGreaterThan(0)
            expect(results[0]?.content).toContain('xyz123')
        })

        it('should respect limit', () => {
            const results = db.searchEntries('entry', { limit: 1 })
            expect(results.length).toBeLessThanOrEqual(1)
        })

        it('should filter by projectNumber', () => {
            db.createEntry({ content: 'Project specific qwer', projectNumber: 99 })
            const results = db.searchEntries('qwer', { projectNumber: 99 })

            expect(results.length).toBeGreaterThan(0)
        })

        it('should return empty for non-matching query', () => {
            const results = db.searchEntries('nonexistent_term_that_has_no_matches')
            expect(results).toEqual([])
        })
    })

    describe('searchByDateRange', () => {
        it('should find entries within date range', () => {
            db.createEntry({ content: 'Date range entry' })
            const now = new Date()
            const start = now.toISOString().split('T')[0]!
            const end = start

            const results = db.searchByDateRange(start, end)
            expect(results.length).toBeGreaterThan(0)
        })

        it('should return empty for future date range', () => {
            const results = db.searchByDateRange('2099-01-01', '2099-12-31')
            expect(results).toEqual([])
        })
    })

    // ========================================================================
    // Relationships
    // ========================================================================

    describe('linkEntries / getRelationships', () => {
        it('should create and retrieve a relationship', () => {
            const e1 = db.createEntry({ content: 'Rel source' })
            const e2 = db.createEntry({ content: 'Rel target' })

            const rel = db.linkEntries(e1.id, e2.id, 'references', 'Test link')

            expect(rel.id).toBeGreaterThan(0)
            expect(rel.relationshipType).toBe('references')
            expect(rel.description).toBe('Test link')
        })

        it('should retrieve relationships for an entry', () => {
            const e1 = db.createEntry({ content: 'Has rels' })
            const e2 = db.createEntry({ content: 'Also has rels' })
            db.linkEntries(e1.id, e2.id, 'evolves_from')

            const rels = db.getRelationships(e1.id)
            expect(rels.length).toBeGreaterThan(0)
            expect(rels.some((r) => r.relationshipType === 'evolves_from')).toBe(true)
        })

        it('should throw for nonexistent source entry', () => {
            const e2 = db.createEntry({ content: 'Target exists' })
            expect(() => db.linkEntries(99999, e2.id, 'references')).toThrow()
        })

        it('should throw for nonexistent target entry', () => {
            const e1 = db.createEntry({ content: 'Source exists' })
            expect(() => db.linkEntries(e1.id, 99999, 'references')).toThrow()
        })

        it('should support all relationship types', () => {
            const types: RelationshipType[] = [
                'evolves_from',
                'references',
                'implements',
                'blocked_by',
                'resolved',
                'caused',
            ]

            for (const type of types) {
                const e1 = db.createEntry({ content: `From ${type}` })
                const e2 = db.createEntry({ content: `To ${type}` })
                const rel = db.linkEntries(e1.id, e2.id, type)
                expect(rel.relationshipType).toBe(type)
            }
        })
    })

    // ========================================================================
    // Tags
    // ========================================================================

    describe('tag operations', () => {
        it('should list tags with usage', () => {
            db.createEntry({ content: 'Tagged', tags: ['unique-tag-abc'] })
            const tags = db.listTags()

            const found = tags.find((t) => t.name === 'unique-tag-abc')
            expect(found).toBeDefined()
            expect(found?.usageCount).toBeGreaterThan(0)
        })

        it('should get tags for an entry', () => {
            const entry = db.createEntry({ content: 'Multi tag', tags: ['mt-1', 'mt-2'] })
            const tags = db.getTagsForEntry(entry.id)

            expect(tags).toContain('mt-1')
            expect(tags).toContain('mt-2')
        })

        it('should merge tags', () => {
            db.createEntry({ content: 'Merge source', tags: ['old-tag'] })
            const result = db.mergeTags('old-tag', 'new-tag')

            expect(result.sourceDeleted).toBe(true)
            expect(result.entriesUpdated).toBeGreaterThanOrEqual(0)
        })

        it('should throw when merging nonexistent source tag', () => {
            expect(() => db.mergeTags('nonexistent-tag-xyz', 'any-target')).toThrow(
                'Tag not found: nonexistent-tag-xyz'
            )
        })
    })

    // ========================================================================
    // Statistics
    // ========================================================================

    describe('getStatistics', () => {
        it('should return statistics with day grouping', () => {
            const stats = db.getStatistics('day')

            expect(stats.totalEntries).toBeGreaterThan(0)
            expect(stats.entriesByType).toBeDefined()
            expect(stats.entriesByPeriod).toBeDefined()
        })

        it('should return statistics with week grouping', () => {
            const stats = db.getStatistics('week')
            expect(stats.totalEntries).toBeGreaterThan(0)
        })

        it('should return statistics with month grouping', () => {
            const stats = db.getStatistics('month')
            expect(stats.totalEntries).toBeGreaterThan(0)
        })

        it('should include causal metrics', () => {
            const stats = db.getStatistics()
            expect(stats.causalMetrics).toBeDefined()
            expect(typeof stats.causalMetrics.blocked_by).toBe('number')
            expect(typeof stats.causalMetrics.resolved).toBe('number')
            expect(typeof stats.causalMetrics.caused).toBe('number')
        })

        it('should filter by date range', () => {
            const allStats = db.getStatistics('day')
            const today = new Date().toISOString().split('T')[0]!
            const filteredStats = db.getStatistics('day', today, today)

            expect(filteredStats.totalEntries).toBeLessThanOrEqual(allStats.totalEntries)
            expect(filteredStats.dateRange).toBeDefined()
            expect(filteredStats.dateRange!.startDate).toBe(today)
            expect(filteredStats.dateRange!.endDate).toBe(today)
        })

        it('should return 0 entries for future date range', () => {
            const stats = db.getStatistics('day', '2099-01-01', '2099-12-31')

            expect(stats.totalEntries).toBe(0)
            expect(stats.entriesByPeriod).toEqual([])
        })

        it('should not include dateRange when no dates provided', () => {
            const stats = db.getStatistics('day')
            expect(stats.dateRange).toBeUndefined()
        })

        it('should return project breakdown when requested', () => {
            db.createEntry({ content: 'Stats project test', projectNumber: 555 })
            const stats = db.getStatistics('day', undefined, undefined, true)

            expect(stats.projectBreakdown).toBeDefined()
            expect(Array.isArray(stats.projectBreakdown)).toBe(true)
            const proj = stats.projectBreakdown!.find((p) => p.project_number === 555)
            expect(proj).toBeDefined()
            expect(proj!.entry_count).toBeGreaterThanOrEqual(1)
        })

        it('should not include projectBreakdown when not requested', () => {
            const stats = db.getStatistics('day')
            expect(stats.projectBreakdown).toBeUndefined()
        })
    })

    // ========================================================================
    // Health Status
    // ========================================================================

    describe('getHealthStatus', () => {
        it('should return health status', () => {
            const health = db.getHealthStatus()

            expect(health.database.path).toBe(testDbPath)
            expect(health.database.entryCount).toBeGreaterThan(0)
            expect(typeof health.database.sizeBytes).toBe('number')
            expect(typeof health.database.deletedEntryCount).toBe('number')
            expect(typeof health.database.relationshipCount).toBe('number')
            expect(typeof health.database.tagCount).toBe('number')
        })
    })

    // ========================================================================
    // Backup operations
    // ========================================================================

    describe('backup operations', () => {
        it('should export to backup file', () => {
            const backup = db.exportToFile('test-backup')

            expect(backup.filename).toContain('test-backup')
            expect(backup.sizeBytes).toBeGreaterThan(0)

            // Cleanup
            const fs = require('node:fs')
            if (fs.existsSync(backup.path)) {
                fs.unlinkSync(backup.path)
            }
        })

        it('should list backup files', () => {
            const backup = db.exportToFile('list-test')
            const backups = db.listBackups()

            expect(backups.length).toBeGreaterThan(0)
            expect(backups.some((b) => b.filename.includes('list-test'))).toBe(true)

            // Cleanup
            const fs = require('node:fs')
            if (fs.existsSync(backup.path)) {
                fs.unlinkSync(backup.path)
            }
        })

        it('should delete old backups keeping only keepCount', () => {
            const fs = require('node:fs')

            // Clean up any pre-existing backups from other tests
            const preExisting = db.listBackups()
            for (const backup of preExisting) {
                if (fs.existsSync(backup.path)) fs.unlinkSync(backup.path)
            }

            // Create 3 backups
            const b1 = db.exportToFile('cleanup-1')
            const b2 = db.exportToFile('cleanup-2')
            const b3 = db.exportToFile('cleanup-3')

            // Keep only 1 newest
            db.deleteOldBackups(1)

            const remaining = db.listBackups()
            // Should have exactly 1 backup remaining (newest)
            expect(remaining.length).toBe(1)

            // Cleanup any remaining
            for (const path of [b1.path, b2.path, b3.path]) {
                if (fs.existsSync(path)) fs.unlinkSync(path)
            }
        })

        it('should restore from a backup file', async () => {
            const fs = require('node:fs')
            // Create an entry and backup
            db.createEntry({ content: 'Before restore test' })
            const countBefore = db.getActiveEntryCount()
            const backup = db.exportToFile('restore-test')

            // Create more entries after backup
            db.createEntry({ content: 'After backup 1' })
            db.createEntry({ content: 'After backup 2' })
            const countAfterAdding = db.getActiveEntryCount()
            expect(countAfterAdding).toBeGreaterThan(countBefore)

            // Restore should revert to backup state
            const result = await db.restoreFromFile(backup.filename)
            expect(result.previousEntryCount).toBe(countAfterAdding)
            expect(result.newEntryCount).toBe(countBefore)

            // Cleanup
            const backups = db.listBackups()
            for (const b of backups) {
                const path = require('node:path').join('backups', b.filename)
                if (fs.existsSync(path)) fs.unlinkSync(path)
            }
        })

        it('should get raw database handle', () => {
            const rawDb = db.getRawDb()
            expect(rawDb).toBeDefined()
            expect(typeof rawDb.exec).toBe('function')
        })
    })

    // ========================================================================
    // Close
    // ========================================================================

    describe('close', () => {
        it('should close without error', () => {
            const tempDb = new SqliteAdapter('./test-close.db')
            // Close without init should not throw
            tempDb.close()
        })
    })

    // ========================================================================
    // Additional branch coverage
    // ========================================================================

    describe('updateEntry', () => {
        it('should update entry content', () => {
            const entry = db.createEntry({ content: 'Original content' })
            const updated = db.updateEntry(entry.id, { content: 'Updated content' })

            expect(updated).not.toBeNull()
            expect(updated?.content).toBe('Updated content')
        })

        it('should update tags', () => {
            const entry = db.createEntry({ content: 'Tag update', tags: ['initial'] })
            const updated = db.updateEntry(entry.id, { tags: ['updated-tag'] })

            expect(updated).not.toBeNull()
            const tags = db.getTagsForEntry(entry.id)
            expect(tags).toContain('updated-tag')
        })

        it('should return null for nonexistent entry', () => {
            const result = db.updateEntry(99999, { content: 'Nope' })
            expect(result).toBeNull()
        })
    })

    describe('searchEntries - advanced filters', () => {
        it('should filter by issueNumber', () => {
            db.createEntry({ content: 'Issue filter test', issueNumber: 888 })
            const results = db.searchEntries('', { issueNumber: 888 })
            expect(results.length).toBeGreaterThan(0)
        })

        it('should filter by prNumber', () => {
            db.createEntry({ content: 'PR filter test', prNumber: 77 })
            const results = db.searchEntries('', { prNumber: 77 })
            expect(results.length).toBeGreaterThan(0)
        })

        it('should filter by isPersonal', () => {
            const results = db.searchEntries('', { isPersonal: false })
            expect(results.every((e) => !e.isPersonal)).toBe(true)
        })
    })

    describe('searchByDateRange - with type filter', () => {
        it('should filter by entry type', () => {
            const today = new Date().toISOString().split('T')[0]!
            const results = db.searchByDateRange(today, today, {
                entryType: 'project_decision',
            })
            for (const r of results) {
                expect(r.entryType).toBe('project_decision')
            }
        })

        it('should filter by tags', () => {
            db.createEntry({ content: 'Tag date range', tags: ['daterange-tag'] })
            const today = new Date().toISOString().split('T')[0]!
            const results = db.searchByDateRange(today, today, {
                tags: ['daterange-tag'],
            })
            expect(results.length).toBeGreaterThan(0)
        })
    })

    // ========================================================================
    // Backup edge cases
    // ========================================================================

    describe('backup edge cases', () => {
        it('should return empty array when backups directory does not exist', () => {
            const fs = require('node:fs')
            const isolatedDir = './test-server/test-isolation-dir'
            if (!fs.existsSync(isolatedDir)) {
                fs.mkdirSync(isolatedDir, { recursive: true })
            }

            // Use a fresh adapter in a unique directory so its 'backups' dir doesn't exist
            const tempDb = new SqliteAdapter(`${isolatedDir}/test-no-backups.db`)
            tempDb.initialize()

            const backups = tempDb.listBackups()
            expect(backups).toEqual([])

            tempDb.close()
            // Cleanup
            if (fs.existsSync(isolatedDir)) {
                fs.rmSync(isolatedDir, { recursive: true, force: true })
            }
        })

        it('should throw when deleteOldBackups keepCount is less than 1', () => {
            expect(() => db.deleteOldBackups(0)).toThrow('keepCount must be at least 1')
        })

        it('should throw when restoring from non-existent backup file', async () => {
            await expect(db.restoreFromFile('nonexistent-backup.db')).rejects.toThrow(
                'Backup not found: nonexistent-backup.db'
            )
        })
    })
})
