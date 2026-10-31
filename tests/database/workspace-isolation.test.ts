import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import * as fs from 'node:fs'

describe('DatabaseAdapter Workspace Isolation', () => {
    let db: DatabaseAdapter
    const testDir = './test-adapter-ws-dir'
    const testDbPath = `${testDir}/test-adapter-ws.db`

    beforeAll(async () => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true })
        }
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
    })

    afterAll(() => {
        db.close()
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true })
        }
    })

    it('should create entries in specific workspaces', () => {
        const entryAlpha = db.createEntry({ content: 'Alpha content 1', workspaceId: 'alpha' })
        const entryBeta = db.createEntry({ content: 'Beta content 1', workspaceId: 'beta' })
        const entryDefault = db.createEntry({ content: 'Default content 1' })

        expect(entryAlpha.workspaceId).toBe('alpha')
        expect(entryBeta.workspaceId).toBe('beta')
        expect(entryDefault.workspaceId).toBe('default')
    })

    it('should isolate getRecentEntries by workspace', () => {
        db.createEntry({ content: 'Alpha recent', workspaceId: 'alpha' })
        db.createEntry({ content: 'Beta recent', workspaceId: 'beta' })

        const alphaEntries = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, 'alpha')
        expect(alphaEntries.entries.some(e => e.workspaceId !== 'alpha')).toBe(false)
        expect(alphaEntries.entries.some(e => e.content === 'Alpha recent')).toBe(true)

        const betaEntries = db.getRecentEntries(10, undefined, 'timestamp', undefined, undefined, 'beta')
        expect(betaEntries.entries.some(e => e.workspaceId !== 'beta')).toBe(false)
        expect(betaEntries.entries.some(e => e.content === 'Beta recent')).toBe(true)
    })

    it('should isolate searchEntries by workspace', () => {
        db.createEntry({ content: 'Unique search term alpha', workspaceId: 'alpha' })
        db.createEntry({ content: 'Unique search term beta', workspaceId: 'beta' })

        const alphaSearch = db.searchEntries('Unique search term', { workspaceId: 'alpha' })
        expect(alphaSearch.entries.length).toBe(1)
        expect(alphaSearch.entries[0].workspaceId).toBe('alpha')

        const betaSearch = db.searchEntries('Unique search term', { workspaceId: 'beta' })
        expect(betaSearch.entries.length).toBe(1)
        expect(betaSearch.entries[0].workspaceId).toBe('beta')

        // Search across all workspaces
        const allSearch = db.searchEntries('Unique search term', { workspaceId: '*' })
        expect(allSearch.entries.length).toBeGreaterThanOrEqual(2)
    })

    it('should isolate searchByDateRange by workspace', () => {
        const now = new Date()
        const pastDate = new Date(now.getTime() - 100000).toISOString()
        const futureDate = new Date(now.getTime() + 100000).toISOString()

        db.createEntry({ content: 'Date alpha', workspaceId: 'alpha', timestamp: now.toISOString() })
        db.createEntry({ content: 'Date beta', workspaceId: 'beta', timestamp: now.toISOString() })

        const alphaDates = db.searchByDateRange(pastDate, futureDate, { workspaceId: 'alpha' })
        expect(alphaDates.entries.some(e => e.workspaceId !== 'alpha')).toBe(false)

        const betaDates = db.searchByDateRange(pastDate, futureDate, { workspaceId: 'beta' })
        expect(betaDates.entries.some(e => e.workspaceId !== 'beta')).toBe(false)
    })

    it('should isolate getStatistics by workspace', () => {
        const alphaStats = db.getStatistics('month', undefined, undefined, false, 'alpha')
        const betaStats = db.getStatistics('month', undefined, undefined, false, 'beta')

        expect(alphaStats.totalEntries).toBeGreaterThan(0)
        expect(betaStats.totalEntries).toBeGreaterThan(0)
        
        // Let's make sure creating one only increases the count for that workspace
        const beforeAlpha = db.getStatistics('month', undefined, undefined, false, 'alpha').totalEntries as number
        const beforeBeta = db.getStatistics('month', undefined, undefined, false, 'beta').totalEntries as number

        db.createEntry({ content: 'Stats test', workspaceId: 'alpha' })

        const afterAlpha = db.getStatistics('month', undefined, undefined, false, 'alpha').totalEntries as number
        const afterBeta = db.getStatistics('month', undefined, undefined, false, 'beta').totalEntries as number

        expect(afterAlpha).toBe(beforeAlpha + 1)
        expect(afterBeta).toBe(beforeBeta)
    })

})
