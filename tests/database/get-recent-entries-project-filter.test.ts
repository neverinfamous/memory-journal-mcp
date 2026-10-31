import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

describe('DatabaseAdapter getRecentEntries Project Filtering', () => {
    let db: DatabaseAdapter
    const testDir = './test-adapter-proj-filter-dir'
    const testDbPath = `${testDir}/test-adapter-proj-filter.db`

    beforeAll(async () => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()

        // Seed entries across different project numbers and workspaces
        db.createEntry({ content: 'Project 9 entry A', workspaceId: 'mysql-mcp', projectNumber: 9 })
        db.createEntry({ content: 'Project 9 entry B', workspaceId: 'mysql-mcp', projectNumber: 9 })
        db.createEntry({ content: 'Project 16 entry A', workspaceId: 'adamic', projectNumber: 16 })
        db.createEntry({ content: 'Project 5 entry A', workspaceId: 'memory-journal-mcp', projectNumber: 5 })
    })

    afterAll(() => {
        db.close()
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true })
        }
    })

    it('should filter entries by projectNumber when wildcard workspace is used', () => {
        const proj9Entries = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, '*', 9)
        expect(proj9Entries.entries.length).toBe(2)
        expect(proj9Entries.entries.every(e => e.projectNumber === 9)).toBe(true)

        const proj16Entries = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, '*', 16)
        expect(proj16Entries.entries.length).toBe(1)
        expect(proj16Entries.entries[0].projectNumber).toBe(16)

        const proj5Entries = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, '*', 5)
        expect(proj5Entries.entries.length).toBe(1)
        expect(proj5Entries.entries[0].projectNumber).toBe(5)

        const nonExistentProj = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, '*', 999)
        expect(nonExistentProj.entries.length).toBe(0)
    })

    it('should filter entries by projectNumber when sorted by importance', () => {
        const proj9Importance = db.getRecentEntries(10, undefined, 'importance', undefined, undefined, '*', 9)
        expect(proj9Importance.entries.length).toBe(2)
        expect(proj9Importance.entries.every(e => e.projectNumber === 9)).toBe(true)
    })

    it('should combine workspaceId and projectNumber filters correctly', () => {
        const matched = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, 'mysql-mcp', 9)
        expect(matched.entries.length).toBe(2)

        const mismatched = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, 'adamic', 9)
        expect(mismatched.entries.length).toBe(0)
    })
})
