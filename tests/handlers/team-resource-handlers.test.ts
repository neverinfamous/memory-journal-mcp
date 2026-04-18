/**
 * Team Resource Handler Tests
 *
 * Tests memory://team/recent and memory://team/statistics resources.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readResource } from '../../src/handlers/resources/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Team Resource Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-resources-personal.db'
    const teamDbPath = './test-team-resources-team.db'

    beforeAll(async () => {
        process.env.TEAM_AUTHOR = 'Alice'
        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()

        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        // Seed team entries with author column
        const entry1 = teamDb.createEntry({
            content: 'Team resource test alpha',
            tags: ['res-team'],
        })
        const entry2 = teamDb.createEntry({ content: 'Team resource test beta' })

        const flagContext = {
            flag_type: 'blocker',
            target_user: 'neverinfamous',
            link: null,
            resolved: false,
            resolved_at: null,
            resolution: null,
            author: 'Alice'
        }
        const entry3 = teamDb.createEntry({
            content: 'flag:blocker @neverinfamous: API is down',
            entryType: 'flag',
            autoContext: JSON.stringify(flagContext)
        })

        // Set author on entries via raw SQL
        const rawDb = teamDb["connection"].getNativeDb() as any
        rawDb.prepare('UPDATE memory_journal SET author = ? WHERE id = ?').run('Alice', entry1.id)
        rawDb.prepare('UPDATE memory_journal SET author = ? WHERE id = ?').run('Bob', entry2.id)
        rawDb.prepare('UPDATE memory_journal SET author = ? WHERE id = ?').run('Alice', entry3.id)
    })

    afterAll(() => {
        delete process.env.TEAM_AUTHOR
        personalDb.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // memory://team/recent
    // ========================================================================

    describe('memory://team/recent', () => {
        it('should return recent team entries with author field', async () => {
            const result = await readResource(
                'memory://team/recent',
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const data = result.data as {
                entries: { content: string; author: string | null }[]
                count: number
                source: string
            }
            expect(data.count).toBeGreaterThan(0)
            expect(data.source).toBe('team')

            // Every entry should have author field
            for (const entry of data.entries) {
                expect('author' in entry).toBe(true)
            }

            // At least one should have a non-null author
            const withAuthor = data.entries.filter((e) => e.author !== null)
            expect(withAuthor.length).toBeGreaterThan(0)
        })

        it('should include annotations with lastModified', async () => {
            const result = await readResource(
                'memory://team/recent',
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            expect(result.annotations?.lastModified).toBeDefined()
        })

        it('should return error structure when team DB not configured', async () => {
            const result = await readResource(
                'memory://team/recent',
                personalDb
                // No teamDb
            )

            const data = result.data as { error: string; entries: unknown[]; count: number }
            expect(data.error).toContain('Team database not configured')
            expect(data.count).toBe(0)
        })
    })

    // ========================================================================
    // memory://team/statistics
    // ========================================================================

    describe('memory://team/statistics', () => {
        it('should return team statistics with author breakdown', async () => {
            const result = await readResource(
                'memory://team/statistics',
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const data = result.data as {
                configured: boolean
                totalEntries: number
                authors: { author: string; count: number }[]
                source: string
            }
            expect(data.configured).toBe(true)
            expect(data.totalEntries).toBeGreaterThan(0)
            expect(data.source).toBe('team')

            // Authors breakdown
            expect(data.authors.length).toBeGreaterThan(0)
            const alice = data.authors.find((a) => a.author === 'Alice')
            expect(alice).toBeDefined()
            expect(alice!.count).toBeGreaterThan(0)
        })

        it('should return error structure when team DB not configured', async () => {
            const result = await readResource(
                'memory://team/statistics',
                personalDb
                // No teamDb
            )

            const data = result.data as { configured: boolean; error: string }
            expect(data.configured).toBe(false)
            expect(data.error).toContain('Team database not configured')
        })
    })
    // ========================================================================
    // memory://flags
    // ========================================================================

    describe('memory://flags', () => {
        it('should return active team flags', async () => {
            const result = await readResource(
                'memory://flags',
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const data = result.data as {
                activeFlags: { flag_type: string; target_user: string | null; author: string | null }[]
                count: number
            }
            expect(data.count).toBeGreaterThan(0)
            expect(data.activeFlags.length).toBeGreaterThan(0)

            const flag = data.activeFlags[0]
            expect(flag.flag_type).toBe('blocker')
            expect(flag.target_user).toBe('neverinfamous')
            expect(flag.author).toBe('Alice')
        })

        it('should return error structure when team DB not configured', async () => {
            const result = await readResource(
                'memory://flags',
                personalDb
                // No teamDb
            )

            const data = result.data as { error: string; activeFlags: unknown[]; count: number }
            expect(data.error).toContain('Team database not configured')
            expect(data.count).toBe(0)
            expect(data.activeFlags).toEqual([])
        })
    })

    // ========================================================================
    // memory://flags/vocabulary
    // ========================================================================

    describe('memory://flags/vocabulary', () => {
        it('should return default flag vocabulary', async () => {
            const result = await readResource(
                'memory://flags/vocabulary',
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const data = result.data as {
                vocabulary: string[]
                count: number
                isDefault: boolean
            }
            expect(data.isDefault).toBe(true)
            expect(data.vocabulary).toContain('blocker')
            expect(data.count).toBeGreaterThan(0)
        })

        it('should return custom flag vocabulary if configured', async () => {
            const result = await readResource(
                'memory://flags/vocabulary',
                personalDb,
                undefined, // vectorManager
                undefined, // filterConfig
                undefined, // github
                undefined, // scheduler
                teamDb,    // teamDb
                { flagVocabulary: ['urgent', 'review'] } as any // briefingConfig
            )

            const data = result.data as {
                vocabulary: string[]
                count: number
                isDefault: boolean
            }
            expect(data.isDefault).toBe(false)
            expect(data.vocabulary).toEqual(['urgent', 'review'])
            expect(data.count).toBe(2)
        })
    })
})
