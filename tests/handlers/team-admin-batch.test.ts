/**
 * Team Admin Batch Tool Handler Tests
 *
 * Tests the team admin batch tool group: team_batch_create_entries, team_batch_update_entries, team_batch_delete_entries
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

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

describe('Team Admin Batch Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './.test-output/vitest/test-team-admin-batch-personal.db'
    const teamDbPath = './.test-output/vitest/test-team-admin-batch-team.db'

    const teamVector = {
        addEntry: vi.fn().mockResolvedValue({ success: true }),
        deleteEntry: vi.fn().mockResolvedValue({ success: true }),
    }

    beforeAll(async () => {
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}

        personalDb = new DatabaseAdapter(personalDbPath)
        await personalDb.initialize()

        teamDb = new DatabaseAdapter(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()
    })

    afterAll(() => {
        personalDb.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(personalDbPath)) fs.unlinkSync(personalDbPath)
            if (fs.existsSync(teamDbPath)) fs.unlinkSync(teamDbPath)
        } catch {}
    })

    describe('team_batch_create_entries', () => {
        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_batch_create_entries',
                { entries: [{ content: 'test' }] },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return validation error if project_number is missing and no default is set', async () => {
            const result = (await callTool(
                'team_batch_create_entries',
                { entries: [{ content: 'test' }] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
            expect(result.error).toContain('Missing project_number')
        })

        it('should return validation error if project_number is missing even if defaultProjectNumber is configured', async () => {
            const customConfig = {
                defaultProjectNumber: 42,
                runtime: {
                    maintenanceManager: {
                        withActiveJob: (fn: any) => fn(),
                        acquireMaintenanceLock: async () => {},
                        releaseMaintenanceLock: () => {},
                    },
                },
                io: { allowedRoots: [process.cwd()] },
            }
            const result = (await callTool(
                'team_batch_create_entries',
                { entries: [{ content: 'test fallback' }] },
                personalDb,
                undefined,
                undefined,
                customConfig,
                undefined,
                teamDb,
                teamVector
            )) as any

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION_ERROR')
        })

        it('should successfully create multiple team entries with author injection', async () => {
            const entries = [
                { content: 'Team Batch C1', project_number: 1 },
                { content: 'Team Batch C2', project_number: 1 },
            ]

            const result = (await callTool(
                'team_batch_create_entries',
                { entries, auto_index: true },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            expect(result.success).toBe(true)
            expect(result.entries.length).toBe(2)
            expect(result.entries[0].content).toBe('Team Batch C1')
            
            // Should have author injected from AuthContext mock
            expect(result.entries[0].author).toBe('test-user')
            
            // Verify in db
            const authorMap = teamDb.getAuthorsForEntries([result.entries[0].id])
            expect(authorMap.get(result.entries[0].id)).toBe('test-user')

            expect(teamVector.addEntry).toHaveBeenCalledTimes(2) // 2 from here
        })
    })

    describe('team_batch_update_entries', () => {
        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_batch_update_entries',
                { updates: [{ entry_id: 1, content: 'test' }] },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should successfully update team entries', async () => {
            const createRes = (await callTool(
                'team_batch_create_entries',
                { entries: [{ content: 'Old Team 1', project_number: 1 }, { content: 'Old Team 2', project_number: 1 }] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            const updates = [
                { entry_id: createRes.entries[0].id, content: 'New Team 1', project_number: 1 },
                { entry_id: createRes.entries[1].id, content: 'New Team 2', project_number: 1 },
            ]

            const result = (await callTool(
                'team_batch_update_entries',
                { updates },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            expect(result.success).toBe(true)
            expect(result.updated.length).toBe(2)
            expect(result.notFound.length).toBe(0)
            
            const e1 = teamDb.getEntryById(createRes.entries[0].id)
            expect(e1?.content).toBe('New Team 1')
            // Updates don't overwrite author
            const authorMap = teamDb.getAuthorsForEntries([createRes.entries[0].id])
            expect(authorMap.get(createRes.entries[0].id)).toBe('test-user')
        })
    })

    describe('team_batch_delete_entries', () => {
        it('should return error if team DB is not configured', async () => {
            const result = (await callTool(
                'team_batch_delete_entries',
                { entry_ids: [1] },
                personalDb
            )) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should successfully delete team entries', async () => {
            const createRes = (await callTool(
                'team_batch_create_entries',
                { entries: [{ content: 'Del Team 1', project_number: 1 }] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            const entry_ids = [createRes.entries[0].id]

            const result = (await callTool(
                'team_batch_delete_entries',
                { entry_ids, project_number: 1 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb,
                teamVector
            )) as any

            expect(result.success).toBe(true)
            expect(result.deleted.length).toBe(1)
            
            expect(teamDb.getEntryById(entry_ids[0])).toBeNull()
        })
    })
})
