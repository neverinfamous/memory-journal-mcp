/**
 * Entry History Tracking & Versioning Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('DatabaseAdapter - Entry History Tracking & Versioning', () => {
    let db: DatabaseAdapter
    const testDir = './test-history-dir'
    const testDbPath = `${testDir}/test-history.db`

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

    it('should correctly snapshot previous states when updating an entry', () => {
        // 1. Create a fresh entry
        const entry = db.createEntry({
            content: 'Original Content (Revision 0)',
            entryType: 'technical_note',
        })

        // Verify that history is initially empty (no revisions yet)
        const initialHistory = db.getEntryHistory(entry.id)
        expect(initialHistory).toEqual([])

        // 2. Perform first update
        const updated1 = db.updateEntry(entry.id, {
            content: 'Updated Content V2',
        })
        expect(updated1?.content).toBe('Updated Content V2')

        // Verify history has exactly 1 snapshot of the previous content
        const history1 = db.getEntryHistory(entry.id)
        expect(history1.length).toBe(1)
        expect(history1[0]?.revisionNumber).toBe(1)
        expect(history1[0]?.contentSnapshot).toBe('Original Content (Revision 0)')

        // 3. Perform second update
        const updated2 = db.updateEntry(entry.id, {
            content: 'Updated Content V3',
        })
        expect(updated2?.content).toBe('Updated Content V3')

        // Verify history has 2 snapshots, ordered descending by revision number
        const history2 = db.getEntryHistory(entry.id)
        expect(history2.length).toBe(2)
        
        // Newest revision comes first in descending order
        expect(history2[0]?.revisionNumber).toBe(2)
        expect(history2[0]?.contentSnapshot).toBe('Updated Content V2')

        expect(history2[1]?.revisionNumber).toBe(1)
        expect(history2[1]?.contentSnapshot).toBe('Original Content (Revision 0)')
    })

    it('should cleanly evict the oldest revisions to maintain a maximum of 10 snapshots per entry', () => {
        // 1. Create a fresh entry
        const entry = db.createEntry({
            content: 'Start State',
        })

        // 2. Perform 11 updates to trigger the eviction policy (revisions 1 through 11 will be generated)
        for (let i = 1; i <= 11; i++) {
            db.updateEntry(entry.id, {
                content: `State V${i + 1}`,
            })
        }

        // 3. Retrieve history and verify eviction
        const history = db.getEntryHistory(entry.id)
        
        // Assert the total snapshot count is capped at 10
        expect(history.length).toBe(10)

        // The newest revision (Revision 11, capturing 'State V11' before it became 'State V12') should be at the front
        expect(history[0]?.revisionNumber).toBe(11)
        expect(history[0]?.contentSnapshot).toBe('State V11')

        // The oldest remaining revision should be Revision 2 ('State V2' snapshot).
        // Revision 1 ('Start State') should have been cleanly evicted.
        const oldestRemaining = history[history.length - 1]
        expect(oldestRemaining?.revisionNumber).toBe(2)
        expect(oldestRemaining?.contentSnapshot).toBe('State V2')

        // Double check that Revision 1 is completely absent
        expect(history.some((rev) => rev.revisionNumber === 1)).toBe(false)
    })
})
