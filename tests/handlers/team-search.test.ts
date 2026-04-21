import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import * as fs from 'fs'

const callTool = (
    name: any,
    params: any,
    db: any,
    vectorManager?: any,
    github?: any,
    config?: any,
    progress?: any,
    teamDb?: any,
    teamVector?: any
) =>
    _callTool(
        name,
        params,
        db,
        vectorManager,
        github,
        config ??
            ({
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            } as any),
        progress,
        teamDb,
        teamVector
    )

vi.mock('../../src/auth/auth-context.js', async (importOriginal: any) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAuthContext: () => ({
            authenticated: true,
            claims: { sub: 'test-user', scopes: ['team', 'write', 'admin'] },
        }),
    }
})

describe('Team Search Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter

    const personalDbPath = './test-team-search-personal.db'
    const teamDbPath = './test-team-search-team.db'

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
            {
                project_number: 1,
                content: 'Strategic Search test 1',
                tags: ['strategy', 'shared'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any
        const r2 = (await callTool(
            'team_create_entry',
            {
                project_number: 1,
                content: 'Tactical Search test 2',
                tags: ['tactics'],
            },
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )) as any

        expect(r1.success).toBe(true)
        expect(r2.success).toBe(true)
    })

    afterAll(() => {
        personalDb.close()
        teamDb.close()
        try {
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}
    })

    describe('team_search', () => {
        it('should search team entries', async () => {
            const result = (await callTool(
                'team_search',
                {
                    project_number: 1,
                    query: 'Strategic',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any
            expect(result.entries).toBeDefined()
            expect(result.entries.length).toBeGreaterThan(0)
            expect(result.entries[0].content).toContain('Strategic')
        })

        it('should return error if no team db', async () => {
            const result = (await callTool(
                'team_search',
                {
                    project_number: 1,
                    query: 'test',
                },
                personalDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not configured')
        })
    })

    describe('team_search_by_date_range', () => {
        it('should search team entries by date range', async () => {
            const result = (await callTool(
                'team_search_by_date_range',
                {
                    project_number: 1,
                    start_date: '2020-01-01',
                    end_date: '2030-01-01',
                    tags: ['shared'],
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.entries).toBeDefined()
            expect(result.entries.length).toBe(1)
            expect(result.entries[0].tags).toContain('shared')
        })

        it('should return error if inverted date range', async () => {
            const result = (await callTool(
                'team_search_by_date_range',
                {
                    project_number: 1,
                    start_date: '2030-01-01',
                    end_date: '2020-01-01',
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('after end_date')
        })

        it('should return error if no team db', async () => {
            const result = (await callTool(
                'team_search_by_date_range',
                {
                    project_number: 1,
                    start_date: '2020-01-01',
                },
                personalDb
            )) as any
            expect(result.success).toBe(false)
        })
    })
})
