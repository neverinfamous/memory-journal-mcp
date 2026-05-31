/**
 * Team Flag Tools Handler Tests
 *
 * Tests team_pass_flag, team_resolve_flag.
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

describe('Team Flag Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-flags-personal.db'
    const teamDbPath = './test-team-flags-team.db'

    beforeAll(async () => {
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
        } catch {
            // Ignore cleanup errors
        }
    })

    const callTeamTool = async (name: string, args: Record<string, unknown>) => {
        const needsProject = ['team_pass_flag', 'team_resolve_flag', 'team_update_flag'].includes(name)
        const enhancedArgs = needsProject ? { project_number: 1, ...args } : args
        return callTool(name, enhancedArgs, personalDb, undefined, undefined, undefined, undefined, teamDb)
    }

    describe('team_pass_flag', () => {
        it('should create a flag entry', async () => {
            const result = (await callTeamTool('team_pass_flag', {
                flag_type: 'needs_review',
                message: 'Please review',
                target_user: 'alice',
                project_number: 1,
            })) as Record<string, any>

            expect(result.success).toBe(true)
            expect(result.entry.entryType).toBe('flag')
            const context = result.entry.flagMetadata
            expect(context.flag_type).toBe('needs_review')
            expect(context.target_user).toBe('alice')
        })

        it('should require team DB', async () => {
            const result = (await callTool(
                'team_pass_flag',
                { flag_type: 'needs_review', message: 'test' },
                personalDb
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return error for invalid flag type', async () => {
            const result = (await callTeamTool('team_pass_flag', {
                flag_type: 'invalid_type',
                message: 'test',
            })) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Invalid flag type')
        })

        it('should return error for author mismatch', async () => {
            const result = (await callTeamTool('team_pass_flag', {
                flag_type: 'fyi',
                message: 'test',
                author: 'wrong-author',
            })) as any

            expect(result.success).toBe(false)
            expect(result.error).toContain('Author mismatch')
        })

        it('should catch errors gracefully', async () => {
            const originalCreate = teamDb.createEntry
            try {
                teamDb.createEntry = () => { throw new Error('DB Error') }
                const result = (await callTeamTool('team_pass_flag', {
                    flag_type: 'fyi',
                    message: 'test',
                })) as any

                expect(result.success).toBe(false)
                expect(result.error).toContain('internal error')
            } finally {
                teamDb.createEntry = originalCreate
            }
        })
    })

    describe('team_resolve_flag', () => {
        it('should resolve an active flag', async () => {
            const createResult = (await callTeamTool('team_pass_flag', {
                flag_type: 'blocker',
                message: 'blocked on database migration',
                project_number: 1,
            })) as Record<string, any>

            const flagId = createResult.entry.id

            const resolveResult = (await callTeamTool('team_resolve_flag', {
                flag_id: flagId,
                resolution: 'migration complete',
                project_number: 1,
            })) as Record<string, any>

            expect(resolveResult.success).toBe(true)
            expect(resolveResult.resolved).toBe(true)

            const updatedEntry = teamDb.getEntryById(flagId)
            const context = JSON.parse(updatedEntry!.autoContext!)
            expect(context.resolved).toBe(true)
            expect(context.resolution).toBe('migration complete')
            expect(context.resolved_at).toBeDefined()
        })

        it('should require team DB', async () => {
            const result = (await callTool('team_resolve_flag', { flag_id: 1 }, personalDb)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return error if flag not found', async () => {
            const result = (await callTeamTool('team_resolve_flag', { flag_id: 9999 })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('should return error if entry is not a flag', async () => {
            const rawDb = teamDb['connection'].getNativeDb() as any
            rawDb.prepare(`INSERT INTO memory_journal (entry_type, content, timestamp) VALUES ('technical_note', 'test', '2026-01-01')`).run()
            const lastInsert = rawDb.prepare('SELECT last_insert_rowid() as id').get() as { id: number }
            const result = (await callTeamTool('team_resolve_flag', { flag_id: lastInsert.id })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not a flag')
        })

        it('should handle already resolved flags idempotently', async () => {
            const createResult = (await callTeamTool('team_pass_flag', {
                flag_type: 'fyi',
                message: 'test',
            })) as any

            await callTeamTool('team_resolve_flag', { flag_id: createResult.entry.id })
            
            // Call it again
            const resolveResult = (await callTeamTool('team_resolve_flag', { flag_id: createResult.entry.id })) as any
            expect(resolveResult.success).toBe(true)
            expect(resolveResult.resolved).toBe(true)
        })

        it('should catch errors gracefully', async () => {
            const originalGet = teamDb.getEntryById
            try {
                teamDb.getEntryById = () => { throw new Error('DB Error') }
                const result = (await callTeamTool('team_resolve_flag', { flag_id: 1 })) as any

                expect(result.success).toBe(false)
                expect(result.error).toContain('internal error')
            } finally {
                teamDb.getEntryById = originalGet
            }
        })
    })
})
