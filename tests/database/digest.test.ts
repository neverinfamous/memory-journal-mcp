import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    computeDigest,
    saveAnalyticsSnapshot,
    getLatestAnalyticsSnapshot,
    getAnalyticsSnapshots,
} from '../../src/database/sqlite-adapter/entries/digest.js'
import type { Database } from 'better-sqlite3'

describe('Digest Analytics', () => {
    let adapter: DatabaseAdapter
    let db: Database
    const testDir = './test-digest-dir'
    const testDbPath = `${testDir}/test-digest.db`

    beforeAll(async () => {
        const fs = require('node:fs')
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        adapter = new DatabaseAdapter(testDbPath)
        await adapter.initialize()
        db = adapter.getRawDb() as Database
    })

    afterAll(() => {
        adapter.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true })
            }
        } catch {
            // Ignore cleanup errors
        }
    })

    describe('computeDigest', () => {
        it('should compute initial digest with empty db', () => {
            const digest = computeDigest(db)
            expect(digest.computedAt).toBeDefined()
            expect(digest.currentPeriodEntries).toBe(0)
            expect(digest.previousPeriodEntries).toBe(0)
            expect(digest.activityGrowthPercent).toBeNull()
            expect(digest.staleProjects).toEqual([])
            expect(digest.currentRelDensity).toBe(0)
            expect(digest.previousRelDensity).toBe(0)
            expect(digest.topImportanceEntries).toEqual([])
        })

        it('should compute digest after adding entries', () => {
            // Add an entry with some data
            const entry1 = adapter.createEntry({
                content: 'Test entry for digest',
                projectNumber: 101,
            })
            // Add a significant entry
            adapter.createEntry({
                content: 'Another entry',
                projectNumber: 101,
                significanceType: 'milestone',
            })
            
            // Link them for relationship density
            adapter.linkEntries(entry1.id, entry1.id + 1, 'references')

            const digest = computeDigest(db)
            
            // With entries added in the current period, these should update
            expect(digest.currentPeriodEntries).toBeGreaterThanOrEqual(2)
            expect(digest.currentPeriodSignificant).toBeGreaterThanOrEqual(1)
            
            // Stale project shouldn't trigger because threshold is 14 days and we just added them
            expect(digest.staleProjects.length).toBe(0)
            
            // Density should be computed
            expect(digest.currentRelDensity).toBeGreaterThan(0)
            
            // Top importance
            expect(digest.topImportanceEntries.length).toBeGreaterThan(0)
            expect(digest.topImportanceEntries[0]?.id).toBeDefined()
            expect(digest.topImportanceEntries[0]?.score).toBeDefined()
        })
    })

    describe('Snapshot Persistence', () => {
        it('should save and get analytics snapshot', () => {
            const data = { test: 123 }
            const type = 'test_snapshot'
            
            const insertId = saveAnalyticsSnapshot(db, type, data)
            expect(insertId).toBeGreaterThan(0)

            const latest = getLatestAnalyticsSnapshot(db, type)
            expect(latest).not.toBeNull()
            expect(latest?.data).toEqual(data)
        })

        it('should get multiple analytics snapshots', () => {
            const type = 'multiple_snapshot'
            saveAnalyticsSnapshot(db, type, { val: 1 })
            saveAnalyticsSnapshot(db, type, { val: 2 })
            
            const snapshots = getAnalyticsSnapshots(db, type, 10)
            // They are returned in descending order of creation, but since they execute rapidly
            // timestamps might be identical in sqlite, so we just check for presence.
            expect(snapshots.length).toBe(2)
            expect(snapshots).toContainEqual(expect.objectContaining({ data: { val: 2 } }))
            expect(snapshots).toContainEqual(expect.objectContaining({ data: { val: 1 } }))
        })

        it('should return null/empty when no snapshots exist', () => {
            const latest = getLatestAnalyticsSnapshot(db, 'non-existent')
            expect(latest).toBeNull()

            const list = getAnalyticsSnapshots(db, 'non-existent')
            expect(list).toEqual([])
        })
    })
})
