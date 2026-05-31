/**
 * Team Flag Extensions Tests
 *
 * Tests team_list_flags, team_update_flag, team_get_flag_analytics.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { parseFlagContext } from '../../src/types/auto-context.js'

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
                flagVocabulary: ['fyi', 'blocker', 'needs_review', 'custom_type'],
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

describe('Team Flag Extensions Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-flag-ext-personal.db'
    const teamDbPath = './test-flag-ext-team.db'

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
        const enhancedArgs = { project_number: 1, ...args }
        return callTool(
            name,
            enhancedArgs,
            personalDb,
            undefined,
            undefined,
            undefined,
            undefined,
            teamDb
        )
    }

    let flagId1: number
    let flagId2: number
    let flagId3: number

    beforeAll(async () => {
        // Create some initial flags
        const res1 = (await callTeamTool('team_pass_flag', {
            flag_type: 'fyi',
            message: 'First flag',
            target_user: 'alice',
            project_number: 1,
        })) as any
        flagId1 = res1.entry.id

        const res2 = (await callTeamTool('team_pass_flag', {
            flag_type: 'blocker',
            message: 'Second flag',
            target_user: 'bob',
            project_number: 1,
        })) as any
        flagId2 = res2.entry.id

        // Create a resolved flag
        const res3 = (await callTeamTool('team_pass_flag', {
            flag_type: 'needs_review',
            message: 'Third flag',
            project_number: 2,
        })) as any
        flagId3 = res3.entry.id

        await callTeamTool('team_resolve_flag', {
            flag_id: flagId3,
            resolution: 'all good',
            project_number: 2,
        })

        const res4 = (await callTeamTool('team_pass_flag', {
            flag_type: 'fyi',
            message: 'Fourth flag',
            project_number: 1,
        })) as any

        await callTeamTool('team_resolve_flag', {
            flag_id: res4.entry.id,
            resolution: 'all good here too',
            project_number: 1,
        })
    })

    describe('team_list_flags', () => {
        it('should require teamDb', async () => {
            const result = (await callTool('team_list_flags', {}, personalDb)) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should list all flags for a project', async () => {
            const result = (await callTeamTool('team_list_flags', { project_number: 1 })) as any
            expect(result.success).toBe(true)
            expect(result.flags.length).toBeGreaterThanOrEqual(2)
            expect(result.count).toBe(result.flags.length)
        })

        it('should filter by active status', async () => {
            const result = (await callTeamTool('team_list_flags', { status: 'active' })) as any
            expect(result.success).toBe(true)
            for (const flag of result.flags) {
                expect(flag.resolved).toBe(false)
            }
        })

        it('should filter by resolved status', async () => {
            const result = (await callTeamTool('team_list_flags', { status: 'resolved' })) as any
            expect(result.success).toBe(true)
            expect(result.flags.length).toBeGreaterThanOrEqual(1)
            for (const flag of result.flags) {
                expect(flag.resolved).toBe(true)
            }
        })

        it('should filter by flag_type', async () => {
            const result = (await callTeamTool('team_list_flags', { flag_type: 'fyi' })) as any
            expect(result.success).toBe(true)
            expect(result.flags.length).toBeGreaterThanOrEqual(1)
            expect(result.flags[0].flag_type).toBe('fyi')
        })

        it('should filter by target_user', async () => {
            const result = (await callTeamTool('team_list_flags', { target_user: '@alice' })) as any
            expect(result.success).toBe(true)
            expect(result.flags.length).toBeGreaterThanOrEqual(1)
            expect(result.flags[0].target_user).toBe('alice')
        })

        it('should filter by project_number', async () => {
            const result = (await callTeamTool('team_list_flags', {
                project_number: 2,
                status: 'all',
            })) as any
            expect(result.success).toBe(true)
            expect(result.flags.some((f: any) => f.id === flagId3)).toBe(true)
            expect(result.flags.some((f: any) => f.id === flagId1)).toBe(false)
        })

        it('should sort by priority', async () => {
            const result = (await callTeamTool('team_list_flags', {
                sort_by: 'priority',
                status: 'active',
            })) as any
            expect(result.success).toBe(true)
            // blocker is priority 0, fyi is 3
            expect(result.flags[0].flag_type).toBe('blocker')
        })

        it('should handle limit', async () => {
            const result = (await callTeamTool('team_list_flags', { limit: 1 })) as any
            expect(result.success).toBe(true)
            expect(result.flags.length).toBe(1)
        })
    })

    describe('team_update_flag', () => {
        it('should require teamDb', async () => {
            const result = (await callTool(
                'team_update_flag',
                { flag_id: flagId1 },
                personalDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should fail if flag not found', async () => {
            const result = (await callTeamTool('team_update_flag', { flag_id: 9999 })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })

        it('should fail if entry is not a flag', async () => {
            const rawDb = teamDb['connection'].getNativeDb() as any
            rawDb
                .prepare(
                    `INSERT INTO memory_journal (entry_type, content, timestamp) VALUES ('technical_note', 'test', '2026-01-01')`
                )
                .run()
            const lastInsert = rawDb.prepare('SELECT last_insert_rowid() as id').get() as {
                id: number
            }
            const result = (await callTeamTool('team_update_flag', {
                flag_id: lastInsert.id,
            })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('not a flag')
        })

        it('should fail on invalid flag_type', async () => {
            const result = (await callTeamTool('team_update_flag', {
                flag_id: flagId1,
                flag_type: 'invalid_type',
            })) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Invalid flag type')
        })

        it('should successfully update flag_type, message, target_user, and link', async () => {
            const result = (await callTeamTool('team_update_flag', {
                flag_id: flagId1,
                flag_type: 'custom_type',
                message: 'Updated message',
                target_user: 'charlie',
                link: 'https://example.com',
            })) as any

            expect(result.success).toBe(true)
            expect(result.flag_type).toBe('custom_type')
            expect(result.target_user).toBe('charlie')
            expect(result.changes).toContain('flag_type: fyi → custom_type')
            expect(result.changes).toContain('target_user: alice → charlie')
            expect(result.changes).toContain('message: updated')
            expect(result.changes).toContain('link: updated')
            expect(result.entry.content).toContain('flag:custom_type — @charlie: Updated message')
        })

        it('should reopen a resolved flag', async () => {
            const result = (await callTeamTool('team_update_flag', {
                flag_id: flagId3,
                reopen: true,
            })) as any

            expect(result.success).toBe(true)
            expect(result.resolved).toBe(false)
            expect(result.changes).toContain('reopened')
            expect(result.entry.content).not.toContain('[RESOLVED]')

            const ctx = parseFlagContext(result.entry.autoContext)
            expect(ctx?.resolved).toBe(false)
            expect(ctx?.resolution).toBeNull()
        })

        it('should clear target_user and link when set to null', async () => {
            const result = (await callTeamTool('team_update_flag', {
                flag_id: flagId1,
                target_user: null,
                link: null,
            })) as any

            expect(result.success).toBe(true)
            expect(result.target_user).toBeNull()
            expect(result.changes).toContain('target_user: charlie → cleared')
            expect(result.changes).toContain('link: cleared')
        })

        it('should do nothing if no changes are detected', async () => {
            const result = (await callTeamTool('team_update_flag', {
                flag_id: flagId1,
            })) as any

            expect(result.success).toBe(true)
            expect(result.changes).toEqual([])
        })
    })

    describe('team_get_flag_analytics', () => {
        it('should require teamDb', async () => {
            const result = (await callTool(
                'team_get_flag_analytics',
                { period: 'week' },
                personalDb
            )) as any
            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })

        it('should return valid analytics for all flags', async () => {
            const result = (await callTeamTool('team_get_flag_analytics', {
                period: 'month',
            })) as any
            expect(result.success).toBe(true)
            expect(result.summary.total_flags).toBeGreaterThanOrEqual(3)
            expect(result.summary.active_flags).toBeGreaterThanOrEqual(2)
            expect(Object.keys(result.by_type).length).toBeGreaterThanOrEqual(2)
            expect(result.by_target.length).toBeGreaterThanOrEqual(1)
            expect(result.trend.current_period).toBeGreaterThanOrEqual(3)
        })

        it('should filter analytics by project_number', async () => {
            const result = (await callTeamTool('team_get_flag_analytics', {
                project_number: 2,
                period: 'week',
            })) as any
            expect(result.success).toBe(true)
            // project 2 has flag id 3
            expect(result.summary.total_flags).toBe(1)
        })

        it('should compute period Ms correctly for day, week, month', async () => {
            const resDay = (await callTeamTool('team_get_flag_analytics', { period: 'day' })) as any
            expect(resDay.success).toBe(true)

            const resWeek = (await callTeamTool('team_get_flag_analytics', {
                period: 'week',
            })) as any
            expect(resWeek.success).toBe(true)
        })
    })
})
