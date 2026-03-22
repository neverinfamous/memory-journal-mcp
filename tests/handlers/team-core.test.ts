import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool } from '../../src/handlers/tools/index.js'
import * as fs from 'fs'

describe('Team Core Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter

    const personalDbPath = './test-team-core-personal.db'
    const teamDbPath = './test-team-core-team.db'
    let entry1Id: number

    beforeAll(async () => {
        try {
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}

        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()

        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()

        const r1 = (await callTool(
            'team_create_entry',
            { content: 'Core test 1', tags: ['core-1', 'shared'] },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        entry1Id = r1.entry.id
        await callTool(
            'team_create_entry',
            { content: 'Core test 2', tags: ['shared'] },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
    })

    afterAll(() => {
        personalDb.close()
        teamDb.close()
        try {
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}
    })

    describe('team_get_entry_by_id', () => {
        it('should get a team entry by id', async () => {
            const result = (await callTool(
                'team_get_entry_by_id',
                { entry_id: entry1Id },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(true)
            expect(result.entry.content).toBe('Core test 1')
            expect(result.entry.author).toBeDefined()
        })

        it('should return error if not found', async () => {
            const result = (await callTool(
                'team_get_entry_by_id',
                { entry_id: 9999 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('should return error if no team db', async () => {
            const result = (await callTool(
                'team_get_entry_by_id',
                { entry_id: entry1Id },
                personalDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not configured')
        })
    })

    describe('team_get_recent', () => {
        it('should get recent entries', async () => {
            const result = (await callTool(
                'team_get_recent',
                { limit: 10 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.entries).toBeDefined()
            expect(result.entries.length).toBeGreaterThanOrEqual(2)
            expect(result.count).toBe(result.entries.length)
        })

        it('should return error if no team db', async () => {
            const result = (await callTool('team_get_recent', { limit: 10 }, personalDb)) as any
            expect(result.success).toBe(false)
        })
    })

    describe('team_list_tags', () => {
        it('should list tags', async () => {
            const result = (await callTool(
                'team_list_tags',
                {},
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.success).toBe(true)
            expect(result.tags).toBeDefined()
            expect(result.tags.some((t: any) => t.name === 'shared')).toBe(true)
            expect(result.count).toBeDefined()
        })

        it('should return error if no team db', async () => {
            const result = (await callTool('team_list_tags', {}, personalDb)) as any
            expect(result.success).toBe(false)
        })
    })
})
