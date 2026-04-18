/**
 * Team Tool Handler Tests
 *
 * Tests the team tool group: team_create_entry, team_get_recent, team_search,
 * and the share_with_team shorthand on create_entry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { callTool as _callTool } from '../../src/handlers/tools/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

const callTool = (name: any, params: any, db: any, vectorManager?: any, github?: any, config?: any, progress?: any, teamDb?: any, teamVector?: any) => 
    _callTool(name, params, db, vectorManager, github, config ?? { runtime: { maintenanceManager: { withActiveJob: (fn: any) => fn(), acquireMaintenanceLock: async () => {}, releaseMaintenanceLock: () => {} } }, io: { allowedRoots: [process.cwd()] } } as any, progress, teamDb, teamVector);


describe('Team Tool Handlers', () => {
    let personalDb: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const personalDbPath = './test-team-tools-personal.db'
    const teamDbPath = './test-team-tools-team.db'

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

    // ========================================================================
    // team_create_entry
    // ========================================================================

    describe('team_create_entry', () => {
        it('should create team entry with auto-detected author', async () => {
            const result = (await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Team entry alpha' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { success: boolean; entry: { content: string }; author: string }

            expect(result.success).toBe(true)
            expect(result.entry.content).toBe('Team entry alpha')
            expect(result.author).toBeDefined()
            expect(typeof result.author).toBe('string')
        })

        it('should use explicit author when provided', async () => {
            const result = (await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Entry by Alice', author: 'Alice' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { success: boolean; author: string; error?: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('disabled in non-OAuth environments')
        })

        it('should support tags and entry_type', async () => {
            const result = (await callTool(
                'team_create_entry',
                {
                project_number: 1,
                    content: 'Tagged team entry',
                    entry_type: 'project_decision',
                    tags: ['team-tag-1', 'team-tag-2'],
                },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { success: boolean; entry: { entryType: string; tags: string[] } }

            expect(result.success).toBe(true)
            expect(result.entry.entryType).toBe('project_decision')
            expect(result.entry.tags).toContain('team-tag-1')
        })

        it('should return error when team DB not configured', async () => {
            const result = (await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Should fail' },
                personalDb
                // No teamDb passed
            )) as { success: boolean; error: string }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // team_get_recent
    // ========================================================================

    describe('team_get_recent', () => {
        it('should return recent team entries with author', async () => {
            const result = (await callTool(
                'team_get_recent',
                {
                project_number: 1, limit: 5 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: { content: string; author: string | null }[]; count: number }

            expect(result.count).toBeGreaterThan(0)
            // Entries should have author field
            for (const entry of result.entries) {
                expect('author' in entry).toBe(true)
            }
        })

        it('should respect limit', async () => {
            const result = (await callTool(
                'team_get_recent',
                {
                project_number: 1, limit: 1 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeLessThanOrEqual(1)
        })

        it('should return error when team DB not configured', async () => {
            const result = (await callTool('team_get_recent', {
                project_number: 1,}, personalDb)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // team_search
    // ========================================================================

    describe('team_search', () => {
        it('should search team entries by query', async () => {
            await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Searchable team xyz987' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const result = (await callTool(
                'team_search',
                {
                project_number: 1, query: 'xyz987' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should search by tags', async () => {
            await callTool(
                'team_create_entry',
                {
                project_number: 1, content: 'Tag-searchable entry', tags: ['unique-search-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )

            const result = (await callTool(
                'team_search',
                {
                project_number: 1, tags: ['unique-search-tag'] },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(result.count).toBeGreaterThan(0)
        })

        it('should return error when team DB not configured', async () => {
            const result = (await callTool('team_search', {
                project_number: 1, query: 'test' }, personalDb)) as {
                success: boolean
                error: string
            }

            expect(result.success).toBe(false)
            expect(result.error).toContain('Team database not configured')
        })
    })

    // ========================================================================
    // share_with_team (on create_entry)
    // ========================================================================

    describe('create_entry - share_with_team', () => {
        it('should share entry to team DB when share_with_team is true', async () => {
            const result = (await callTool(
                'create_entry',
                { content: 'Shared to team abc123', share_with_team: true, project_number: 1 },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as {
                success: boolean
                entry: { content: string }
                sharedWithTeam?: boolean
                author?: string
            }

            expect(result.success).toBe(true)
            expect(result.sharedWithTeam).toBe(true)
            expect(result.author).toBeDefined()

            // Verify the entry exists in team DB
            const teamResults = (await callTool(
                'team_search',
                {
                project_number: 1, query: 'abc123' },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { entries: unknown[]; count: number }

            expect(teamResults.count).toBeGreaterThan(0)
        })

        it('should not include sharedWithTeam when share_with_team is false', async () => {
            const result = (await callTool(
                'create_entry',
                { content: 'Not shared to team', share_with_team: false },
                personalDb,
                undefined,
                undefined,
                undefined,
                undefined,
                teamDb
            )) as { success: boolean; sharedWithTeam?: boolean }

            expect(result.success).toBe(true)
            expect(result.sharedWithTeam).toBeUndefined()
        })

        it('should still save personal entry even without team DB', async () => {
            const result = (await callTool(
                'create_entry',
                { content: 'Personal only entry', share_with_team: true },
                personalDb
                // No teamDb — share_with_team is silently ignored
            )) as { success: boolean; entry: { content: string }; sharedWithTeam?: boolean }

            expect(result.success).toBe(true)
            expect(result.entry.content).toBe('Personal only entry')
            // share_with_team is just silently skipped (no team DB)
            expect(result.sharedWithTeam).toBeUndefined()
        })
    })
})
