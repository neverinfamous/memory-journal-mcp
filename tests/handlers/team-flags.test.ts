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

    const callTeamTool = async (name: string, args: Record<string, unknown>) =>
        callTool(name, args, personalDb, undefined, undefined, undefined, undefined, teamDb)

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
    })
})
