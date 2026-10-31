/**
 * Recovery & Archiving & Keyset Pagination Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('DatabaseAdapter - Recovery, Archiving & Keyset Pagination', () => {
    let db: DatabaseAdapter
    const testDir = './test-recovery-archive-dir'
    const testDbPath = `${testDir}/test-recovery-archive.db`

    beforeAll(async () => {
        const fs = require('node:fs')
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true })
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // Soft-Delete Recovery
    // ========================================================================
    describe('Soft-Delete Recovery & Discovery', () => {
        it('should correctly list and restore soft-deleted entries', () => {
            // 1. Create a test entry
            const entry = db.createEntry({
                content: 'To be soft-deleted and recovered',
                entryType: 'technical_note',
                tags: ['recovery-test-tag'],
            })

            // Verify it exists in active entries
            const activeBefore = db.getEntryById(entry.id)
            expect(activeBefore).not.toBeNull()
            expect(activeBefore?.content).toBe('To be soft-deleted and recovered')

            // 2. Soft delete the entry
            const deleted = db.deleteEntry(entry.id)
            expect(deleted).toBe(true)

            // Verify it is omitted from default retrieval
            expect(db.getEntryById(entry.id)).toBeNull()

            // 3. Find it using getDeletedEntries
            const { entries: deletedList, count: deletedCount } = db.getDeletedEntries()
            expect(deletedCount).toBeGreaterThanOrEqual(1)
            const deletedEntry = deletedList.find((e) => e.id === entry.id)
            expect(deletedEntry).toBeDefined()
            expect(deletedEntry?.content).toBe('To be soft-deleted and recovered')

            // 4. Restore the entry
            const restored = db.restoreEntry(entry.id)
            expect(restored).toBe(true)

            // Verify it's back in active retrieval
            const activeAfter = db.getEntryById(entry.id)
            expect(activeAfter).not.toBeNull()
            expect(activeAfter?.content).toBe('To be soft-deleted and recovered')
            expect(activeAfter?.deletedAt).toBeNull()

            // Verify it is no longer listed in getDeletedEntries
            const { entries: deletedListAfter } = db.getDeletedEntries()
            expect(deletedListAfter.some((e) => e.id === entry.id)).toBe(false)
        })

        it('should return false when restoring active or nonexistent entry', () => {
            const entry = db.createEntry({ content: 'I am active' })
            
            // Restore active entry -> returns false (no change)
            const restoredActive = db.restoreEntry(entry.id)
            expect(restoredActive).toBe(false)

            // Restore nonexistent entry -> returns false
            const restoredNone = db.restoreEntry(999999)
            expect(restoredNone).toBe(false)
        })
    })

    // ========================================================================
    // Archiving
    // ========================================================================
    describe('Entry Archiving', () => {
        it('should handle isArchived flag and exclude archived entries from regular queries/searches', () => {
            // 1. Create a non-archived entry and an archived entry
            const entryActive = db.createEntry({
                content: 'Active architectural query matching term',
                isArchived: false,
            })
            const entryArchived = db.createEntry({
                content: 'Archived architectural query matching term',
                isArchived: true,
            })

            // 2. Query recent entries
            const { entries: recentDefault } = db.getRecentEntries(50)
            const recentIdsDefault = recentDefault.map((e) => e.id)
            expect(recentIdsDefault).toContain(entryActive.id)
            expect(recentIdsDefault).not.toContain(entryArchived.id)

            const { entries: recentWithArchived } = db.getRecentEntries(50, undefined, undefined, undefined, true)
            const recentIdsWithArchived = recentWithArchived.map((e) => e.id)
            expect(recentIdsWithArchived).toContain(entryActive.id)
            expect(recentIdsWithArchived).toContain(entryArchived.id)

            // 3. Search entries
            const { entries: searchDefault } = db.searchEntries('architectural')
            const searchIdsDefault = searchDefault.map((e) => e.id)
            expect(searchIdsDefault).toContain(entryActive.id)
            expect(searchIdsDefault).not.toContain(entryArchived.id)

            const { entries: searchWithArchived } = db.searchEntries('architectural', { includeArchived: true })
            const searchIdsWithArchived = searchWithArchived.map((e) => e.id)
            expect(searchIdsWithArchived).toContain(entryActive.id)
            expect(searchIdsWithArchived).toContain(entryArchived.id)

            // 4. Update active to archived
            const updated = db.updateEntry(entryActive.id, { isArchived: true })
            expect(updated?.isArchived).toBe(true)

            // Check they are both omitted from regular searches now
            const { entries: searchDefaultAfter } = db.searchEntries('architectural')
            expect(searchDefaultAfter.some((e) => e.id === entryActive.id)).toBe(false)
            expect(searchDefaultAfter.some((e) => e.id === entryArchived.id)).toBe(false)
        })
    })

    // ========================================================================
    // Keyset Cursor Pagination
    // ========================================================================
    describe('Keyset Cursor Pagination', () => {
        it('should correctly paginate results based on O(1) cursor parameters', async () => {
            // Clear or prepare unique elements for clean pagination testing
            // We create 3 distinct sequential entries
            const e1 = db.createEntry({ content: 'Pagination Page Element A' })
            // Sleep slightly or ensure distinct timestamps if SQLite granularity requires it
            // SQLite has millisecond precision, let's delay 2ms just to be certain they are distinct if sorting by timestamp
            await new Promise((resolve) => setTimeout(resolve, 5))
            const e2 = db.createEntry({ content: 'Pagination Page Element B' })
            await new Promise((resolve) => setTimeout(resolve, 5))
            const e3 = db.createEntry({ content: 'Pagination Page Element C' })

            // 1. Fetch first page with limit 1
            const page1 = db.getRecentEntries(1)
            expect(page1.entries.length).toBe(1)
            // By default, sorting is descending, so e3 (newest) should be page 1
            expect(page1.entries[0]?.id).toBe(e3.id)
            expect(page1.nextCursor).toBeDefined()

            // 2. Fetch page 2 using page 1's nextCursor
            const page2 = db.getRecentEntries(1, undefined, undefined, page1.nextCursor)
            expect(page2.entries.length).toBe(1)
            expect(page2.entries[0]?.id).toBe(e2.id)
            expect(page2.nextCursor).toBeDefined()

            // 3. Fetch page 3 using page 2's nextCursor
            const page3 = db.getRecentEntries(1, undefined, undefined, page2.nextCursor)
            expect(page3.entries.length).toBe(1)
            expect(page3.entries[0]?.id).toBe(e1.id)

            // 4. Verify searchEntries also respects keyset cursor pagination
            const searchPage1 = db.searchEntries('Pagination Page Element', { limit: 2 })
            expect(searchPage1.entries.length).toBe(2)
            expect(searchPage1.nextCursor).toBeDefined()

            const searchPage2 = db.searchEntries('Pagination Page Element', { limit: 2, cursor: searchPage1.nextCursor })
            expect(searchPage2.entries.length).toBe(1)
            expect(searchPage2.entries[0]?.id).toBe(e1.id)
        })
    })
})
